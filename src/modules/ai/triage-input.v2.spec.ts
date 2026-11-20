import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CaptureForSuggestion } from '../encounters/capture-for-suggestion.js';
import { scoreNews2 } from './news2.js';
import { REDACTED } from './redaction.js';
import { applyGuards } from './safety-guards.js';
import { buildSnapshot } from './triage-input.js';
import {
  PROMPT_VERSION,
  TriagePromptBuilder,
} from './triage-prompt.builder.js';
import { validateTriageResponse } from './triage-response.validator.js';

/** Captura con entrevista (F-11): el nombre y el documento aparecen en preguntas y respuestas para comprobar redact(). */
function capture(
  over: Partial<CaptureForSuggestion> = {},
): CaptureForSuggestion {
  return {
    status: 'WAITING_TRIAGE',
    chiefComplaintText: 'dolor de cabeza fuerte',
    complaintSource: 'TYPED',
    latestVitalSigns: {
      respiratoryRate: 16,
      oxygenSaturation: 98,
      supplementalOxygen: false,
      systolicBp: 120,
      diastolicBp: 80,
      heartRate: 72,
      consciousness: 'A',
      temperatureC: 36.8,
      glucoseMgDl: null,
    },
    symptomFindings: [],
    symptomInterview: {
      turns: [
        {
          dimension: 'ONSET',
          question: '¿Cuándo empezó, Marta?',
          answer: 'Ayer; mi cédula es 52.123.987',
        },
        {
          dimension: 'ALARM_SIGNS',
          question: '¿Has tenido desmayos?',
          answer: null,
        },
      ],
    },
    redFlags: ['LOSS_OF_CONSCIOUSNESS'],
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

/** Salida del LLM con los factores indicados (nivel 3, explicación fija). */
const output = (fields: string[]) =>
  JSON.stringify({
    level: 3,
    explanation: 'Cefalea sin alteración de signos vitales.',
    factors: fields.map((field) => ({ field, note: 'DEV-test' })),
  });

describe('buildSnapshot v2 (F-11-api)', () => {
  it('R9: añade follow_up con dimension, question y answer pasados por redact() y patient_reported_red_flags', () => {
    const s = buildSnapshot(capture(), '2026-11-18');
    expect(Object.keys(s).sort()).toEqual([
      'age_years',
      'chief_complaint_text',
      'complaint_source',
      'follow_up',
      'patient_reported_red_flags',
      'sex',
      'symptom_findings',
      'vital_signs',
    ]);
    expect(s.follow_up).toEqual([
      {
        dimension: 'ONSET',
        question: `¿Cuándo empezó, ${REDACTED}?`,
        answer: `Ayer; mi cédula es ${REDACTED}`,
      },
      {
        dimension: 'ALARM_SIGNS',
        question: '¿Has tenido desmayos?',
        answer: null,
      },
    ]);
    expect(s.patient_reported_red_flags).toEqual(['LOSS_OF_CONSCIOUSNESS']);
  });

  it('R9: la instantánea v2 no lleva el nombre ni el documento en ninguna forma', () => {
    const json = JSON.stringify(buildSnapshot(capture(), '2026-11-18'))
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    for (const pii of ['marta', 'lucia', 'gomez', '52123987', '52.123.987']) {
      expect(json).not.toContain(pii);
    }
  });

  it('R9: sin entrevista, follow_up es [] y patient_reported_red_flags lleva las señales de la atención (o [])', () => {
    expect(
      buildSnapshot(
        capture({ symptomInterview: null, redFlags: [] }),
        '2026-11-18',
      ),
    ).toMatchObject({ follow_up: [], patient_reported_red_flags: [] });
    expect(
      buildSnapshot(
        capture({ symptomInterview: null, redFlags: ['SEIZURE'] }),
        '2026-11-18',
      ),
    ).toMatchObject({ follow_up: [], patient_reported_red_flags: ['SEIZURE'] });
  });
});

describe('prompt triage-v2 (F-11-api)', () => {
  const builder = new TriagePromptBuilder();

  it('R9: PROMPT_VERSION es triage-v2 y el system sale de ai/prompts/triage-v2.md, que describe follow_up y patient_reported_red_flags', () => {
    const snapshot = buildSnapshot(capture(), '2026-11-18');
    const p = builder.build(snapshot);
    expect(PROMPT_VERSION).toBe('triage-v2');
    expect(p.promptVersion).toBe('triage-v2');
    const file = readFileSync(
      join(process.cwd(), 'ai', 'prompts', 'triage-v2.md'),
      'utf8',
    );
    expect(file).toContain(p.system.trim().slice(0, 200));
    expect(p.system).not.toContain('<!--');
    expect(p.system).toContain('follow_up');
    expect(p.system).toContain('patient_reported_red_flags');
    expect(p.system).toMatch(/no verificad/);
    expect(p.user).toBe(JSON.stringify(snapshot));
  });
});

describe('TriageResponseValidator con la instantánea v2 (F-11-api, sin mocks del LLM)', () => {
  const snapshot = buildSnapshot(capture(), '2026-11-18');

  it('R9: acepta citar follow_up[<n>] dentro del rango y patient_reported_red_flags si no está vacío', () => {
    expect(
      validateTriageResponse(
        output(['follow_up[0]', 'follow_up[1]', 'patient_reported_red_flags']),
        snapshot,
      ).valid,
    ).toBe(true);
  });

  it('R9: rechaza follow_up fuera de rango y patient_reported_red_flags vacío', () => {
    expect(
      validateTriageResponse(output(['follow_up[2]']), snapshot).valid,
    ).toBe(false);
    const empty = buildSnapshot(
      capture({ symptomInterview: null, redFlags: [] }),
      '2026-11-18',
    );
    expect(
      validateTriageResponse(output(['patient_reported_red_flags']), empty)
        .valid,
    ).toBe(false);
    expect(validateTriageResponse(output(['follow_up[0]']), empty).valid).toBe(
      false,
    );
  });
});

describe('SafetyGuards intactas (F-11-api, PA-F11-2, sin mocks del LLM)', () => {
  it('R10: las señales referidas por el paciente no cambian el nivel por sí mismas (signos normales → sin guard)', () => {
    const snapshot = buildSnapshot(
      capture({
        redFlags: [
          'CHEST_PAIN',
          'BREATHING_DIFFICULTY',
          'LOSS_OF_CONSCIOUSNESS',
          'SEIZURE',
          'SEVERE_BLEEDING',
          'STROKE_SIGNS',
          'SUICIDAL_IDEATION',
        ],
      }),
      '2026-11-18',
    );
    for (const level of [1, 2, 3, 4, 5]) {
      expect(applyGuards(level, scoreNews2(snapshot.vital_signs))).toEqual({
        suggestedLevel: level,
        guardApplied: false,
        guardReasons: [],
      });
    }
  });

  it('R10: applyGuards solo recibe el nivel del LLM y NEWS2 (no hay guard por señales)', () => {
    expect(applyGuards.length).toBe(2);
  });
});
