import {
  VITAL_SIGN_COHERENCE_RULES,
  VITAL_SIGN_DEFINITIONS,
  type VitalSignField,
  type VitalSignsInput,
  validateVitalSigns,
} from './vital-signs.rules.js';

/** Toma válida construida a partir de la definición (no repite los números de la tabla D3). */
function validTake(): VitalSignsInput {
  const take: VitalSignsInput = {};
  for (const d of VITAL_SIGN_DEFINITIONS) {
    if (!d.required) continue;
    if (d.type === 'boolean') take[d.field] = false;
    else if (d.type === 'enum') take[d.field] = d.values![0];
    else take[d.field] = d.min!;
  }
  // Coherencia: sistólica en su máximo para poder añadir cualquier diastólica válida.
  take.systolicBp = VITAL_SIGN_DEFINITIONS.find(
    (d) => d.field === 'systolicBp',
  )!.max!;
  return take;
}

const numeric = VITAL_SIGN_DEFINITIONS.filter(
  (d) => d.type === 'integer' || d.type === 'decimal1',
);
const step = (field: VitalSignField) =>
  VITAL_SIGN_DEFINITIONS.find((d) => d.field === field)!.type === 'decimal1'
    ? 0.1
    : 1;
const round1 = (n: number) => Math.round(n * 10) / 10;

describe('VITAL_SIGN_DEFINITIONS (tabla D3, PROVISIONAL)', () => {
  it('R4: tiene exactamente los siete obligatorios y los dos opcionales de PA-F03-1', () => {
    expect(
      VITAL_SIGN_DEFINITIONS.filter((d) => d.required).map((d) => d.field),
    ).toEqual([
      'respiratoryRate',
      'oxygenSaturation',
      'supplementalOxygen',
      'systolicBp',
      'heartRate',
      'consciousness',
      'temperatureC',
    ]);
    expect(
      VITAL_SIGN_DEFINITIONS.filter((d) => !d.required).map((d) => d.field),
    ).toEqual(['diastolicBp', 'glucoseMgDl']);
  });

  it('R5: los rangos admitidos son los de PA-F03-2 (inclusivos)', () => {
    const ranges = Object.fromEntries(
      numeric.map((d) => [d.field, [d.min, d.max, d.unit]]),
    );
    expect(ranges).toEqual({
      respiratoryRate: [4, 80, 'rpm'],
      oxygenSaturation: [50, 100, '%'],
      systolicBp: [40, 300, 'mmHg'],
      heartRate: [20, 300, 'lpm'],
      temperatureC: [25, 45, '°C'],
      diastolicBp: [20, 200, 'mmHg'],
      glucoseMgDl: [20, 600, 'mg/dL'],
    });
    expect(
      VITAL_SIGN_DEFINITIONS.find((d) => d.field === 'consciousness')!.values,
    ).toEqual(['A', 'C', 'V', 'P', 'U']);
  });

  it('R6: la regla de coherencia es sistólica > diastólica cuando llega la diastólica', () => {
    expect(VITAL_SIGN_COHERENCE_RULES.map((r) => r.fields)).toEqual([
      ['systolicBp', 'diastolicBp'],
    ]);
  });
});

describe('validateVitalSigns', () => {
  it('R4: una toma válida con los siete obligatorios y sin los opcionales no tiene errores', () => {
    expect(validateVitalSigns(validTake())).toEqual([]);
  });

  it('R4: una toma vacía devuelve un error por cada uno de los siete obligatorios', () => {
    const errors = validateVitalSigns({});
    expect(errors.map((e) => e.field)).toEqual(
      VITAL_SIGN_DEFINITIONS.filter((d) => d.required).map((d) => d.field),
    );
  });

  it('R4: cada obligatorio ausente por separado (undefined o null) devuelve un error solo de ese campo', () => {
    for (const d of VITAL_SIGN_DEFINITIONS.filter((x) => x.required)) {
      for (const missing of [undefined, null]) {
        const take = { ...validTake(), [d.field]: missing };
        if (missing === undefined) delete take[d.field];
        expect(validateVitalSigns(take).map((e) => e.field)).toEqual([d.field]);
      }
    }
  });

  it('R5: cada signo numérico se acepta en su mín y su máx y se rechaza justo fuera por debajo y por encima', () => {
    for (const d of numeric) {
      const s = step(d.field);
      const base = validTake();
      // La sistólica en mín exige una diastólica menor para no disparar R6: se prueba sin diastólica.
      for (const ok of [d.min!, d.max!]) {
        const take = { ...base, [d.field]: ok };
        if (d.field === 'diastolicBp') take.systolicBp = d.max! + 1;
        expect([d.field, ok, validateVitalSigns(take)]).toEqual([
          d.field,
          ok,
          [],
        ]);
      }
      for (const bad of [round1(d.min! - s), round1(d.max! + s)]) {
        const take = { ...base, [d.field]: bad };
        const errors = validateVitalSigns(take).filter(
          (e) => e.field === d.field,
        );
        expect([d.field, bad, errors.length]).toEqual([d.field, bad, 1]);
      }
    }
  });

  it('R5: un solo signo fuera de rango con el resto válido rechaza la toma (hay error) y el mensaje da el rango sin el valor enviado', () => {
    const take = { ...validTake(), heartRate: 777, glucoseMgDl: 100 };
    const errors = validateVitalSigns(take);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('heartRate');
    expect(errors[0].message).toContain('20');
    expect(errors[0].message).toContain('300');
    expect(errors[0].message).not.toContain('777');
  });

  it('R5: varios fuera de rango a la vez devuelven un error por cada uno, sin los valores enviados', () => {
    const errors = validateVitalSigns({
      ...validTake(),
      heartRate: 9991,
      respiratoryRate: 9992,
      temperatureC: 99.3,
    });
    expect(errors.map((e) => e.field).sort()).toEqual([
      'heartRate',
      'respiratoryRate',
      'temperatureC',
    ]);
    const text = JSON.stringify(errors);
    for (const v of ['9991', '9992', '99.3']) expect(text).not.toContain(v);
  });

  it('R4: faltas y fuera de rango a la vez se devuelven juntos', () => {
    const take: VitalSignsInput = { ...validTake(), oxygenSaturation: 9 };
    delete take.heartRate;
    delete take.consciousness;
    expect(
      validateVitalSigns(take)
        .map((e) => e.field)
        .sort(),
    ).toEqual(['consciousness', 'heartRate', 'oxygenSaturation']);
  });

  it('R6: sistólica igual o menor que la diastólica → errores en systolicBp y diastolicBp; mayor → válida', () => {
    for (const [sys, dia] of [
      [120, 120],
      [90, 120],
    ]) {
      const errors = validateVitalSigns({
        ...validTake(),
        systolicBp: sys,
        diastolicBp: dia,
      });
      expect(errors.map((e) => e.field)).toEqual(['systolicBp', 'diastolicBp']);
      expect(JSON.stringify(errors)).not.toContain(String(dia));
    }
    expect(
      validateVitalSigns({ ...validTake(), systolicBp: 121, diastolicBp: 120 }),
    ).toEqual([]);
  });

  it('R6: sin diastólica la regla de coherencia no aplica; con un signo fuera de rango no se evalúa la coherencia', () => {
    expect(validateVitalSigns({ ...validTake(), systolicBp: 40 })).toEqual([]);
    const errors = validateVitalSigns({
      ...validTake(),
      systolicBp: 40,
      diastolicBp: 900,
    });
    expect(errors.map((e) => e.field)).toEqual(['diastolicBp']);
  });
});
