import {
  type CurrentSuggestion,
  decide,
  type DecisionInput,
} from './triage-decision.rules.js';

const S1 = '6f1c1d2e-0000-4000-8000-000000000001';
const S2 = '6f1c1d2e-0000-4000-8000-000000000002';

const ok = (suggestedLevel: number, id = S1): CurrentSuggestion => ({
  id,
  status: 'OK',
  suggestedLevel,
});
const failed = (
  status: 'INVALID_OUTPUT' | 'TIMEOUT' | 'FAILED',
  id = S1,
): CurrentSuggestion => ({ id, status, suggestedLevel: null });

const validate: DecisionInput = { action: 'VALIDATE', suggestionId: S1 };
const correct = (level: number, suggestionId = S1): DecisionInput => ({
  action: 'CORRECT',
  suggestionId,
  level,
  reason: 'DEV-test dolor irradiado',
});
const manual = (level: number): DecisionInput => ({ action: 'MANUAL', level });

describe('decide (reglas puras de la decisión de triage)', () => {
  it('R1: VALIDATE toma el nivel sugerido de la sugerencia vigente válida, sin motivo', () => {
    expect(decide(validate, ok(3))).toEqual({
      ok: true,
      decision: {
        action: 'VALIDATE',
        level: 3,
        suggestionId: S1,
        suggestedLevel: 3,
        reason: null,
      },
    });
  });

  it('R1: VALIDATE toma el nivel ya ajustado por un guard (suggestedLevel 2 aunque el LLM dijera 4, PA-F05-3)', () => {
    // La sugerencia vigente guarda llm_level 4 y suggested_level 2: decide solo ve el nivel sugerido (ajustado).
    const r = decide(validate, ok(2));
    expect(r).toMatchObject({ ok: true, decision: { level: 2 } });
  });

  it('R2: CORRECT fija un nivel distinto del sugerido con su motivo y conserva el nivel sugerido', () => {
    expect(decide(correct(1), ok(3))).toEqual({
      ok: true,
      decision: {
        action: 'CORRECT',
        level: 1,
        suggestionId: S1,
        suggestedLevel: 3,
        reason: 'DEV-test dolor irradiado',
      },
    });
    expect(decide(correct(5), ok(3))).toMatchObject({
      ok: true,
      decision: { level: 5 },
    });
  });

  it('R3: MANUAL sin sugerencia, o con la vigente en INVALID_OUTPUT, TIMEOUT o FAILED, fija el nivel sin sugerencia', () => {
    const expected = {
      ok: true,
      decision: {
        action: 'MANUAL',
        level: 4,
        suggestionId: null,
        suggestedLevel: null,
        reason: null,
      },
    };
    expect(decide(manual(4), null)).toEqual(expected);
    for (const status of ['INVALID_OUTPUT', 'TIMEOUT', 'FAILED'] as const) {
      expect(decide(manual(4), failed(status))).toEqual(expected);
    }
  });

  it('R6: CORRECT con el mismo nivel que el sugerido → SAME_AS_SUGGESTED', () => {
    expect(decide(correct(3), ok(3))).toEqual({
      ok: false,
      error: 'SAME_AS_SUGGESTED',
    });
  });

  it('R7: VALIDATE o CORRECT con un suggestionId distinto del vigente, sin sugerencia o con la vigente no OK → NOT_CURRENT_OR_INVALID', () => {
    const notCurrent = { ok: false, error: 'NOT_CURRENT_OR_INVALID' };
    for (const input of [validate, correct(1)]) {
      // Hay una más reciente (o es de otra atención): el id no coincide con el vigente.
      expect(decide(input, ok(3, S2))).toEqual(notCurrent);
      expect(decide(input, null)).toEqual(notCurrent);
      for (const status of ['INVALID_OUTPUT', 'TIMEOUT', 'FAILED'] as const) {
        expect(decide(input, failed(status))).toEqual(notCurrent);
      }
    }
    // R7 se comprueba antes que R6: un CORRECT igual al nivel de una sugerencia no vigente es 409, no 422.
    expect(decide(correct(3), ok(3, S2))).toEqual(notCurrent);
  });

  it('R8: MANUAL con una sugerencia vigente OK → HAS_VALID_SUGGESTION', () => {
    expect(decide(manual(2), ok(3))).toEqual({
      ok: false,
      error: 'HAS_VALID_SUGGESTION',
    });
  });
});
