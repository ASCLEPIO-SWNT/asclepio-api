/**
 * Reglas puras de la decisión de triage (F-05-api, design.md): sin Nest ni Prisma. Reciben el cuerpo ya validado y
 * normalizado (forma en el DTO, rangos y motivo en validateDecisionBody) y la sugerencia vigente de la atención.
 */

export const TRIAGE_DECISION_ACTIONS = [
  'VALIDATE',
  'CORRECT',
  'MANUAL',
] as const;
export type TriageDecisionAction = (typeof TRIAGE_DECISION_ACTIONS)[number];

export type DecisionInput =
  | { action: 'VALIDATE'; suggestionId: string }
  | { action: 'CORRECT'; suggestionId: string; level: number; reason: string }
  | { action: 'MANUAL'; level: number };

/** Sugerencia vigente (R21 de F-04): la de mayor created_at y después mayor id. */
export interface CurrentSuggestion {
  id: string;
  status: 'OK' | 'INVALID_OUTPUT' | 'TIMEOUT' | 'FAILED';
  /** Nivel ya ajustado por los SafetyGuards (PA-F05-3); null si status ≠ OK. */
  suggestedLevel: number | null;
}

export interface Decided {
  action: TriageDecisionAction;
  level: number;
  suggestionId: string | null;
  /** Nivel sugerido de la sugerencia decidida (null en MANUAL), para la respuesta (R15). */
  suggestedLevel: number | null;
  reason: string | null;
}

/** NOT_CURRENT_OR_INVALID → 409 (R7) · HAS_VALID_SUGGESTION → 409 (R8) · SAME_AS_SUGGESTED → 422 (R6). */
export type DecisionError =
  'NOT_CURRENT_OR_INVALID' | 'HAS_VALID_SUGGESTION' | 'SAME_AS_SUGGESTED';

export type DecisionResult =
  { ok: true; decision: Decided } | { ok: false; error: DecisionError };

/** Aplica R1–R3 y R6–R8, con R7/R8 (409) antes que R6 (422), como fija D5. */
export function decide(
  input: DecisionInput,
  current: CurrentSuggestion | null,
): DecisionResult {
  const valid =
    current && current.status === 'OK' && current.suggestedLevel !== null
      ? { id: current.id, suggestedLevel: current.suggestedLevel }
      : null;
  if (input.action === 'MANUAL') {
    if (valid) return { ok: false, error: 'HAS_VALID_SUGGESTION' };
    return {
      ok: true,
      decision: {
        action: 'MANUAL',
        level: input.level,
        suggestionId: null,
        suggestedLevel: null,
        reason: null,
      },
    };
  }
  if (!valid || valid.id !== input.suggestionId) {
    return { ok: false, error: 'NOT_CURRENT_OR_INVALID' };
  }
  if (input.action === 'VALIDATE') {
    return {
      ok: true,
      decision: {
        action: 'VALIDATE',
        level: valid.suggestedLevel,
        suggestionId: valid.id,
        suggestedLevel: valid.suggestedLevel,
        reason: null,
      },
    };
  }
  if (input.level === valid.suggestedLevel) {
    return { ok: false, error: 'SAME_AS_SUGGESTED' };
  }
  return {
    ok: true,
    decision: {
      action: 'CORRECT',
      level: input.level,
      suggestionId: valid.id,
      suggestedLevel: valid.suggestedLevel,
      reason: input.reason,
    },
  };
}
