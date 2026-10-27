/**
 * Síntomas y hallazgos (F-03-api). PA-F03-3 (humano, 2026-10-27): texto libre estructurado, sin catálogo ni code.
 * SYMPTOM = lo que refiere el paciente; FINDING = lo que observa enfermería; COMPLAINT_NOTE = precisión del motivo de
 * consulta (PA-F03-4: el motivo original no se edita).
 */
export const SYMPTOM_FINDING_KINDS = [
  'SYMPTOM',
  'FINDING',
  'COMPLAINT_NOTE',
] as const;
export type SymptomFindingKind = (typeof SYMPTOM_FINDING_KINDS)[number];

/** Límites técnicos, no clínicos (D15). */
export const FINDINGS_MIN = 1;
export const FINDINGS_MAX = 20;
export const FINDING_DESCRIPTION_MAX = 500;
