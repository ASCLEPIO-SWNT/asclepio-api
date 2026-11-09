import type { TriageInputSnapshot } from './triage-input.js';

/**
 * Esquema JSON de la salida del LLM (D9 de specs/F-04-api/design.md), compatible con `strict`: todos los campos
 * required y additionalProperties false. Se envía como response_format y además se comprueba en código, porque no
 * todos los proveedores aplican minimum, maxLength ni los paths de field.
 */
export const TRIAGE_OUTPUT_SCHEMA = {
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
        properties: {
          field: { type: 'string' },
          note: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
  },
} as const;

export interface TriageFactor {
  field: string;
  note: string;
}

export interface TriageOutput {
  level: number;
  explanation: string;
  factors: TriageFactor[];
}

export type ValidationResult =
  { valid: true; output: TriageOutput } | { valid: false };

const INVALID: ValidationResult = { valid: false };
const TOP_FIELDS = new Set([
  'age_years',
  'sex',
  'chief_complaint_text',
  'complaint_source',
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasExactKeys(o: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => k in o);
}

function textInRange(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.trim().length >= 1 && v.length <= max;
}

/** true si `field` es un path admitido (D7) y su valor en la instantánea existe y no es null. */
export function isPresentField(
  field: string,
  snapshot: TriageInputSnapshot,
): boolean {
  if (TOP_FIELDS.has(field)) {
    return snapshot[field as keyof TriageInputSnapshot] != null;
  }
  const vital = /^vital_signs\.([a-z0-9_]+)$/.exec(field);
  if (vital) {
    const key = vital[1];
    return (
      Object.prototype.hasOwnProperty.call(snapshot.vital_signs, key) &&
      snapshot.vital_signs[key as keyof typeof snapshot.vital_signs] != null
    );
  }
  const finding = /^symptom_findings\[(\d+)\]$/.exec(field);
  if (finding) {
    return Number(finding[1]) < snapshot.symptom_findings.length;
  }
  return false;
}

/**
 * TriageResponseValidator (R15, R16): el contenido es una salida válida si es JSON, cumple TRIAGE_OUTPUT_SCHEMA
 * (rangos y longitudes incluidos) y todos sus factors[].field existen con valor no nulo en la instantánea.
 */
export function validateTriageResponse(
  content: string,
  snapshot: TriageInputSnapshot,
): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return INVALID;
  }
  if (!isPlainObject(parsed)) return INVALID;
  if (!hasExactKeys(parsed, ['level', 'explanation', 'factors'])) {
    return INVALID;
  }
  const { level, explanation, factors } = parsed;
  if (
    typeof level !== 'number' ||
    !Number.isInteger(level) ||
    level < 1 ||
    level > 5
  ) {
    return INVALID;
  }
  if (!textInRange(explanation, 1000)) return INVALID;
  if (!Array.isArray(factors) || factors.length < 1 || factors.length > 10) {
    return INVALID;
  }
  const out: TriageFactor[] = [];
  for (const f of factors as unknown[]) {
    if (!isPlainObject(f) || !hasExactKeys(f, ['field', 'note'])) {
      return INVALID;
    }
    if (typeof f.field !== 'string' || !textInRange(f.note, 200)) {
      return INVALID;
    }
    if (!isPresentField(f.field, snapshot)) return INVALID;
    out.push({ field: f.field, note: f.note });
  }
  return { valid: true, output: { level, explanation, factors: out } };
}
