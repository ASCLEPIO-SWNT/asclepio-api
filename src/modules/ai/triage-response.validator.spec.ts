import type { TriageInputSnapshot } from './triage-input.js';
import {
  TRIAGE_OUTPUT_SCHEMA,
  validateTriageResponse,
} from './triage-response.validator.js';

/**
 * TriageResponseValidator: pruebas SIN mocks del LLM, con respuestas JSON literales (docs/verification.md).
 */
const SNAPSHOT: TriageInputSnapshot = {
  age_years: 58,
  sex: 'M',
  chief_complaint_text: 'dolor torácico opresivo de 40 minutos',
  complaint_source: 'TYPED',
  vital_signs: {
    respiratory_rate: 22,
    spo2: 94,
    supplemental_oxygen: false,
    systolic_bp: 150,
    diastolic_bp: null,
    heart_rate: 112,
    consciousness: 'A',
    temperature_c: 37.4,
    glucose_mg_dl: null,
  },
  symptom_findings: [{ kind: 'SYMPTOM', description: 'diaforesis' }],
};

const VALID = {
  level: 2,
  explanation:
    'Dolor torácico opresivo con taquicardia: riesgo de síndrome coronario agudo.',
  factors: [
    { field: 'vital_signs.heart_rate', note: 'Taquicardia de 112 lpm' },
    { field: 'symptom_findings[0]', note: 'Diaforesis' },
    { field: 'chief_complaint_text', note: 'Dolor torácico opresivo' },
  ],
};

const check = (content: unknown) =>
  validateTriageResponse(
    typeof content === 'string' ? content : JSON.stringify(content),
    SNAPSHOT,
  );

describe('validateTriageResponse (D9)', () => {
  it('R16: una salida correcta con paths vital_signs.heart_rate, symptom_findings[0] y chief_complaint_text es válida', () => {
    expect(check(VALID)).toEqual({ valid: true, output: VALID });
    expect(
      check({
        ...VALID,
        factors: [
          { field: 'age_years', note: 'x' },
          { field: 'sex', note: 'x' },
          { field: 'complaint_source', note: 'x' },
          {
            field: 'vital_signs.supplemental_oxygen',
            note: 'false también es un valor',
          },
        ],
      }).valid,
    ).toBe(true);
    // Límites incluidos.
    expect(
      check({
        level: 5,
        explanation: 'x'.repeat(1000),
        factors: Array.from({ length: 10 }, () => ({
          field: 'vital_signs.spo2',
          note: 'n'.repeat(200),
        })),
      }).valid,
    ).toBe(true);
    expect(check({ ...VALID, level: 1 }).valid).toBe(true);
  });

  it('R15: JSON mal formado, vacío o que no es un objeto → inválido', () => {
    for (const raw of [
      '',
      '{"level": 2,',
      'Nivel II: dolor torácico',
      '```json\n{"level":2}\n```',
      'null',
      '[]',
      '2',
    ]) {
      expect([raw, check(raw).valid]).toEqual([raw, false]);
    }
  });

  it('R15: campo faltante o campo extra (también dentro de factors) → inválido', () => {
    const cases: unknown[] = [
      { explanation: VALID.explanation, factors: VALID.factors },
      { level: 2, factors: VALID.factors },
      { level: 2, explanation: VALID.explanation },
      { ...VALID, final_level: 2 },
      { ...VALID, factors: [{ field: 'vital_signs.spo2' }] },
      {
        ...VALID,
        factors: [{ field: 'vital_signs.spo2', note: 'x', weight: 1 }],
      },
    ];
    for (const c of cases) expect([c, check(c).valid]).toEqual([c, false]);
  });

  it('R15: level 0, 6, 2.5, "2" o null → inválido', () => {
    for (const level of [0, 6, 2.5, '2', null]) {
      expect([level, check({ ...VALID, level }).valid]).toEqual([level, false]);
    }
  });

  it('R15: explanation vacía, solo espacios, de 1001 caracteres o no texto → inválida', () => {
    for (const explanation of ['', '   ', 'x'.repeat(1001), 42]) {
      expect(check({ ...VALID, explanation }).valid).toBe(false);
    }
  });

  it('R15: factors vacío, con 11 elementos, no array o con note vacía o de 201 caracteres → inválido', () => {
    const f = { field: 'vital_signs.spo2', note: 'x' };
    for (const factors of [
      [],
      Array.from({ length: 11 }, () => f),
      f,
      [{ ...f, note: '' }],
      [{ ...f, note: 'n'.repeat(201) }],
      [{ ...f, field: 3 }],
    ]) {
      expect(check({ ...VALID, factors }).valid).toBe(false);
    }
  });

  it('R15: un factors[].field que no existe o es null en la instantánea → inválido', () => {
    for (const field of [
      'vital_signs.glucose_mg_dl', // null en la instantánea
      'vital_signs.diastolic_bp', // null
      'vital_signs.pulse', // no existe
      'symptom_findings[1]', // fuera de rango
      'symptom_findings[-1]',
      'symptom_findings',
      'vital_signs',
      'patient_name',
      'chief_complaint_text.0',
      '',
    ]) {
      const out = check({
        ...VALID,
        factors: [...VALID.factors, { field, note: 'x' }],
      });
      expect([field, out.valid]).toEqual([field, false]);
    }
  });

  it('R11: TRIAGE_OUTPUT_SCHEMA es compatible con strict: todo required y additionalProperties false', () => {
    expect(TRIAGE_OUTPUT_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['level', 'explanation', 'factors'],
      properties: {
        level: { type: 'integer', minimum: 1, maximum: 5 },
        explanation: { type: 'string', minLength: 1, maxLength: 1000 },
        factors: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['field', 'note'],
          },
        },
      },
    });
  });
});
