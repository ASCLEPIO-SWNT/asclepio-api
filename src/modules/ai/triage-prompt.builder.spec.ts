import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TriageInputSnapshot } from './triage-input.js';
import {
  PROMPT_VERSION,
  TriagePromptBuilder,
} from './triage-prompt.builder.js';

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
    diastolic_bp: 95,
    heart_rate: 112,
    consciousness: 'A',
    temperature_c: 37.4,
    glucose_mg_dl: null,
  },
  symptom_findings: [],
};

describe('TriagePromptBuilder (D11)', () => {
  const builder = new TriagePromptBuilder();

  it('R11: usa el prompt versionado triage-v1 y su archivo ai/prompts/triage-v1.md', () => {
    const p = builder.build(SNAPSHOT);
    expect(PROMPT_VERSION).toBe('triage-v1');
    expect(p.promptVersion).toBe('triage-v1');
    const file = readFileSync(
      join(process.cwd(), 'ai', 'prompts', 'triage-v1.md'),
      'utf8',
    );
    // El comentario de cabecera (metadatos para humanos) no se envía.
    expect(p.system).not.toContain('<!--');
    expect(p.system).not.toContain('prompt_version');
    expect(file).toContain(p.system.trim().slice(0, 200));
  });

  it('R11: el system cita la Res. 5596 de 2015 (art. 5) con las cinco categorías y pide solo el JSON', () => {
    const { system } = builder.build(SNAPSHOT);
    expect(system).toContain('Resolución 5596 de 2015');
    for (const n of [
      '5.1. Triage I:',
      '5.2. Triage II:',
      '5.3. Triage III:',
      '5.4. Triage IV:',
      '5.5. Triage V:',
    ]) {
      expect(system).toContain(n);
    }
    expect(system).toContain(
      'requiere una atención que no debe superar los treinta (30) minutos',
    );
    expect(system).toMatch(/SOLO con un objeto JSON/);
    expect(system).toMatch(/No decides ni asignas el nivel/);
  });

  it('R8: el user es exactamente la instantánea en JSON y nada más del paciente', () => {
    const p = builder.build(SNAPSHOT);
    expect(p.user).toBe(JSON.stringify(SNAPSHOT));
    expect(JSON.parse(p.user)).toEqual(SNAPSHOT);
    expect(p.system).not.toContain('58');
    expect(p.system).not.toContain('dolor torácico opresivo de 40 minutos');
  });
});
