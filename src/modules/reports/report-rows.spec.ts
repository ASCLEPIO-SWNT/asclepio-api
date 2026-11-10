import { MAX_WAIT_MINUTES_BY_LEVEL } from '../queue/queue.rules.js';
import {
  buildRows,
  type ReportDecisionSource,
  type ReportEncounterSource,
  type ReportSuggestionSource,
  summarize,
} from './report-rows.js';

const T0 = Date.parse('2026-11-10T13:00:00.000Z');
const MIN = 60_000;
const at = (min: number) => new Date(T0 + min * MIN);
const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let seq = 0;
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function enc(
  over: Partial<ReportEncounterSource> & { id: string },
): ReportEncounterSource {
  return {
    siteId: SITE,
    siteName: 'DEV-Sede Norte',
    status: 'WAITING_TRIAGE',
    origin: 'DIRECT',
    complaintSource: 'TYPED',
    arrivalAt: at(0),
    triagedAt: null,
    finalLevel: null,
    inCareAt: null,
    closedAt: null,
    ...over,
  };
}

/** Atención triada a los `toTriage` min de la llegada y, si `toCare` no es null, en IN_CARE `toCare` min después. */
function triaged(
  id: string,
  level: number,
  toTriage: number,
  toCare: number | null = null,
): ReportEncounterSource {
  return enc({
    id,
    status: toCare === null ? 'TRIAGED' : 'IN_CARE',
    triagedAt: at(toTriage),
    finalLevel: level,
    inCareAt: toCare === null ? null : at(toTriage + toCare),
  });
}

function sug(
  encounterId: string,
  over: Partial<ReportSuggestionSource> = {},
): ReportSuggestionSource {
  seq += 1;
  const status = over.status ?? 'OK';
  const ok = status === 'OK';
  return {
    id: uuid(seq),
    encounterId,
    status,
    suggestedLevel: ok ? 3 : null,
    llmLevel: ok ? 3 : null,
    guardApplied: false,
    provider: ok ? 'GROQ' : null,
    createdAt: at(seq),
    ...over,
  };
}

const dec = (
  encounterId: string,
  action: ReportDecisionSource['action'],
  level: number,
  suggestionId: string | null,
): ReportDecisionSource => ({ encounterId, action, level, suggestionId });

describe('report-rows (F-07-api)', () => {
  it('R6: minutos hasta triage (llegada → triage, con decimales) y estadísticos por nivel final y en total', () => {
    const encounters = [
      triaged('e1', 2, 10),
      triaged('e2', 2, 20.5),
      triaged('e3', 3, 45),
      enc({ id: 'e4' }), // sin triage: no cuenta
    ];
    const rows = buildRows(encounters, [], []);
    expect(rows.map((r) => r.minutesToTriage)).toEqual([10, 20.5, 45, null]);
    const s = summarize(rows, []);
    expect(s.population).toEqual({ encounters: 4, triaged: 3 });
    expect(s.timeToTriage.byLevel).toEqual([
      { level: 1, n: 0, median: null, p90: null },
      { level: 2, n: 2, median: 15.3, p90: 20.5 },
      { level: 3, n: 1, median: 45, p90: 45 },
      { level: 4, n: 0, median: null, p90: null },
      { level: 5, n: 0, median: null, p90: null },
    ]);
    expect(s.timeToTriage.total).toEqual({ n: 3, median: 20.5, p90: 45 });
  });

  it('R7: timeToCare de I y II (triage → atención, con media); cumplimiento solo de II con el 30 importado de queue.rules (30 cumple, 31 no), I sin porcentaje, no evaluable sin IN_CARE y III–V sin cumplimiento', () => {
    expect(MAX_WAIT_MINUTES_BY_LEVEL[2]).toBe(30);
    const encounters = [
      // Nivel II: la llegada es irrelevante; se cuenta desde triaged_at (Res. 256 de 2016).
      triaged('ii-30', 2, 90, 30), // 30 min de triage a atención → cumple (≤ 30)
      triaged('ii-31', 2, 5, 31), // 31 → no cumple
      triaged('ii-10', 2, 0, 10), // 10 → cumple
      triaged('ii-wait', 2, 3), // TRIAGED sin IN_CARE → notEvaluated
      enc({
        id: 'ii-cancel',
        status: 'CANCELLED',
        triagedAt: at(4),
        finalLevel: 2,
      }), // cancelada tras el triage → notEvaluated
      triaged('i-2', 1, 1, 2),
      triaged('i-5', 1, 1, 5),
      triaged('iii-60', 3, 1, 60),
      enc({
        id: 'iv-closed',
        status: 'CLOSED',
        triagedAt: at(1),
        finalLevel: 4,
        inCareAt: at(100),
        closedAt: at(200),
      }),
    ];
    const rows = buildRows(encounters, [], []);
    const byId = new Map(rows.map((r) => [r.encounterId, r]));
    expect(byId.get('ii-30')).toMatchObject({
      minutesTriageToCare: 30,
      compliant: true,
    });
    expect(byId.get('ii-31')).toMatchObject({
      minutesTriageToCare: 31,
      compliant: false,
    });
    expect(byId.get('ii-wait')).toMatchObject({
      minutesTriageToCare: null,
      compliant: null,
    });
    expect(byId.get('i-2')).toMatchObject({
      minutesTriageToCare: 2,
      compliant: null,
    });
    expect(byId.get('iii-60')).toMatchObject({
      minutesTriageToCare: 60,
      compliant: null,
    });
    expect(byId.get('iv-closed')).toMatchObject({
      minutesTriageToCare: 99,
      compliant: null,
    });

    const s = summarize(rows, []);
    expect(s.compliance).toEqual({
      level: 2,
      maxMinutes: MAX_WAIT_MINUTES_BY_LEVEL[2],
      evaluable: 3,
      compliant: 2,
      percent: 66.7,
      notEvaluated: 2,
    });
    expect(s.timeToCare.byLevel).toEqual([
      { level: 1, n: 2, median: 3.5, p90: 5, mean: 3.5 },
      { level: 2, n: 3, median: 30, p90: 31, mean: 23.7 },
    ]);
    // Sin evaluables: porcentaje null.
    expect(
      summarize(buildRows([triaged('x', 2, 1)], [], []), []).compliance,
    ).toEqual({
      level: 2,
      maxMinutes: 30,
      evaluable: 0,
      compliant: 0,
      percent: null,
      notEvaluated: 1,
    });
  });

  it('R8: concordancia solo con pares de VALIDATE/CORRECT (MANUAL y sin decisión no cuentan), con sub y sobreclasificación', () => {
    const encounters = [
      triaged('v1', 2, 1),
      triaged('v2', 3, 1),
      triaged('c-under', 2, 1), // la IA sugirió 3 (menos grave) y enfermería decidió 2 → subclasificación
      triaged('c-over', 4, 1), // la IA sugirió 3 (más grave) y enfermería decidió 4 → sobreclasificación
      triaged('m1', 1, 1), // MANUAL: sin par
      enc({ id: 'w1' }), // sin decisión: sin par, aunque tenga sugerencia OK
    ];
    const sv1 = sug('v1', { suggestedLevel: 2, llmLevel: 2 });
    const sv2 = sug('v2', { suggestedLevel: 3, llmLevel: 3 });
    const sUnder = sug('c-under', { suggestedLevel: 3, llmLevel: 3 });
    const sOver = sug('c-over', {
      suggestedLevel: 3,
      llmLevel: 4,
      guardApplied: true,
    });
    const sm1 = sug('m1', { status: 'FAILED' });
    const sw1 = sug('w1', { suggestedLevel: 5, llmLevel: 5 });
    const suggestions = [sv1, sv2, sUnder, sOver, sm1, sw1];
    const decisions = [
      dec('v1', 'VALIDATE', 2, sv1.id),
      dec('v2', 'VALIDATE', 3, sv2.id),
      dec('c-under', 'CORRECT', 2, sUnder.id),
      dec('c-over', 'CORRECT', 4, sOver.id),
      dec('m1', 'MANUAL', 1, null),
    ];
    const s = summarize(
      buildRows(encounters, decisions, suggestions),
      suggestions,
    );
    expect(s.concordance).toEqual({
      pairs: 4,
      exactAgreementPercent: 50,
      // Pares (2,2) (3,3) (3,2) (3,4): r = (0,1,3,0,0), c = (0,2,1,1,0); Σw·O = 1 + 1 = 2;
      // Σw·E = (1/4)·[1·(2·0 + 1·1 + 1·4) + 3·(2·1 + 1·0 + 1·1)] = (5 + 9) / 4 = 3,5 → κ = 1 − 2/3,5 = 0,429.
      weightedKappa: 0.429,
      underTriagePercent: 25,
      overTriagePercent: 25,
      matrix: [
        [0, 0, 0, 0, 0],
        [0, 1, 0, 0, 0],
        [0, 1, 1, 1, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ],
    });
  });

  it('D4: la fila usa la sugerencia decidida aunque haya una vigente más reciente; sin decisión o en MANUAL, la vigente (mayor created_at y después id)', () => {
    const decided = sug('a', {
      suggestedLevel: 2,
      llmLevel: 2,
      createdAt: at(1),
    });
    const newer = sug('a', {
      suggestedLevel: 4,
      llmLevel: 4,
      provider: 'OPENROUTER',
      createdAt: at(5),
    });
    const b1 = sug('b', { status: 'TIMEOUT', createdAt: at(7), id: uuid(900) });
    const b2 = sug('b', {
      status: 'INVALID_OUTPUT',
      createdAt: at(7),
      id: uuid(901),
    });
    const c1 = sug('c', { status: 'OK', createdAt: at(1) });
    const c2 = sug('c', { status: 'FAILED', createdAt: at(2) });
    const rows = buildRows(
      [triaged('a', 2, 1), enc({ id: 'b' }), triaged('c', 1, 1)],
      [dec('a', 'VALIDATE', 2, decided.id), dec('c', 'MANUAL', 1, null)],
      [newer, decided, b1, b2, c2, c1],
    );
    expect(rows[0]).toMatchObject({
      decisionAction: 'VALIDATE',
      suggestionStatus: 'OK',
      suggestedLevel: 2,
      llmLevel: 2,
      provider: 'GROQ',
    });
    // Mismo created_at: gana el mayor id.
    expect(rows[1]).toMatchObject({
      decisionAction: null,
      suggestionStatus: 'INVALID_OUTPUT',
      suggestedLevel: null,
      guardApplied: false,
    });
    expect(rows[2]).toMatchObject({
      decisionAction: 'MANUAL',
      suggestionStatus: 'FAILED',
    });
    // Sin ninguna sugerencia: todo vacío.
    expect(buildRows([enc({ id: 'z' })], [], [])[0]).toMatchObject({
      suggestionStatus: null,
      suggestedLevel: null,
      llmLevel: null,
      guardApplied: null,
      provider: null,
    });
    // Las filas van por arrival_at y después por id.
    expect(
      buildRows(
        [
          enc({ id: 'b', arrivalAt: at(2) }),
          enc({ id: 'c', arrivalAt: at(1) }),
          enc({ id: 'a', arrivalAt: at(2) }),
        ],
        [],
        [],
      ).map((r) => r.encounterId),
    ).toEqual(['c', 'a', 'b']);
  });

  it('R9: conteos y % por acción (entre las triadas), por estado (todas las sugerencias), por proveedor y con guard (entre las OK)', () => {
    const encounters = [
      triaged('v', 2, 1),
      triaged('c', 3, 1),
      triaged('m', 1, 1),
      triaged('m2', 1, 1),
      enc({ id: 'w' }),
    ];
    const sv = sug('v', { suggestedLevel: 2, llmLevel: 3, guardApplied: true });
    const sc = sug('c', {
      suggestedLevel: 4,
      llmLevel: 4,
      provider: 'OPENROUTER',
    });
    const suggestions = [
      sug('v', { status: 'TIMEOUT' }), // anterior a la decidida: también cuenta en el fallback
      sv,
      sc,
      sug('m', { status: 'FAILED' }),
      sug('m', { status: 'INVALID_OUTPUT' }),
      sug('w', { status: 'OK', provider: 'GROQ' }),
    ];
    const decisions = [
      dec('v', 'VALIDATE', 2, sv.id),
      dec('c', 'CORRECT', 3, sc.id),
      dec('m', 'MANUAL', 1, null),
      dec('m2', 'MANUAL', 1, null),
    ];
    const s = summarize(
      buildRows(encounters, decisions, suggestions),
      suggestions,
    );
    expect(s.fallback).toEqual({
      decisions: {
        total: 4,
        VALIDATE: { count: 1, percent: 25 },
        CORRECT: { count: 1, percent: 25 },
        MANUAL: { count: 2, percent: 50 },
      },
      suggestions: {
        total: 6,
        OK: { count: 3, percent: 50 },
        INVALID_OUTPUT: { count: 1, percent: 16.7 },
        TIMEOUT: { count: 1, percent: 16.7 },
        FAILED: { count: 1, percent: 16.7 },
      },
      providers: {
        total: 3,
        GROQ: { count: 2, percent: 66.7 },
        OPENROUTER: { count: 1, percent: 33.3 },
      },
      guards: { total: 3, applied: 1, percent: 33.3 },
    });
  });

  it('R10: población vacía → conteos en 0 y estadísticos y porcentajes en null', () => {
    const s = summarize([], []);
    expect(s.population).toEqual({ encounters: 0, triaged: 0 });
    expect(s.timeToTriage.total).toEqual({ n: 0, median: null, p90: null });
    expect(s.compliance.percent).toBeNull();
    expect(s.concordance).toMatchObject({
      pairs: 0,
      exactAgreementPercent: null,
      weightedKappa: null,
      underTriagePercent: null,
      overTriagePercent: null,
    });
    expect(s.fallback.decisions.VALIDATE).toEqual({ count: 0, percent: null });
    expect(s.fallback.guards).toEqual({ total: 0, applied: 0, percent: null });
  });
});
