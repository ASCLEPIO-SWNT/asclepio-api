import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { createApp, problem } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { F02Fixtures, type Staff } from './int/f02-fixtures.js';
import { F03Fixtures } from './int/f03-fixtures.js';
import { CapturingLogger } from './int/fixtures.js';
import { insertSuggestion } from './int/f05-fixtures.js';

/** Motivo fácil de buscar como texto. */
const REASON = 'zz-motivo-privado-de-correccion paciente refiere disnea';

describe('F-05: privacidad, roles y errores de la decisión (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  const logger = new CapturingLogger();
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  let t: { id: string; siteId: string };
  let rec: Staff;
  let nurse: Staff;

  beforeAll(async () => {
    app = await createApp({
      logger,
      overrides: [
        { provide: GROQ_CLIENT, useValue: fake },
        { provide: OPENROUTER_CLIENT, useValue: fake },
      ],
    });
    fx = new F02Fixtures(app);
    f3 = new F03Fixtures(fx);
    t = await fx.tenant('f05-privacy');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
  });
  afterAll(() => app.close());

  const suggestion = (encounterId: string, suggestedLevel: number) =>
    insertSuggestion(fx.prisma, {
      tenantId: t.id,
      encounterId,
      requestedBy: nurse.id,
      createdAt: new Date(),
      suggestedLevel,
    });

  it('R21: el motivo y el nivel no aparecen en encounter_events.payload, audit_log.metadata ni en los logs del flujo', async () => {
    const id = await f3.encounter(t, rec);
    const sid = await suggestion(id, 4);
    logger.lines.length = 0;
    const res = await fx
      .http('post', `/encounters/${id}/triage-decision`, nurse.token)
      .send({ action: 'CORRECT', suggestionId: sid, level: 1, reason: REASON })
      .expect(201);
    const decisionId = (res.body as { id: string }).id;
    await fx
      .http('get', `/encounters/${id}/triage-decision`, nurse.token)
      .expect(200);

    const events = await fx.prisma.encounterEvent.findMany({
      where: { encounterId: id, type: 'TRIAGE_DECIDED' },
    });
    expect(events.map((e) => e.payload)).toEqual([
      { decisionId, action: 'CORRECT' },
    ]);
    const audits = await fx.prisma.auditLog.findMany({
      where: { action: 'TRIAGE_DECIDED', entityId: decisionId },
    });
    expect(audits.map((a) => a.metadata)).toEqual([
      { encounterId: id, action: 'CORRECT' },
    ]);

    const logs = logger.text();
    expect(logs).toContain('triage_decided');
    for (const text of [
      JSON.stringify(events.map((e) => e.payload)),
      JSON.stringify(audits.map((a) => a.metadata)),
      logs,
    ]) {
      expect(text).not.toContain('zz-motivo-privado');
      expect(text).not.toMatch(/"(level|finalLevel|suggestedLevel)"/);
    }
    // Sin el nivel ni como valor suelto: el log solo lleva ids, acción, tenant y usuario.
    const triageLogs = logger.lines.filter((l) => l.includes('triage_decid'));
    for (const line of triageLogs) {
      const [entry] = JSON.parse(line.slice(4)) as [Record<string, unknown>];
      expect(Object.keys(entry).sort()).toEqual(
        [
          'action',
          'decisionId',
          'encounterId',
          'msg',
          'tenantId',
          'userId',
        ].sort(),
      );
      expect(line).not.toMatch(/reason|level/i);
    }
  });

  it('R22: RECEPTION, ADMIN, PHYSICIAN (en el POST) y el paciente reciben 403 sin registrar nada; PHYSICIAN sí lee', async () => {
    const id = await f3.encounter(t, rec);
    await suggestion(id, 3);
    const physician = await fx.staff(t.id, 'PHYSICIAN');
    const admin = await fx.staff(t.id, 'ADMIN');
    const p = await fx.patientUser(t.id);
    for (const token of [rec.token, admin.token, physician.token, p.token]) {
      const res = await fx
        .http('post', `/encounters/${id}/triage-decision`, token)
        .send({ action: 'MANUAL', level: 3 })
        .expect(403);
      expect(problem(res).status).toBe(403);
    }
    for (const token of [rec.token, admin.token, p.token]) {
      await fx
        .http('get', `/encounters/${id}/triage-decision`, token)
        .expect(403);
    }
    await fx
      .http('post', `/encounters/${id}/triage-decision`, nurse.token)
      .send({ action: 'MANUAL', level: 3 })
      .expect(409); // hay una sugerencia válida (R8): sigue sin decisión
    expect(
      await fx.prisma.triageDecision.count({ where: { encounterId: id } }),
    ).toBe(0);
    expect(
      (await fx.prisma.encounter.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('WAITING_TRIAGE');
    await fx
      .http('get', `/encounters/${id}/triage-decision`, physician.token)
      .expect(404);
  });

  it('R23: todos los errores de F-05 son problem+json y no repiten el motivo ni los valores enviados', async () => {
    const id = await f3.encounter(t, rec);
    const sid = await suggestion(id, 3);
    const other = '6f1c1d2e-0000-4000-8000-00000000beef';
    const cases: [string, object, number][] = [
      [id, { action: 'MANUAL', level: 3, zzCampo: REASON }, 400],
      [
        id,
        { action: 'CORRECT', suggestionId: sid, level: 77, reason: REASON },
        422,
      ],
      [
        id,
        { action: 'CORRECT', suggestionId: sid, level: 3, reason: REASON },
        422,
      ],
      [
        id,
        { action: 'CORRECT', suggestionId: other, level: 2, reason: REASON },
        409,
      ],
      [id, { action: 'MANUAL', level: 4 }, 409],
      [
        other,
        { action: 'CORRECT', suggestionId: sid, level: 2, reason: REASON },
        404,
      ],
    ];
    for (const [enc, body, status] of cases) {
      const res = await fx
        .http('post', `/encounters/${enc}/triage-decision`, nurse.token)
        .send(body);
      expect([body, res.status]).toEqual([body, status]);
      const p = problem(res);
      const text = JSON.stringify([p.detail, p.errors]);
      expect(text).not.toContain('zz-motivo-privado');
      expect(text).not.toContain(other);
      expect(text).not.toContain(sid);
      expect(text).not.toContain('77');
    }
    const g = await fx
      .http('get', `/encounters/${id}/triage-decision`, nurse.token)
      .expect(404);
    expect(problem(g).status).toBe(404);
  });
});
