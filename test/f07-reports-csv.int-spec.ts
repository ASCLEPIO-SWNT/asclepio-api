import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { createApp } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { F02Fixtures } from './int/f02-fixtures.js';
import {
  F07Flow,
  insertSuggestionAsOwner,
  type OwnerSuggestion,
  RAW_MARKER,
  SNAPSHOT_MARKER,
  type StaffRef,
} from './int/f07-fixtures.js';

const d4 = (hhmm: string) => new Date(`2026-11-04T${hhmm}:00-05:00`);
const REPORT_AT = new Date('2026-11-12T15:00:00.000Z');
const FROM = '2026-11-01';
const TO = '2026-11-10';
const QUERY = `from=${FROM}&to=${TO}`;
const FULL_NAME = 'DEV-test Wenceslao Pérez Ortiz';
const COMPLAINT = 'DEV-test cefalea pulsátil xyzzy-f07-csv';
const REASON = 'DEV-test motivo de corrección plugh-f07-csv';
/** Sede cuyo nombre empieza por '=' (R14): en el CSV va precedido de comilla simple y, por la coma, entre comillas. */
const FORMULA_SITE = '=DEV-test HYPERLINK("x",1)';

/** Celdas de un CSV RFC 4180 (comillas dobles, comillas duplicadas, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  return rows;
}

function records(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const countOf = (rows: Record<string, string>[], col: string, value: string) =>
  rows.filter((r) => r[col] === value).length;

/** F-07-api · T7: GET /reports/encounters.csv (integración). */
describe('F-07: GET /reports/encounters.csv (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let flow: F07Flow;
  const clock = new FixedClock(d4('07:00'));
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  let t: { id: string; siteId: string; siteName: string };
  let formulaSite: { id: string; name: string };
  let admin: StaffRef;
  let staffNames: string[];
  let documentNumber: string;
  const e: Record<string, string> = {};

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: GROQ_CLIENT, useValue: fake },
        { provide: OPENROUTER_CLIENT, useValue: fake },
      ],
    });
    fx = new F02Fixtures(app);
    flow = new F07Flow(app, fx, clock);
    t = await fx.tenant('f07-csv');
    formulaSite = await fx.site(t.id, FORMULA_SITE);
    const other = await fx.tenant('f07-csv-otro');
    const rec = await flow.staff(t.id, 'RECEPTION');
    const nurse = await flow.staff(t.id, 'NURSE');
    const doc = await flow.staff(t.id, 'PHYSICIAN');
    admin = await flow.staff(t.id, 'ADMIN');
    staffNames = [rec, nurse, doc, admin].map((s) => s.fullName);
    const F = { id: t.id, siteId: formulaSite.id };
    const sug = (
      encounterId: string,
      at: string,
      over: Partial<OwnerSuggestion> = {},
    ) =>
      insertSuggestionAsOwner({
        tenantId: t.id,
        encounterId,
        requestedBy: nurse.id,
        createdAt: d4(at),
        ...over,
      });

    // c1: paciente con nombre y documento conocidos, motivo conocido; CORRECT con motivo; IN_CARE a los 25 min.
    e.c1 = await flow.arrive(d4('08:00'), t, rec, {
      fullName: FULL_NAME,
      complaint: COMPLAINT,
    });
    const s1 = await sug(e.c1, '08:02', { suggestedLevel: 3 });
    await flow.decide(e.c1, d4('08:10'), nurse, {
      action: 'CORRECT',
      suggestionId: s1,
      level: 2,
      reason: REASON,
    });
    await flow.move(e.c1, 'start-care', d4('08:35'), doc);
    // c2: sede con fórmula, VALIDATE con guard por OPENROUTER, nivel II, IN_CARE a los 40 min (no cumple) y CLOSED.
    e.c2 = await flow.arrive(d4('09:00'), F, rec);
    const s2 = await sug(e.c2, '09:01', {
      suggestedLevel: 2,
      llmLevel: 3,
      provider: 'OPENROUTER',
    });
    await flow.decide(e.c2, d4('09:04'), nurse, {
      action: 'VALIDATE',
      suggestionId: s2,
    });
    await flow.move(e.c2, 'start-care', d4('09:44'), doc);
    await flow.move(e.c2, 'close', d4('10:00'), doc);
    // c3: MANUAL tras un TIMEOUT.
    e.c3 = await flow.arrive(d4('10:00'), t, rec);
    await sug(e.c3, '10:01', { status: 'TIMEOUT' });
    await flow.decide(e.c3, d4('10:03'), nurse, { action: 'MANUAL', level: 4 });
    // c4: esperando triage con INVALID_OUTPUT; c5: cancelada sin sugerencias.
    e.c4 = await flow.arrive(d4('11:00'), t, rec);
    await sug(e.c4, '11:01', { status: 'INVALID_OUTPUT' });
    e.c5 = await flow.arrive(d4('12:00'), t, rec);
    await flow.move(e.c5, 'cancel', d4('12:30'), rec);
    // Otro tenant y fuera del periodo: no salen.
    const oRec = await flow.staff(other.id, 'RECEPTION');
    e.other = await flow.arrive(d4('08:00'), other, oRec);
    e.after = await flow.arrive(new Date('2026-11-11T00:00:00-05:00'), t, rec);

    documentNumber = (
      await fx.prisma.encounter.findUniqueOrThrow({
        where: { id: e.c1 },
        select: { patient: { select: { documentNumber: true } } },
      })
    ).patient.documentNumber!;
  });
  afterAll(() => app.close());

  async function csv(query = QUERY) {
    clock.set(REPORT_AT);
    return fx
      .http('get', `/reports/encounters.csv?${query}`, await flow.token(admin))
      .expect(200);
  }

  it('R11: 200 con text/csv; charset=utf-8, Content-Disposition con el nombre del archivo y una fila por atención ordenada por llegada', async () => {
    const res = await csv();
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="asclepio-atenciones-${FROM}_${TO}.csv"`,
    );
    const rows = records(res.text);
    expect(rows.map((r) => r.encounter_id)).toEqual([
      e.c1,
      e.c2,
      e.c3,
      e.c4,
      e.c5,
    ]);
    expect(res.text.split('\r\n')[0].split(',')[0]).toBe('encounter_id');
    expect(res.text.endsWith('\r\n')).toBe(true);
    // Contenido de la fila de c2 (horas en Bogotá, minutos con 1 decimal, no cumple: 40 > 30).
    expect(rows[1]).toEqual({
      encounter_id: e.c2,
      site_name: `'${FORMULA_SITE}`,
      status: 'CLOSED',
      origin: 'DIRECT',
      complaint_source: 'TYPED',
      arrival_at: '2026-11-04T09:00:00-05:00',
      triaged_at: '2026-11-04T09:04:00-05:00',
      in_care_at: '2026-11-04T09:44:00-05:00',
      closed_at: '2026-11-04T10:00:00-05:00',
      final_level: '2',
      decision_action: 'VALIDATE',
      suggestion_status: 'OK',
      suggested_level: '2',
      llm_level: '3',
      guard_applied: 'true',
      provider: 'OPENROUTER',
      minutes_to_triage: '4.0',
      minutes_triage_to_care: '40.0',
      compliant: 'false',
    });
    expect(rows[0]).toMatchObject({
      compliant: 'true',
      minutes_triage_to_care: '25.0',
    });
    // R14 en el texto crudo: la celda neutralizada va entre comillas (lleva coma) con las comillas duplicadas.
    expect(res.text).toContain(`,"'=DEV-test HYPERLINK(""x"",1)",`);
    // Con siteId, solo esa sede.
    const only = records((await csv(`${QUERY}&siteId=${formulaSite.id}`)).text);
    expect(only.map((r) => r.encounter_id)).toEqual([e.c2]);
  });

  it('R13: el CSV no contiene el nombre, el documento, el motivo de consulta, el motivo de corrección ni los nombres del personal', async () => {
    const text = (await csv()).text;
    for (const needle of [
      FULL_NAME,
      'Wenceslao',
      documentNumber,
      COMPLAINT,
      'xyzzy-f07-csv',
      REASON,
      'plugh-f07-csv',
      ...staffNames,
      RAW_MARKER,
      SNAPSHOT_MARKER,
      admin.id,
    ]) {
      expect([needle, text.includes(needle)]).toEqual([needle, false]);
    }
    expect(text).not.toContain(e.other);
    expect(text).not.toContain(e.after);
  });

  it('R15: cada CSV registra REPORT_EXPORTED (STAFF, actor, tenant, entity report, sin entity_id) con { from, to, siteId, rows }', async () => {
    const before = (
      await fx.audits({ tenantId: t.id, action: 'REPORT_EXPORTED' })
    ).length;
    await csv();
    await csv(`${QUERY}&siteId=${formulaSite.id}`);
    const audits = (
      await fx.audits({ tenantId: t.id, action: 'REPORT_EXPORTED' })
    ).slice(before);
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      action: 'REPORT_EXPORTED',
      actorType: 'STAFF',
      actorId: admin.id,
      tenantId: t.id,
      entity: 'report',
      entityId: null,
      occurredAt: REPORT_AT,
      metadata: { from: FROM, to: TO, siteId: null, rows: 5 },
    });
    expect(audits[1].metadata).toEqual({
      from: FROM,
      to: TO,
      siteId: formulaSite.id,
      rows: 1,
    });
    // El resumen no se audita (D8).
    clock.set(REPORT_AT);
    await fx
      .http('get', `/reports/summary?${QUERY}`, await flow.token(admin))
      .expect(200);
    expect(
      (await fx.audits({ tenantId: t.id, action: 'REPORT_EXPORTED' })).length,
    ).toBe(before + 2);
  });

  it('R16: filas del CSV = population.encounters y los conteos de final_level, decision_action, suggestion_status y compliant cuadran con el resumen', async () => {
    for (const query of [QUERY, `${QUERY}&siteId=${formulaSite.id}`]) {
      const rows = records((await csv(query)).text);
      clock.set(REPORT_AT);
      const s = (
        await fx
          .http('get', `/reports/summary?${query}`, await flow.token(admin))
          .expect(200)
      ).body as {
        population: { encounters: number; triaged: number };
        timeToTriage: { byLevel: { level: number; n: number }[] };
        compliance: { evaluable: number; compliant: number };
        concordance: { pairs: number };
        fallback: {
          decisions: Record<string, { count: number }>;
          suggestions: Record<string, { count: number }> & { total: number };
        };
      };
      expect([query, rows.length]).toEqual([query, s.population.encounters]);
      expect(rows.filter((r) => r.triaged_at !== '').length).toBe(
        s.population.triaged,
      );
      for (const { level, n } of s.timeToTriage.byLevel) {
        expect([
          query,
          level,
          countOf(rows, 'final_level', String(level)),
        ]).toEqual([query, level, n]);
      }
      for (const action of ['VALIDATE', 'CORRECT', 'MANUAL']) {
        expect(countOf(rows, 'decision_action', action)).toBe(
          s.fallback.decisions[action].count,
        );
      }
      // Una sola sugerencia por atención en este conjunto: los estados del CSV son todas las sugerencias.
      for (const status of ['OK', 'INVALID_OUTPUT', 'TIMEOUT', 'FAILED']) {
        expect(countOf(rows, 'suggestion_status', status)).toBe(
          s.fallback.suggestions[status].count,
        );
      }
      expect(rows.filter((r) => r.suggestion_status !== '').length).toBe(
        s.fallback.suggestions.total,
      );
      expect(
        rows.filter(
          (r) =>
            ['VALIDATE', 'CORRECT'].includes(r.decision_action) &&
            r.suggested_level !== '',
        ).length,
      ).toBe(s.concordance.pairs);
      expect(countOf(rows, 'compliant', 'true')).toBe(s.compliance.compliant);
      expect(rows.filter((r) => r.compliant !== '').length).toBe(
        s.compliance.evaluable,
      );
    }
  });
});
