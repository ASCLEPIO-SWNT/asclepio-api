/**
 * Reglas de la toma de signos vitales (F-03-api, tabla D3 de specs/F-03-api/design.md). Pura, sin Nest.
 * Única fuente de las decisiones de PA-F03-1 y PA-F03-2: ajustar un rango u obligatoriedad solo cambia este archivo.
 *
 * PROVISIONAL — no validado clínicamente, revisar con asesor clínico. Fecha: 2026-10-27.
 * - PA-F03-1 (lista de signos, unidades y obligatoriedad): decidido por el humano; parámetros fisiológicos del NEWS2
 *   (Royal College of Physicians. National Early Warning Score (NEWS) 2. Londres: RCP, 2017).
 * - PA-F03-2 (rangos [mín, máx] y regla de coherencia): decidido por el leader por delegación del humano; SIN fuente
 *   publicada. Son límites amplios solo para atrapar errores de digitación, no umbrales clínicos.
 */

export type VitalSignField =
  | 'respiratoryRate'
  | 'oxygenSaturation'
  | 'supplementalOxygen'
  | 'systolicBp'
  | 'heartRate'
  | 'consciousness'
  | 'temperatureC'
  | 'diastolicBp'
  | 'glucoseMgDl';

export const CONSCIOUSNESS_LEVELS = ['A', 'C', 'V', 'P', 'U'] as const;
export type ConsciousnessLevel = (typeof CONSCIOUSNESS_LEVELS)[number];

export interface VitalSignDefinition {
  field: VitalSignField;
  column: string;
  /** integer = smallint; decimal1 = numeric(4,1), un decimal; boolean; enum = consciousness_level. */
  type: 'integer' | 'decimal1' | 'boolean' | 'enum';
  unit: string | null;
  label: string;
  required: boolean;
  /** Rango admitido inclusivo (solo numéricos). */
  min?: number;
  max?: number;
  /** Dominio (solo enum). */
  values?: readonly string[];
}

/** Tabla D3. PROVISIONAL — no validada clínicamente, revisar con asesor clínico (2026-10-27). */
export const VITAL_SIGN_DEFINITIONS: readonly VitalSignDefinition[] = [
  {
    field: 'respiratoryRate',
    column: 'respiratory_rate',
    type: 'integer',
    unit: 'rpm',
    label: 'Frecuencia respiratoria',
    required: true,
    min: 4,
    max: 80,
  },
  {
    field: 'oxygenSaturation',
    column: 'oxygen_saturation',
    type: 'integer',
    unit: '%',
    label: 'Saturación de oxígeno',
    required: true,
    min: 50,
    max: 100,
  },
  {
    field: 'supplementalOxygen',
    column: 'supplemental_oxygen',
    type: 'boolean',
    unit: null,
    label: 'Oxígeno suplementario',
    required: true,
  },
  {
    field: 'systolicBp',
    column: 'systolic_bp',
    type: 'integer',
    unit: 'mmHg',
    label: 'Presión arterial sistólica',
    required: true,
    min: 40,
    max: 300,
  },
  {
    field: 'heartRate',
    column: 'heart_rate',
    type: 'integer',
    unit: 'lpm',
    label: 'Frecuencia cardiaca',
    required: true,
    min: 20,
    max: 300,
  },
  {
    field: 'consciousness',
    column: 'consciousness',
    type: 'enum',
    unit: null,
    label: 'Nivel de conciencia (ACVPU)',
    required: true,
    values: CONSCIOUSNESS_LEVELS,
  },
  {
    field: 'temperatureC',
    column: 'temperature_c',
    type: 'decimal1',
    unit: '°C',
    label: 'Temperatura',
    required: true,
    min: 25,
    max: 45,
  },
  {
    field: 'diastolicBp',
    column: 'diastolic_bp',
    type: 'integer',
    unit: 'mmHg',
    label: 'Presión arterial diastólica',
    required: false,
    min: 20,
    max: 200,
  },
  {
    field: 'glucoseMgDl',
    column: 'glucose_mg_dl',
    type: 'integer',
    unit: 'mg/dL',
    label: 'Glucometría',
    required: false,
    min: 20,
    max: 600,
  },
];

export type VitalSignsInput = Partial<
  Record<VitalSignField, number | boolean | string | null>
>;

export interface FieldError {
  field: string;
  message: string;
}

export interface VitalSignCoherenceRule {
  fields: [VitalSignField, VitalSignField];
  /** true si la toma cumple la regla; solo se evalúa si ambos campos llegan y están en rango. */
  holds: (a: number, b: number) => boolean;
  message: string;
}

/** PA-F03-2: si llega diastolicBp, systolicBp > diastolicBp. PROVISIONAL — revisar con asesor clínico. */
export const VITAL_SIGN_COHERENCE_RULES: readonly VitalSignCoherenceRule[] = [
  {
    fields: ['systolicBp', 'diastolicBp'],
    holds: (systolic, diastolic) => systolic > diastolic,
    message: 'La presión sistólica debe ser mayor que la diastólica.',
  },
];

const MISSING = 'Signo obligatorio ausente.';

/** "[mín, máx] unidad" con el decimal de la temperatura; nunca incluye el valor enviado (R5, R22). */
export function rangeText(d: VitalSignDefinition): string {
  const fmt = (n: number) => (d.type === 'decimal1' ? n.toFixed(1) : String(n));
  return `${fmt(d.min!)}–${fmt(d.max!)}${d.unit ? ` ${d.unit}` : ''}`;
}

const present = (v: unknown) => v !== undefined && v !== null;

/**
 * Errores 422 de la toma (R4, R5, R6), todos a la vez: obligatorios ausentes, signos fuera de su rango admitido y
 * reglas de coherencia. La forma (tipos, decimales, dominio) ya la validó el DTO (R3, 400). Vacío → toma válida.
 */
export function validateVitalSigns(input: VitalSignsInput): FieldError[] {
  const errors: FieldError[] = [];
  const inRange = new Set<VitalSignField>();
  for (const d of VITAL_SIGN_DEFINITIONS) {
    const value = input[d.field];
    if (!present(value)) {
      if (d.required) errors.push({ field: d.field, message: MISSING });
      continue;
    }
    if (d.min === undefined || d.max === undefined) continue;
    const n = value as number;
    if (n < d.min || n > d.max) {
      errors.push({
        field: d.field,
        message: `Fuera del rango admitido (${rangeText(d)}).`,
      });
    } else {
      inRange.add(d.field);
    }
  }
  for (const rule of VITAL_SIGN_COHERENCE_RULES) {
    const [a, b] = rule.fields;
    if (!inRange.has(a) || !inRange.has(b)) continue;
    if (!rule.holds(input[a] as number, input[b] as number)) {
      errors.push(
        { field: a, message: rule.message },
        { field: b, message: rule.message },
      );
    }
  }
  return errors;
}
