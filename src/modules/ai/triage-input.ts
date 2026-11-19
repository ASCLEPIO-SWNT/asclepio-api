import type { CaptureForSuggestion } from '../encounters/capture-for-suggestion.js';
import type { Dimension, RedFlag } from '../interview/interview.rules.js';
import { ageInYears } from '../../common/clock/age.js';
import { redact } from './redaction.js';

/**
 * Instantánea de entrada al LLM (D7 de specs/F-04-api/design.md). Claves en snake_case, iguales a las de
 * ai/vignettes/README.md. Nunca lleva nombre, documento, ids de la base, fecha de nacimiento ni horas (RNF-04).
 */

export type SnapshotConsciousness = 'A' | 'C' | 'V' | 'P' | 'U';

export interface SnapshotVitalSigns {
  respiratory_rate: number | null;
  spo2: number | null;
  supplemental_oxygen: boolean | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate: number | null;
  consciousness: SnapshotConsciousness | null;
  temperature_c: number | null;
  glucose_mg_dl: number | null;
}

export interface SnapshotFinding {
  kind: 'SYMPTOM' | 'FINDING' | 'COMPLAINT_NOTE';
  description: string;
}

/** Turno de la entrevista del paciente (F-11-api, R9): respuesta no verificada; null = "No sé". */
export interface SnapshotFollowUp {
  dimension: Dimension;
  question: string;
  answer: string | null;
}

export interface TriageInputSnapshot {
  age_years: number | null;
  sex: 'M' | 'F' | 'X' | null;
  chief_complaint_text: string;
  complaint_source: 'TYPED' | 'VOICE_ON_DEVICE';
  vital_signs: SnapshotVitalSigns;
  symptom_findings: SnapshotFinding[];
  /** triage-v2 (F-11-api, R9): turnos de la entrevista, saneados con redact(); [] sin entrevista. */
  follow_up: SnapshotFollowUp[];
  /** triage-v2 (F-11-api, R9): señales de alarma referidas por el paciente; no cambian el nivel por sí mismas (R10). */
  patient_reported_red_flags: RedFlag[];
}

// ageInYears vive en common/clock/age.ts (F-06-api, D4); se reexporta para los importadores de F-04.
export { ageInYears };

/**
 * Construye la instantánea de entrada (R8, R9) a partir de la captura vigente y la fecha civil de hoy en Bogotá.
 * Solo copia los campos de D7 (y, desde triage-v2, follow_up y patient_reported_red_flags de F-11): nada de ids,
 * horas, fecha de nacimiento, nombre ni documento. El motivo, cada description y cada pregunta y respuesta de la
 * entrevista se sanean con el nombre y el documento del paciente (PA-F04-7).
 */
export function buildSnapshot(
  capture: CaptureForSuggestion,
  today: string,
): TriageInputSnapshot {
  const v = capture.latestVitalSigns;
  if (!v) throw new Error('La captura no tiene signos vitales.');
  const target = {
    fullName: capture.patient.fullName,
    documentNumber: capture.patient.documentNumber,
  };
  const p = capture.patient;
  return {
    age_years: p.birthDate
      ? ageInYears(p.birthDate, today)
      : (p.estimatedAgeYears ?? null),
    sex: p.sex ?? null,
    chief_complaint_text: redact(capture.chiefComplaintText, target),
    complaint_source: capture.complaintSource,
    vital_signs: {
      respiratory_rate: v.respiratoryRate ?? null,
      spo2: v.oxygenSaturation ?? null,
      supplemental_oxygen: v.supplementalOxygen ?? null,
      systolic_bp: v.systolicBp ?? null,
      diastolic_bp: v.diastolicBp ?? null,
      heart_rate: v.heartRate ?? null,
      consciousness: v.consciousness ?? null,
      temperature_c: v.temperatureC ?? null,
      glucose_mg_dl: v.glucoseMgDl ?? null,
    },
    symptom_findings: capture.symptomFindings.map((f) => ({
      kind: f.kind,
      description: redact(f.description, target),
    })),
    follow_up: (capture.symptomInterview?.turns ?? []).map((t) => ({
      dimension: t.dimension,
      question: redact(t.question, target),
      answer: t.answer === null ? null : redact(t.answer, target),
    })),
    patient_reported_red_flags: [...capture.redFlags],
  };
}
