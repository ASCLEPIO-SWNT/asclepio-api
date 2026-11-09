import type { CaptureForSuggestion } from '../encounters/capture-for-suggestion.js';
import { REDACTED } from './redaction.js';
import { ageInYears, buildSnapshot } from './triage-input.js';

const PATIENT_ID = '7a1f0c2e-1111-4aaa-8bbb-123456789abc';
const ENCOUNTER_ID = '9c2d4e6f-2222-4ccc-8ddd-abcdef012345';

function capture(
  over: Partial<CaptureForSuggestion> = {},
): CaptureForSuggestion {
  return {
    status: 'WAITING_TRIAGE',
    chiefComplaintText:
      'Marta Lucía Gómez refiere dolor torácico; documento 52.123.987',
    complaintSource: 'VOICE_ON_DEVICE',
    latestVitalSigns: {
      respiratoryRate: 22,
      oxygenSaturation: 94,
      supplementalOxygen: false,
      systolicBp: 150,
      diastolicBp: null,
      heartRate: 112,
      consciousness: 'A',
      temperatureC: 37.4,
      glucoseMgDl: null,
    },
    symptomFindings: [
      { kind: 'SYMPTOM', description: 'dolor opresivo, dice MARTA' },
      { kind: 'FINDING', description: 'diaforesis' },
      {
        kind: 'COMPLAINT_NOTE',
        description: 'la hija de Gómez avisa: 52123987',
      },
    ],
    patient: {
      birthDate: '1968-03-15',
      estimatedAgeYears: null,
      sex: 'F',
      fullName: 'Marta Lucía Gómez',
      documentNumber: '52123987',
    },
    ...over,
  };
}

/** Recorre el JSON y devuelve todas las cadenas y números (claves incluidas). */
function deepStrings(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(deepStrings);
  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [k, ...deepStrings(v)]);
  }
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? [String(value)]
    : [];
}

describe('buildSnapshot (D7)', () => {
  it('R8: tiene exactamente las claves de D7, con la toma vigente en snake_case y los opcionales en null', () => {
    const s = buildSnapshot(capture(), '2026-11-09');
    expect(Object.keys(s).sort()).toEqual([
      'age_years',
      'chief_complaint_text',
      'complaint_source',
      'sex',
      'symptom_findings',
      'vital_signs',
    ]);
    expect(s.vital_signs).toEqual({
      respiratory_rate: 22,
      spo2: 94,
      supplemental_oxygen: false,
      systolic_bp: 150,
      diastolic_bp: null,
      heart_rate: 112,
      consciousness: 'A',
      temperature_c: 37.4,
      glucose_mg_dl: null,
    });
    expect(s).toMatchObject({
      age_years: 58,
      sex: 'F',
      complaint_source: 'VOICE_ON_DEVICE',
    });
  });

  it('R8: los hallazgos conservan el orden y solo llevan kind y description', () => {
    const s = buildSnapshot(capture(), '2026-11-09');
    expect(s.symptom_findings.map((f) => f.kind)).toEqual([
      'SYMPTOM',
      'FINDING',
      'COMPLAINT_NOTE',
    ]);
    for (const f of s.symptom_findings) {
      expect(Object.keys(f).sort()).toEqual(['description', 'kind']);
    }
  });

  it('R8: age_years es la edad cumplida en Bogotá: el día del cumpleaños suma un año y el día anterior no', () => {
    expect(buildSnapshot(capture(), '2026-03-14').age_years).toBe(57);
    expect(buildSnapshot(capture(), '2026-03-15').age_years).toBe(58);
    expect(ageInYears('2000-02-29', '2025-02-28')).toBe(24);
    expect(ageInYears('2000-02-29', '2025-03-01')).toBe(25);
  });

  it('R8: NN sin fecha de nacimiento usa estimated_age_years; sin ninguna, null', () => {
    const nn = capture({
      patient: {
        birthDate: null,
        estimatedAgeYears: 40,
        sex: null,
        fullName: null,
        documentNumber: null,
      },
    });
    expect(buildSnapshot(nn, '2026-11-09')).toMatchObject({
      age_years: 40,
      sex: null,
    });
    nn.patient.estimatedAgeYears = null;
    expect(buildSnapshot(nn, '2026-11-09').age_years).toBeNull();
  });

  it('R9: sanea el motivo y cada description con el nombre y el documento del paciente; NN sin reemplazos', () => {
    const s = buildSnapshot(capture(), '2026-11-09');
    expect(s.chief_complaint_text).toBe(
      `${REDACTED} refiere dolor torácico; documento ${REDACTED}`,
    );
    expect(s.symptom_findings.map((f) => f.description)).toEqual([
      `dolor opresivo, dice ${REDACTED}`,
      'diaforesis',
      `la hija de ${REDACTED} avisa: ${REDACTED}`,
    ]);
    const nn = buildSnapshot(
      capture({
        patient: {
          birthDate: null,
          estimatedAgeYears: 30,
          sex: 'X',
          fullName: null,
          documentNumber: null,
        },
      }),
      '2026-11-09',
    );
    expect(nn.chief_complaint_text).toBe(capture().chiefComplaintText);
  });

  it('R10: una búsqueda profunda en la instantánea no encuentra el nombre, sus palabras, el documento, la fecha de nacimiento ni los ids', () => {
    // La captura de entrada puede traer más datos (ids, horas): ninguno pasa a la instantánea.
    const rich = {
      ...capture(),
      encounterId: ENCOUNTER_ID,
      arrivalAt: '2026-11-09T00:42:00.000Z',
      patient: { ...capture().patient, id: PATIENT_ID },
    } as CaptureForSuggestion;
    const s = buildSnapshot(rich, '2026-11-09');
    const json = JSON.stringify(s).toLowerCase();
    const strings = deepStrings(s).map((x) => x.toLowerCase());
    for (const needle of [
      'marta lucía gómez',
      'marta',
      'lucía',
      'lucia',
      'gómez',
      'gomez',
      '52123987',
      '52.123.987',
      '1968-03-15',
      PATIENT_ID,
      ENCOUNTER_ID,
      '2026-11-09',
    ]) {
      expect([needle, json.includes(needle)]).toEqual([needle, false]);
      expect(strings.some((x) => x.includes(needle))).toBe(false);
    }
  });

  it('R8: sin toma de signos vitales no se puede construir la instantánea', () => {
    expect(() =>
      buildSnapshot(capture({ latestVitalSigns: null }), '2026-11-09'),
    ).toThrow();
  });
});
