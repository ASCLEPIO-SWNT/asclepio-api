import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { TriageInputSnapshot } from './triage-input.js';

/**
 * Prompt vigente (D11). Un prompt publicado no se edita: un cambio crea una versión nueva y pasa por ai:eval.
 * triage-v2 (F-11-api, R9): la instantánea añade follow_up y patient_reported_red_flags.
 */
export const PROMPT_VERSION = 'triage-v2';

export interface TriagePrompt {
  promptVersion: string;
  system: string;
  /** La instantánea serializada: el único contenido derivado del paciente (R10). */
  user: string;
}

/** Lee ai/prompts/<versión>.md al arrancar y quita el comentario de cabecera (metadatos para humanos). */
export function loadPrompt(version = PROMPT_VERSION): string {
  const raw = readFileSync(
    join(process.cwd(), 'ai', 'prompts', `${version}.md`),
    'utf8',
  );
  return raw.replace(/^\s*<!--[\s\S]*?-->\s*/, '').trim();
}

@Injectable()
export class TriagePromptBuilder {
  private readonly system = loadPrompt();

  build(snapshot: TriageInputSnapshot): TriagePrompt {
    return {
      promptVersion: PROMPT_VERSION,
      system: this.system,
      user: JSON.stringify(snapshot),
    };
  }
}
