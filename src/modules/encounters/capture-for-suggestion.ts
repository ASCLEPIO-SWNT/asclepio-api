import type { ComplaintSource } from './dto/encounters.dto.js';
import type { EncounterStatus } from './encounter-state-machine.js';
import type { SymptomFindingKind } from './symptom-findings.rules.js';
import type { ConsciousnessLevel } from './vital-signs.rules.js';

/**
 * Captura vigente para la sugerencia de triage (D1 de specs/F-04-api/design.md): la devuelve
 * ClinicalCaptureService.getForSuggestion y la usa SOLO el módulo ai para construir la instantánea y sanear el texto.
 * Nunca se serializa, se registra ni se guarda tal cual: lleva el nombre y el documento del paciente para el saneamiento.
 */
export interface CaptureForSuggestion {
  status: EncounterStatus;
  chiefComplaintText: string;
  complaintSource: ComplaintSource;
  /** Última toma (mayor recorded_at y después mayor id), o null si no hay ninguna. */
  latestVitalSigns: {
    respiratoryRate: number | null;
    oxygenSaturation: number | null;
    supplementalOxygen: boolean | null;
    systolicBp: number | null;
    diastolicBp: number | null;
    heartRate: number | null;
    consciousness: ConsciousnessLevel | null;
    temperatureC: number | null;
    glucoseMgDl: number | null;
  } | null;
  /** Todos los hallazgos, en orden de recorded_at e id. */
  symptomFindings: { kind: SymptomFindingKind; description: string }[];
  patient: {
    /** YYYY-MM-DD o null. */
    birthDate: string | null;
    estimatedAgeYears: number | null;
    sex: 'M' | 'F' | 'X' | null;
    fullName: string | null;
    documentNumber: string | null;
  };
}
