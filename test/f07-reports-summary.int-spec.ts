import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { MAX_WAIT_MINUTES_BY_LEVEL } from '../src/modules/queue/queue.rules.js';
import { createApp } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { F02Fixtures } from './int/f02-fixtures.js';
import { F03Fixtures } from './int/f03-fixtures.js';
import {
  F07Flow,
  insertSuggestionAsOwner,
  type OwnerSuggestion,
  type StaffRef,
} from './int/f07-fixtures.js';

/** Hora de Bogotá (−05:00) del 2026-11-03. */
const d3 = (hhmm: string) => new Date(`2026-11-03T${hhmm}:00-05:00`);
const REPORT_AT = new Date('2026-11-12T15:00:00.000Z');
const QUERY = 'from=2026-11-01&to=2026-11-10';

const zero = { count: 0, percent: null };

/**
 * F-07-api · T6: GET /reports/summary sobre un conjunto preparado por la API real (FixedClock) en dos sedes y dos
 * tenants, con atenciones en todos los estados, las tres acciones y los cuatro estados de sugerencia. Las sugerencias
 * se insertan como dueño de la base local: ninguna prueba llama a un LLM real.
 *
 * Conjunto (tenant t, periodo 2026-11-01..2026-11-10, todas el 2026-11-03 en hora de Bogotá):
 *
 * | id | sede | llegada | sugerencias (hora)                   | decisión (hora)       | IN_CARE | estado         |
 * |----|------|---------|--------------------------------------|-----------------------|---------|----------------|
 * | a1 | A    | 08:00   | OK 2/2 GROQ (08:05)                  | VALIDATE → 2 (08:10)  | 08:30   | CLOSED (09:00) |
 * | a2 | A    | 09:00   | OK 3/3 GROQ (09:02)                  | CORRECT → 2 (09:15)   | 09:46   | IN_CARE        |
 * | a3 | A    | 10:00   | TIMEOUT (10:01), FAILED (10:02)      | MANUAL → 1 (10:05)    | 10:07   | IN_CARE        |
 * | a4 | A    | 11:00   | OK 3/4 OPENROUTER, guard (11:03)     | VALIDATE → 3 (11:20)  | —       | TRIAGED        |
 * | a5 | A    | 12:00   | INVALID_OUTPUT (12:01)               | —                     | —       | WAITING_TRIAGE |
 * | a6 | A    | 13:00   | —                                    | —                     | —       | CANCELLED      |
 * | a7 | A    | 16:00   | —                                    | —                     | —       | REGISTERED     |
 * | b1 | B    | 14:00   | OK 2/2 GROQ (14:01), OK 5/5 (14:40)  | CORRECT → 3 (14:30)   | —       | TRIAGED        |
 * | b2 | B    | 15:00   | OK 2/2 GROQ (15:01)                  | VALIDATE → 2 (15:12)  | —       | TRIAGED        |
 *
 * Fuera: una atención de t que llega el 2026-11-11 00:00 de Bogotá y una del otro tenant dentro del periodo.
 */
describe('F-07: GET /reports/summary (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  let flow: F07Flow;
  const clock = new FixedClock(d3('07:00'));
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  let t: { id: string; siteId: string; siteName: string };
  let siteB: { id: string; name: string };
  let other: { id: string; siteId: string; siteName: string };
  let admin: StaffRef;
  let otherAdmin: StaffRef;

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: GROQ_CLIENT, useValue: fake },
        { provide: OPENROUTER_CLIENT, useValue: fake },
      ],
    });
    fx = new F02Fixtures(app);
    f3 = new F03Fixtures(fx);
    flow = new F07Flow(app, fx, clock);
    t = await fx.tenant('f07-summary');
    siteB = await fx.site(t.id, 'DEV-test Sede Sur');
    other = await fx.tenant('f07-summary-otro');
    const rec = await flow.staff(t.id, 'RECEPTION');
    const nurse = await flow.staff(t.id, 'NURSE');
    const doc = await flow.staff(t.id, 'PHYSICIAN');
    admin = await flow.staff(t.id, 'ADMIN');
    otherAdmin = await flow.staff(other.id, 'ADMIN');
    const B = { id: t.id, siteId: siteB.id };

    const sug = (
      encounterId: string,
      at: string,
      over: Partial<OwnerSuggestion> = {},
    ) =>
      insertSuggestionAsOwner({
        tenantId: t.id,
        encounterId,
        requestedBy: nurse.id,
        createdAt: d3(at),
        ...over,
      });

    const a1 = await flow.arrive(d3('08:00'), t, rec);
    const s1 = await sug(a1, '08:05', { suggestedLevel: 2 });
    await flow.decide(a1, d3('08:10'), nurse, {
      action: 'VALIDATE',
      suggestionId: s1,
    });
    await flow.move(a1, 'start-care', d3('08:30'), doc);
    await flow.move(a1, 'close', d3('09:00'), doc);

    const a2 = await flow.arrive(d3('09:00'), t, rec);
    const s2 = await sug(a2, '09:02', { suggestedLevel: 3 });
    await flow.decide(a2, d3('09:15'), nurse, {
      action: 'CORRECT',
      suggestionId: s2,
      level: 2,
      reason: 'DEV-test motivo de corrección summary',
    });
    await flow.move(a2, 'start-care', d3('09:46'), doc);

    const a3 = await flow.arrive(d3('10:00'), t, rec);
    await sug(a3, '10:01', { status: 'TIMEOUT' });
    await sug(a3, '10:02', { status: 'FAILED' });
    await flow.decide(a3, d3('10:05'), nurse, { action: 'MANUAL', level: 1 });
    await flow.move(a3, 'start-care', d3('10:07'), doc);

    const a4 = await flow.arrive(d3('11:00'), t, rec);
    const s4 = await sug(a4, '11:03', {
      suggestedLevel: 3,
      llmLevel: 4,
      provider: 'OPENROUTER',
    });
    await flow.decide(a4, d3('11:20'), nurse, {
      action: 'VALIDATE',
      suggestionId: s4,
    });

    const a5 = await flow.arrive(d3('12:00'), t, rec);
    await sug(a5, '12:01', { status: 'INVALID_OUTPUT' });

    const a6 = await flow.arrive(d3('13:00'), t, rec);
    await flow.move(a6, 'cancel', d3('13:10'), rec);

    const a7 = await flow.arrive(d3('16:00'), t, rec);
    await f3.setStatus(a7, 'REGISTERED');

    const b1 = await flow.arrive(d3('14:00'), B, rec);
    const sb1 = await sug(b1, '14:01', { suggestedLevel: 2 });
    await flow.decide(b1, d3('14:30'), nurse, {
      action: 'CORRECT',
      suggestionId: sb1,
      level: 3,
      reason: 'DEV-test motivo de corrección summary',
    });
    // Sugerencia más reciente que la decidida (D4): la concordancia usa la decidida (2), no esta (5).
    await sug(b1, '14:40', { suggestedLevel: 5 });

    const b2 = await flow.arrive(d3('15:00'), B, rec);
    const sb2 = await sug(b2, '15:01', { suggestedLevel: 2 });
    await flow.decide(b2, d3('15:12'), nurse, {
      action: 'VALIDATE',
      suggestionId: sb2,
    });

    // Fuera del periodo (00:00 de Bogotá del día siguiente a to) y de otro tenant.
    await flow.arrive(new Date('2026-11-11T00:00:00-05:00'), t, rec);
    const oRec = await flow.staff(other.id, 'RECEPTION');
    const oNurse = await flow.staff(other.id, 'NURSE');
    const o1 = await flow.arrive(d3('08:00'), other, oRec);
    const so1 = await insertSuggestionAsOwner({
      tenantId: other.id,
      encounterId: o1,
      requestedBy: oNurse.id,
      createdAt: d3('08:01'),
      suggestedLevel: 1,
      provider: 'OPENROUTER',
    });
    await flow.decide(o1, d3('08:05'), oNurse, {
      action: 'CORRECT',
      suggestionId: so1,
      level: 5,
      reason: 'DEV-test motivo otro tenant',
    });
  });
  afterAll(() => app.close());

  async function summary(query: string, who: StaffRef = admin) {
    clock.set(REPORT_AT);
    const res = await fx
      .http('get', `/reports/summary?${query}`, await flow.token(who))
      .expect(200);
    return res.body as Record<string, unknown> & {
      population: { encounters: number; triaged: number };
    };
  }

  it('R5: ADMIN recibe 200 con period, generatedAt, population y los bloques de R6–R9', async () => {
    const body = await summary(QUERY);
    expect(Object.keys(body).sort()).toEqual(
      [
        'period',
        'generatedAt',
        'population',
        'timeToTriage',
        'timeToCare',
        'compliance',
        'concordance',
        'fallback',
      ].sort(),
    );
    expect(body.period).toEqual({
      from: '2026-11-01',
      to: '2026-11-10',
      siteId: null,
    });
    // 9 atenciones del tenant en el periodo (en todos los estados); 6 triadas.
    expect(body.population).toEqual({ encounters: 9, triaged: 6 });
  });

  it('R6: timeToTriage por nivel final y total (n, mediana, p90 de llegada → triage)', async () => {
    const body = await summary(QUERY);
    // I: a3 5 · II: a1 10, b2 12, a2 15 · III: a4 20, b1 30.
    // Total [5, 10, 12, 15, 20, 30]: mediana (12 + 15) / 2 = 13,5; p90 = posición ceil(5,4) = 6 → 30.
    expect(body.timeToTriage).toEqual({
      byLevel: [
        { level: 1, n: 1, median: 5, p90: 5 },
        { level: 2, n: 3, median: 12, p90: 15 },
        { level: 3, n: 2, median: 25, p90: 30 },
        { level: 4, n: 0, median: null, p90: null },
        { level: 5, n: 0, median: null, p90: null },
      ],
      total: { n: 6, median: 13.5, p90: 30 },
    });
  });

  it('R7: timeToCare de I y II (triage → IN_CARE, Res. 256 de 2016) y cumplimiento solo de II con 30 min', async () => {
    const body = await summary(QUERY);
    // I: a3 10:05 → 10:07 = 2. II: a1 08:10 → 08:30 = 20 y a2 09:15 → 09:46 = 31 (no cumple). b2 sin IN_CARE.
    expect(body.timeToCare).toEqual({
      byLevel: [
        { level: 1, n: 1, median: 2, p90: 2, mean: 2 },
        { level: 2, n: 2, median: 25.5, p90: 31, mean: 25.5 },
      ],
    });
    expect(body.compliance).toEqual({
      level: 2,
      maxMinutes: MAX_WAIT_MINUTES_BY_LEVEL[2],
      evaluable: 2,
      compliant: 1,
      percent: 50,
      notEvaluated: 1,
    });
  });

  it('R8: concordancia con la sugerencia decidida (no la vigente) y solo VALIDATE/CORRECT', async () => {
    const body = await summary(QUERY);
    /*
     * Pares (sugerido, final): a1 (2,2), a2 (3,2), a4 (3,3), b1 (2,3) [decidida 2, no la vigente 5], b2 (2,2).
     * a3 (MANUAL) no cuenta. r = (0,3,2,0,0), c = (0,3,2,0,0), n = 5.
     * Σw·O = 1 + 1 = 2. Σw·E = (1/5)·[3·(3·0 + 2·1) + 2·(3·1 + 2·0)] = (6 + 6) / 5 = 2,4.
     * κ = 1 − 2 / 2,4 = 0,1666… → 0,167. Exacto 3/5 = 60 %; sub (3,2) 1/5 = 20 %; sobre (2,3) 1/5 = 20 %.
     */
    expect(body.concordance).toEqual({
      pairs: 5,
      exactAgreementPercent: 60,
      weightedKappa: 0.167,
      underTriagePercent: 20,
      overTriagePercent: 20,
      matrix: [
        [0, 0, 0, 0, 0],
        [0, 2, 1, 0, 0],
        [0, 1, 1, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ],
    });
  });

  it('R9: fallback por acción, por estado (todas las sugerencias), por proveedor y guard (entre las OK)', async () => {
    const body = await summary(QUERY);
    // Sugerencias: a1 OK, a2 OK, a3 TIMEOUT + FAILED, a4 OK (OPENROUTER, guard), a5 INVALID_OUTPUT, b1 OK + OK, b2 OK.
    expect(body.fallback).toEqual({
      decisions: {
        total: 6,
        VALIDATE: { count: 3, percent: 50 },
        CORRECT: { count: 2, percent: 33.3 },
        MANUAL: { count: 1, percent: 16.7 },
      },
      suggestions: {
        total: 9,
        OK: { count: 6, percent: 66.7 },
        INVALID_OUTPUT: { count: 1, percent: 11.1 },
        TIMEOUT: { count: 1, percent: 11.1 },
        FAILED: { count: 1, percent: 11.1 },
      },
      providers: {
        total: 6,
        GROQ: { count: 5, percent: 83.3 },
        OPENROUTER: { count: 1, percent: 16.7 },
      },
      guards: { total: 6, applied: 1, percent: 16.7 },
    });
  });

  it('R4: con siteId solo cuenta esa sede; una sede de otro tenant o inexistente → todo en cero o null', async () => {
    const b = await summary(`${QUERY}&siteId=${siteB.id}`);
    expect(b.period).toEqual({
      from: '2026-11-01',
      to: '2026-11-10',
      siteId: siteB.id,
    });
    expect(b.population).toEqual({ encounters: 2, triaged: 2 });
    // b1 (2,3) y b2 (2,2): r = (0,2,0,0,0), c = (0,1,1,0,0); Σw·O = 1; Σw·E = (1/2)·2·(1·0 + 1·1) = 1 → κ = 0.
    expect(b.concordance).toMatchObject({
      pairs: 2,
      exactAgreementPercent: 50,
      weightedKappa: 0,
      overTriagePercent: 50,
      underTriagePercent: 0,
    });
    expect(b.compliance).toMatchObject({
      evaluable: 0,
      percent: null,
      notEvaluated: 1,
    });

    for (const siteId of [
      other.siteId,
      '99999999-9999-4999-8999-999999999999',
    ]) {
      const empty = await summary(`${QUERY}&siteId=${siteId}`);
      expect(empty).toMatchObject({
        population: { encounters: 0, triaged: 0 },
        timeToTriage: {
          total: { n: 0, median: null, p90: null },
        },
        timeToCare: {
          byLevel: [
            { level: 1, n: 0, median: null, p90: null, mean: null },
            { level: 2, n: 0, median: null, p90: null, mean: null },
          ],
        },
        compliance: {
          level: 2,
          maxMinutes: 30,
          evaluable: 0,
          compliant: 0,
          percent: null,
          notEvaluated: 0,
        },
        concordance: {
          pairs: 0,
          exactAgreementPercent: null,
          weightedKappa: null,
          underTriagePercent: null,
          overTriagePercent: null,
        },
        fallback: {
          decisions: { total: 0, VALIDATE: zero, CORRECT: zero, MANUAL: zero },
          suggestions: {
            total: 0,
            OK: zero,
            INVALID_OUTPUT: zero,
            TIMEOUT: zero,
            FAILED: zero,
          },
          providers: { total: 0, GROQ: zero, OPENROUTER: zero },
          guards: { total: 0, applied: 0, percent: null },
        },
      });
    }
  });

  it('R10: generatedAt es la hora del FixedClock (una sola lectura del reloj), en ISO-8601 con Z', async () => {
    const body = await summary(QUERY);
    expect(body.generatedAt).toBe(REPORT_AT.toISOString());
  });

  it('R17: el ADMIN del otro tenant solo ve su atención', async () => {
    const body = await summary(QUERY, otherAdmin);
    expect(body.population).toEqual({ encounters: 1, triaged: 1 });
    expect(body.concordance).toMatchObject({ pairs: 1, weightedKappa: null });
  });
});
