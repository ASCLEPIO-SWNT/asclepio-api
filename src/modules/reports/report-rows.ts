import type { EncounterStatus } from '../encounters/encounter-state-machine.js';
import { MAX_WAIT_MINUTES_BY_LEVEL } from '../queue/queue.rules.js';
import {
  confusionMatrix,
  type LevelPair,
  LEVELS,
  mean,
  median,
  p90,
  percent,
  weightedKappa,
} from './report-stats.js';

/**
 * Filas y resumen de los reportes (F-07-api, design.md): funciones puras sobre lo que leen los services de encounters,
 * triage y ai (D2). La unión se hace en memoria.
 */

export type DecisionAction = 'VALIDATE' | 'CORRECT' | 'MANUAL';
export type SuggestionStatus = 'OK' | 'INVALID_OUTPUT' | 'TIMEOUT' | 'FAILED';
export type LlmProvider = 'GROQ' | 'OPENROUTER';

export const DECISION_ACTIONS: readonly DecisionAction[] = [
  'VALIDATE',
  'CORRECT',
  'MANUAL',
];
export const SUGGESTION_STATUSES: readonly SuggestionStatus[] = [
  'OK',
  'INVALID_OUTPUT',
  'TIMEOUT',
  'FAILED',
];
export const LLM_PROVIDERS: readonly LlmProvider[] = ['GROQ', 'OPENROUTER'];

/** Nivel con tiempo numérico en la norma (Res. 5596 de 2015): el único con cumplimiento (R7, D3). */
export const COMPLIANCE_LEVEL = 2;
/** 30 min: la misma definición que usa la cola de F-06 (no se duplica). */
export const COMPLIANCE_MAX_MINUTES =
  MAX_WAIT_MINUTES_BY_LEVEL[COMPLIANCE_LEVEL];
/** Niveles con tiempo de triage a atención informado (R7): I (sin porcentaje) y II. */
export const TIME_TO_CARE_LEVELS = [1, 2] as const;

/** Atención de la población (EncountersService.listForReport). Sin datos del paciente ni motivo de consulta. */
export interface ReportEncounterSource {
  id: string;
  siteId: string;
  siteName: string;
  status: EncounterStatus;
  origin: 'PRE_REGISTRATION' | 'DIRECT';
  complaintSource: 'TYPED' | 'VOICE_ON_DEVICE';
  arrivalAt: Date;
  triagedAt: Date | null;
  finalLevel: number | null;
  /** occurred_at del STATUS_CHANGED a IN_CARE. */
  inCareAt: Date | null;
  /** occurred_at del STATUS_CHANGED a CLOSED. */
  closedAt: Date | null;
}

/** Decisión de triage (TriageDecisionsService.listByEncounters), sin motivo de corrección. */
export interface ReportDecisionSource {
  encounterId: string;
  action: DecisionAction;
  level: number;
  suggestionId: string | null;
}

/** Sugerencia (TriageSuggestionsService.listByEncounters), sin instantánea ni respuesta cruda. */
export interface ReportSuggestionSource {
  id: string;
  encounterId: string;
  status: SuggestionStatus;
  suggestedLevel: number | null;
  llmLevel: number | null;
  guardApplied: boolean;
  provider: LlmProvider | null;
  createdAt: Date;
}

/**
 * Una fila por atención (columnas de D6). Sin nombre, documento, motivo de consulta, motivo de corrección ni nombres
 * del personal (R13): la fila se identifica por el id de la atención.
 */
export interface ReportRow {
  encounterId: string;
  siteName: string;
  status: EncounterStatus;
  origin: ReportEncounterSource['origin'];
  complaintSource: ReportEncounterSource['complaintSource'];
  arrivalAt: Date;
  triagedAt: Date | null;
  inCareAt: Date | null;
  closedAt: Date | null;
  finalLevel: number | null;
  decisionAction: DecisionAction | null;
  suggestionStatus: SuggestionStatus | null;
  suggestedLevel: number | null;
  llmLevel: number | null;
  guardApplied: boolean | null;
  provider: LlmProvider | null;
  /** Llegada → triage, en minutos con decimales (sin redondear). */
  minutesToTriage: number | null;
  /** Triage → inicio de atención (Res. 256 de 2016), en minutos con decimales (sin redondear). */
  minutesTriageToCare: number | null;
  /** Solo en nivel II evaluable (llegó a IN_CARE): ≤ 30 min. null en el resto. */
  compliant: boolean | null;
}

const minutesBetween = (a: Date | null, b: Date | null): number | null =>
  a && b ? (b.getTime() - a.getTime()) / 60_000 : null;

/** Más reciente primero: mayor created_at y después mayor id (vigente, R21 de F-04). */
const newestFirst = (a: ReportSuggestionSource, b: ReportSuggestionSource) =>
  b.createdAt.getTime() - a.createdAt.getTime() ||
  (b.id > a.id ? 1 : b.id < a.id ? -1 : 0);

/**
 * Una ReportRow por atención, ordenadas por arrival_at y después por id (R11). La sugerencia de la fila es la
 * decidida (suggestion_id de la decisión) si la hay; si no (MANUAL o sin decisión), la vigente (D4).
 */
export function buildRows(
  encounters: readonly ReportEncounterSource[],
  decisions: readonly ReportDecisionSource[],
  suggestions: readonly ReportSuggestionSource[],
): ReportRow[] {
  const decisionBy = new Map(decisions.map((d) => [d.encounterId, d]));
  const suggestionById = new Map(suggestions.map((s) => [s.id, s]));
  const currentBy = new Map<string, ReportSuggestionSource>();
  for (const s of [...suggestions].sort(newestFirst)) {
    if (!currentBy.has(s.encounterId)) currentBy.set(s.encounterId, s);
  }
  return [...encounters]
    .sort(
      (a, b) =>
        a.arrivalAt.getTime() - b.arrivalAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((e) => {
      const d = decisionBy.get(e.id) ?? null;
      const s =
        (d?.suggestionId ? suggestionById.get(d.suggestionId) : undefined) ??
        currentBy.get(e.id) ??
        null;
      const toCare = e.triagedAt
        ? minutesBetween(e.triagedAt, e.inCareAt)
        : null;
      const evaluable =
        e.finalLevel === COMPLIANCE_LEVEL && e.triagedAt && toCare !== null;
      return {
        encounterId: e.id,
        siteName: e.siteName,
        status: e.status,
        origin: e.origin,
        complaintSource: e.complaintSource,
        arrivalAt: e.arrivalAt,
        triagedAt: e.triagedAt,
        inCareAt: e.inCareAt,
        closedAt: e.closedAt,
        finalLevel: e.finalLevel,
        decisionAction: d?.action ?? null,
        suggestionStatus: s?.status ?? null,
        suggestedLevel: s?.suggestedLevel ?? null,
        llmLevel: s?.llmLevel ?? null,
        guardApplied: s ? s.guardApplied : null,
        provider: s?.provider ?? null,
        minutesToTriage: minutesBetween(e.arrivalAt, e.triagedAt),
        minutesTriageToCare: toCare,
        compliant: evaluable ? toCare <= COMPLIANCE_MAX_MINUTES : null,
      };
    });
}

export interface CountPercent {
  count: number;
  percent: number | null;
}
export interface TimeStats {
  n: number;
  median: number | null;
  p90: number | null;
}

export interface ReportSummaryBody {
  population: { encounters: number; triaged: number };
  timeToTriage: {
    byLevel: (TimeStats & { level: number })[];
    total: TimeStats;
  };
  timeToCare: {
    byLevel: (TimeStats & { level: number; mean: number | null })[];
  };
  compliance: {
    level: number;
    maxMinutes: number;
    evaluable: number;
    compliant: number;
    percent: number | null;
    notEvaluated: number;
  };
  concordance: {
    pairs: number;
    exactAgreementPercent: number | null;
    weightedKappa: number | null;
    underTriagePercent: number | null;
    overTriagePercent: number | null;
    matrix: number[][];
  };
  fallback: {
    decisions: { total: number } & Record<DecisionAction, CountPercent>;
    suggestions: { total: number } & Record<SuggestionStatus, CountPercent>;
    providers: { total: number } & Record<LlmProvider, CountPercent>;
    guards: { total: number; applied: number; percent: number | null };
  };
}

const timeStats = (values: number[]): TimeStats => ({
  n: values.length,
  median: median(values),
  p90: p90(values),
});

function countBy<K extends string>(
  keys: readonly K[],
  values: readonly (K | null)[],
): { total: number } & Record<K, CountPercent> {
  const total = values.length;
  const out = { total } as { total: number } & Record<K, CountPercent>;
  for (const k of keys) {
    const count = values.filter((v) => v === k).length;
    (out as Record<K, CountPercent>)[k] = {
      count,
      percent: percent(count, total),
    };
  }
  return out;
}

/**
 * Resumen de R5–R10 sobre las filas de buildRows. `suggestions` son TODAS las sugerencias de la población (D4):
 * fallback.suggestions mide cada solicitud a la IA, no solo una por atención.
 */
export function summarize(
  rows: readonly ReportRow[],
  suggestions: readonly ReportSuggestionSource[],
): ReportSummaryBody {
  const triaged = rows.filter((r) => r.triagedAt && r.finalLevel !== null);
  const toTriage = (level?: number) =>
    triaged
      .filter((r) => level === undefined || r.finalLevel === level)
      .map((r) => r.minutesToTriage as number);

  const toCare = (level: number) =>
    triaged
      .filter((r) => r.finalLevel === level && r.minutesTriageToCare !== null)
      .map((r) => r.minutesTriageToCare as number);

  const levelII = triaged.filter((r) => r.finalLevel === COMPLIANCE_LEVEL);
  const evaluable = levelII.filter((r) => r.compliant !== null);
  const compliant = evaluable.filter((r) => r.compliant).length;

  const pairs: LevelPair[] = triaged
    .filter(
      (r) =>
        (r.decisionAction === 'VALIDATE' || r.decisionAction === 'CORRECT') &&
        r.suggestedLevel !== null,
    )
    .map((r) => [r.suggestedLevel as number, r.finalLevel as number]);
  const n = pairs.length;

  const ok = suggestions.filter((s) => s.status === 'OK');
  const applied = ok.filter((s) => s.guardApplied).length;

  return {
    population: { encounters: rows.length, triaged: triaged.length },
    timeToTriage: {
      byLevel: LEVELS.map((level) => ({
        level,
        ...timeStats(toTriage(level)),
      })),
      total: timeStats(toTriage()),
    },
    timeToCare: {
      byLevel: TIME_TO_CARE_LEVELS.map((level) => {
        const values = toCare(level);
        return { level, ...timeStats(values), mean: mean(values) };
      }),
    },
    compliance: {
      level: COMPLIANCE_LEVEL,
      maxMinutes: COMPLIANCE_MAX_MINUTES,
      evaluable: evaluable.length,
      compliant,
      percent: percent(compliant, evaluable.length),
      notEvaluated: levelII.length - evaluable.length,
    },
    concordance: {
      pairs: n,
      exactAgreementPercent: percent(
        pairs.filter(([s, f]) => s === f).length,
        n,
      ),
      weightedKappa: weightedKappa(pairs),
      underTriagePercent: percent(pairs.filter(([s, f]) => s > f).length, n),
      overTriagePercent: percent(pairs.filter(([s, f]) => s < f).length, n),
      matrix: confusionMatrix(pairs),
    },
    fallback: {
      decisions: countBy(
        DECISION_ACTIONS,
        triaged.map((r) => r.decisionAction),
      ),
      suggestions: countBy(
        SUGGESTION_STATUSES,
        suggestions.map((s) => s.status),
      ),
      providers: countBy(
        LLM_PROVIDERS,
        ok.map((s) => s.provider),
      ),
      guards: {
        total: ok.length,
        applied,
        percent: percent(applied, ok.length),
      },
    },
  };
}
