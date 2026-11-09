import { scoreNews2 } from './news2.js';
import { applyGuards, SAFETY_GUARD_RULES } from './safety-guards.js';
import type { SnapshotVitalSigns } from './triage-input.js';

/**
 * SafetyGuards (ADR 0005): pruebas SIN mocks del LLM, con niveles literales y tomas sintéticas.
 * Tabla y reglas PROVISIONALES — no validadas clínicamente, revisar con asesor clínico (PA-F04-1).
 */
const NORMAL: SnapshotVitalSigns = {
  respiratory_rate: 16,
  spo2: 98,
  supplemental_oxygen: false,
  systolic_bp: 120,
  diastolic_bp: 80,
  heart_rate: 70,
  consciousness: 'A',
  temperature_c: 37.0,
  glucose_mg_dl: null,
};

const vitals = (over: Partial<SnapshotVitalSigns>) => ({ ...NORMAL, ...over });
const guards = (llmLevel: number, over: Partial<SnapshotVitalSigns>) =>
  applyGuards(llmLevel, scoreNews2(vitals(over)));

// Tomas de referencia (puntos entre paréntesis), sin ningún parámetro en 3 salvo que se indique.
/** Total 7: FR 22 (2) + SpO₂ 94 (1) + O₂ (2) + FC 112 (2). */
const TOTAL_7 = {
  respiratory_rate: 22,
  spo2: 94,
  supplemental_oxygen: true,
  heart_rate: 112,
};
/** Total 6: FR 22 (2) + O₂ (2) + FC 112 (2). */
const TOTAL_6 = {
  respiratory_rate: 22,
  supplemental_oxygen: true,
  heart_rate: 112,
};
/** Total 5: FR 22 (2) + O₂ (2) + SpO₂ 95 (1). */
const TOTAL_5 = { respiratory_rate: 22, supplemental_oxygen: true, spo2: 95 };
/** Total 4: FR 22 (2) + FC 112 (2). */
const TOTAL_4 = { respiratory_rate: 22, heart_rate: 112 };

describe('SafetyGuards (PROVISIONALES, PA-F04-1)', () => {
  it('R18: las reglas son exactamente G1, G2 y G3 (G4 fue rechazada)', () => {
    expect(SAFETY_GUARD_RULES.map((r) => [r.rule, r.maxLevel])).toEqual([
      ['G1', 2],
      ['G2', 3],
      ['G3', 3],
    ]);
  });

  it('R18: G1 en su umbral (NEWS2 = 7) limita a II; justo por debajo (6) no aplica G1', () => {
    expect(scoreNews2(vitals(TOTAL_7)).total).toBe(7);
    expect(guards(4, TOTAL_7)).toEqual({
      suggestedLevel: 2,
      guardApplied: true,
      guardReasons: [{ rule: 'G1', maxLevel: 2, trigger: { news2Total: 7 } }],
    });
    expect(scoreNews2(vitals(TOTAL_6)).total).toBe(6);
    expect(guards(4, TOTAL_6).guardReasons.map((r) => r.rule)).not.toContain(
      'G1',
    );
  });

  it('R18: G2 en sus umbrales (NEWS2 = 5 y 6) limita a III; justo por debajo (4) no aplica', () => {
    for (const take of [TOTAL_5, TOTAL_6]) {
      const total = scoreNews2(vitals(take)).total;
      expect(guards(5, take)).toEqual({
        suggestedLevel: 3,
        guardApplied: true,
        guardReasons: [
          { rule: 'G2', maxLevel: 3, trigger: { news2Total: total } },
        ],
      });
    }
    expect(scoreNews2(vitals(TOTAL_4)).total).toBe(4);
    expect(guards(5, TOTAL_4)).toEqual({
      suggestedLevel: 5,
      guardApplied: false,
      guardReasons: [],
    });
  });

  it('R18: G3 con un parámetro en 3 puntos limita a III y cita el parámetro; con 2 puntos no aplica', () => {
    expect(guards(5, { heart_rate: 131 })).toEqual({
      suggestedLevel: 3,
      guardApplied: true,
      guardReasons: [
        {
          rule: 'G3',
          maxLevel: 3,
          trigger: {
            news2Total: 3,
            field: 'vital_signs.heart_rate',
            points: 3,
          },
        },
      ],
    });
    expect(guards(5, { heart_rate: 130 })).toMatchObject({
      suggestedLevel: 5,
      guardApplied: false,
      guardReasons: [],
    });
    for (const over of [
      { respiratory_rate: 8 },
      { spo2: 91 },
      { systolic_bp: 90 },
      { consciousness: 'V' as const },
      { temperature_c: 35.0 },
    ]) {
      expect(guards(4, over).guardReasons.map((r) => r.rule)).toEqual(['G3']);
    }
  });

  it('R18: varias reglas a la vez → gana el nivel más grave y guard_reasons lista cada regla que limita', () => {
    // Total 3 + 2 + 2 + 2 = 9 con FC 140 (3): G1 y G3.
    const take = {
      heart_rate: 140,
      respiratory_rate: 22,
      supplemental_oxygen: true,
      spo2: 92,
    };
    const r = guards(5, take);
    expect(r.suggestedLevel).toBe(2);
    expect(r.guardApplied).toBe(true);
    expect(r.guardReasons).toEqual([
      { rule: 'G1', maxLevel: 2, trigger: { news2Total: 9 } },
      {
        rule: 'G3',
        maxLevel: 3,
        trigger: { news2Total: 9, field: 'vital_signs.heart_rate', points: 3 },
      },
    ]);
    // Con LLM en III, G3 (máx. III) ya no limita: solo G1 queda en guard_reasons.
    expect(guards(3, take).guardReasons.map((g) => g.rule)).toEqual(['G1']);
  });

  it('R18: si el LLM ya es más grave que el máximo de las reglas cumplidas, guard_applied = false y sin razones', () => {
    expect(guards(2, TOTAL_7)).toEqual({
      suggestedLevel: 2,
      guardApplied: false,
      guardReasons: [],
    });
    expect(guards(1, { heart_rate: 140 })).toEqual({
      suggestedLevel: 1,
      guardApplied: false,
      guardReasons: [],
    });
  });

  it('R19: con todos los niveles del LLM (1–5) y una muestra de tomas, el nivel sugerido nunca es menos grave que el del LLM', () => {
    const takes: Partial<SnapshotVitalSigns>[] = [
      {},
      TOTAL_4,
      TOTAL_5,
      TOTAL_6,
      TOTAL_7,
      { heart_rate: 140 },
      { consciousness: 'U', spo2: 85, systolic_bp: 80 },
      { respiratory_rate: 30, temperature_c: 40.2 },
      { heart_rate: null, spo2: null },
    ];
    for (const llmLevel of [1, 2, 3, 4, 5]) {
      for (const take of takes) {
        const r = guards(llmLevel, take);
        expect(r.suggestedLevel).toBeLessThanOrEqual(llmLevel);
        expect(r.guardApplied).toBe(r.suggestedLevel < llmLevel);
        expect(r.guardReasons.length > 0).toBe(r.guardApplied);
      }
    }
  });
});
