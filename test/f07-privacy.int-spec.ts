import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { createApp, problem } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { F02Fixtures } from './int/f02-fixtures.js';
import { CapturingLogger } from './int/fixtures.js';
import {
  F07Flow,
  insertSuggestionAsOwner,
  type StaffRef,
} from './int/f07-fixtures.js';

const d5 = (hhmm: string) => new Date(`2026-11-05T${hhmm}:00-05:00`);
const REPORT_AT = new Date('2026-11-12T15:00:00.000Z');
const QUERY = 'from=2026-11-01&to=2026-11-10';
const FULL_NAME = 'DEV-test Eustaquio Ramírez Soto';
const COMPLAINT = 'DEV-test disnea súbita quux-f07-privacy';
const REASON = 'DEV-test motivo de corrección garply-f07-privacy';
const SITE_NAME = 'DEV-test Sede Única f07-privacy';

/** F-07-api · T8: roles, errores y logs con datos reales (integración). */
describe('F-07: roles, errores y logs de los reportes (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let flow: F07Flow;
  const clock = new FixedClock(d5('07:00'));
  const logger = new CapturingLogger();
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  let t: { id: string; siteId: string };
  const staff = new Map<string, StaffRef>();
  let patientToken: string;
  let documentNumber: string;
  let encounterId: string;

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: GROQ_CLIENT, useValue: fake },
        { provide: OPENROUTER_CLIENT, useValue: fake },
      ],
      logger,
    });
    fx = new F02Fixtures(app);
    flow = new F07Flow(app, fx, clock);
    const base = await fx.tenant('f07-privacy');
    const site = await fx.site(base.id, SITE_NAME);
    t = { id: base.id, siteId: site.id };
    for (const role of ['RECEPTION', 'NURSE', 'PHYSICIAN', 'ADMIN'] as const) {
      staff.set(role, await flow.staff(t.id, role));
    }
    encounterId = await flow.arrive(d5('08:00'), t, staff.get('RECEPTION')!, {
      fullName: FULL_NAME,
      complaint: COMPLAINT,
    });
    const sid = await insertSuggestionAsOwner({
      tenantId: t.id,
      encounterId,
      requestedBy: staff.get('NURSE')!.id,
      createdAt: d5('08:01'),
      suggestedLevel: 3,
    });
    await flow.decide(encounterId, d5('08:05'), staff.get('NURSE')!, {
      action: 'CORRECT',
      suggestionId: sid,
      level: 2,
      reason: REASON,
    });
    documentNumber = (
      await fx.prisma.encounter.findUniqueOrThrow({
        where: { id: encounterId },
        select: { patient: { select: { documentNumber: true } } },
      })
    ).patient.documentNumber!;
    clock.set(REPORT_AT);
    patientToken = (await fx.patientUser(t.id)).token;
  });
  beforeEach(() => clock.set(REPORT_AT));
  afterAll(() => app.close());

  const exports = () =>
    fx.audits({ tenantId: t.id, action: 'REPORT_EXPORTED' });

  it('R18: con datos reales, RECEPTION, NURSE y PHYSICIAN → 403, el paciente → 403 y sin token → 401, en los dos endpoints y sin auditar', async () => {
    const before = (await exports()).length;
    for (const path of ['/reports/summary', '/reports/encounters.csv']) {
      for (const role of ['RECEPTION', 'NURSE', 'PHYSICIAN']) {
        const res = await fx.http(
          'get',
          `${path}?${QUERY}`,
          await flow.token(staff.get(role)!),
        );
        expect([path, role, res.status]).toEqual([path, role, 403]);
        expect(problem(res).status).toBe(403);
      }
      const p = await fx.http('get', `${path}?${QUERY}`, patientToken);
      expect([path, 'PATIENT', p.status]).toEqual([path, 'PATIENT', 403]);
      const none = await fx.http('get', `${path}?${QUERY}`);
      expect([path, none.status]).toEqual([path, 401]);
      expect(problem(none).status).toBe(401);
      // ADMIN sí.
      const ok = await fx.http(
        'get',
        `${path}?${QUERY}`,
        await flow.token(staff.get('ADMIN')!),
      );
      expect([path, ok.status]).toEqual([path, 200]);
    }
    // Solo la descarga del ADMIN se audita.
    expect((await exports()).length).toBe(before + 1);
  });

  it('R1: por HTTP, parámetros inválidos → 400 problem+json con el campo; R2: from > to y 367 días → 422 problem+json; sin auditoría', async () => {
    const admin = await flow.token(staff.get('ADMIN')!);
    const before = (await exports()).length;
    for (const path of ['/reports/summary', '/reports/encounters.csv']) {
      const bad = await fx.http(
        'get',
        `${path}?from=2026-11-01&to=2026-02-30&siteId=nope`,
        admin,
      );
      expect([path, bad.status]).toEqual([path, 400]);
      expect(
        problem(bad)
          .errors?.map((e) => e.field)
          .sort(),
      ).toEqual(['siteId', 'to']);
      const after = await fx.http(
        'get',
        `${path}?from=2026-11-10&to=2026-11-01`,
        admin,
      );
      expect([path, after.status]).toEqual([path, 422]);
      expect(problem(after).errors?.map((e) => e.field)).toEqual(['from']);
      const long = await fx.http(
        'get',
        `${path}?from=2025-11-01&to=2026-11-02`,
        admin,
      );
      expect([path, long.status]).toEqual([path, 422]);
      expect(problem(long).errors?.map((e) => e.field)).toEqual(['to']);
      // 366 días (2025-11-02..2026-11-02) es válido.
      const max = await fx.http(
        'get',
        `${path}?from=2025-11-02&to=2026-11-02`,
        admin,
      );
      expect([path, max.status]).toEqual([path, 200]);
    }
    expect((await exports()).length).toBe(before + 1);
  });

  it('R19: los logs del resumen y del CSV no llevan datos del paciente, motivos, nombres del personal ni el contenido del CSV', async () => {
    logger.lines.length = 0;
    const admin = await flow.token(staff.get('ADMIN')!);
    const summary = await fx
      .http('get', `/reports/summary?${QUERY}`, admin)
      .expect(200);
    const csv = await fx
      .http('get', `/reports/encounters.csv?${QUERY}`, admin)
      .expect(200);
    expect(
      (summary.body as { population: { encounters: number } }).population
        .encounters,
    ).toBe(1);
    expect(csv.text).toContain(encounterId);
    const text = logger.text();
    expect(text).toContain('report_summary_read');
    expect(text).toContain('report_csv_exported');
    for (const needle of [
      FULL_NAME,
      'Eustaquio',
      documentNumber,
      COMPLAINT,
      'quux-f07-privacy',
      REASON,
      'garply-f07-privacy',
      SITE_NAME,
      encounterId,
      ...[...staff.values()].map((s) => s.fullName),
      // Contenido del CSV: la cabecera y cualquier línea de datos.
      'encounter_id,site_name',
      ...csv.text.split('\r\n').filter(Boolean),
    ]) {
      expect([needle, text.includes(needle)]).toEqual([needle, false]);
    }
  });
});
