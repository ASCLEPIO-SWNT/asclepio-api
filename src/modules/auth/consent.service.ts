import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../common/config/app-config.js';

export interface Consent {
  version: string;
  text: string;
}

/**
 * Consentimiento de tratamiento de datos del paciente (D10, R38). El texto se lee UNA vez al arrancar desde
 * PATIENT_CONSENT_TEXT_PATH (relativo a process.cwd()); si falta o está vacío, la API no arranca.
 */
@Injectable()
export class ConsentService {
  private readonly consent: Consent;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    let text: string;
    try {
      text = readFileSync(
        resolve(process.cwd(), config.patientConsentTextPath),
        'utf8',
      );
    } catch {
      text = '';
    }
    if (!text.trim()) {
      throw new Error(
        'El archivo de PATIENT_CONSENT_TEXT_PATH no existe o está vacío.',
      );
    }
    this.consent = { version: config.patientConsentVersion, text };
  }

  current(): Consent {
    return { ...this.consent };
  }

  isCurrent(version: unknown): boolean {
    return version === this.consent.version;
  }
}
