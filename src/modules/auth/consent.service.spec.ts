import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '../../common/config/app-config.js';
import { ConsentService } from './consent.service.js';

describe('ConsentService', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asclepio-consent-'));
  const config = (path: string) =>
    ({
      patientConsentVersion: '2026-10-v1',
      patientConsentTextPath: path,
    }) as AppConfig;

  it('R38: devuelve la versión de PATIENT_CONSENT_VERSION y el texto del archivo configurado', () => {
    const file = join(dir, 'ok.md');
    writeFileSync(file, '# Texto de prueba\n');
    expect(new ConsentService(config(file)).current()).toEqual({
      version: '2026-10-v1',
      text: '# Texto de prueba\n',
    });
  });

  it('R38: la API no arranca si el archivo de consentimiento no existe o está vacío', () => {
    expect(() => new ConsentService(config(join(dir, 'no-existe.md')))).toThrow(
      /PATIENT_CONSENT_TEXT_PATH/,
    );
    const empty = join(dir, 'vacio.md');
    writeFileSync(empty, '  \n');
    expect(() => new ConsentService(config(empty))).toThrow(
      /PATIENT_CONSENT_TEXT_PATH/,
    );
  });

  it('R38: por defecto lee docs/legal/consentimiento.md desde la raíz del repo', () => {
    const svc = new ConsentService(config('docs/legal/consentimiento.md'));
    expect(svc.current().text).toBe(
      readFileSync('docs/legal/consentimiento.md', 'utf8'),
    );
  });

  it('R22: isCurrent solo acepta exactamente la versión vigente', () => {
    const svc = new ConsentService(config('docs/legal/consentimiento.md'));
    expect(svc.isCurrent('2026-10-v1')).toBe(true);
    expect(svc.isCurrent('2026-09-v1')).toBe(false);
    expect(svc.isCurrent(undefined)).toBe(false);
    expect(svc.isCurrent(1)).toBe(false);
  });
});
