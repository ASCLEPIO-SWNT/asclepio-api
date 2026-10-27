import { loadAppConfig } from './app-config.js';

const valid = {
  JWT_SECRET: 'x'.repeat(32),
  PATIENT_CONSENT_VERSION: '2026-10-v1',
};

describe('loadAppConfig', () => {
  it('R1: la API no arranca si JWT_SECRET tiene menos de 32 bytes, y el error no muestra el valor', () => {
    expect(() =>
      loadAppConfig({ ...valid, JWT_SECRET: 'secreto-corto' }),
    ).toThrow(/JWT_SECRET/);
    expect(() =>
      loadAppConfig({ ...valid, JWT_SECRET: 'secreto-corto' }),
    ).not.toThrow(/secreto-corto/);
    expect(() =>
      loadAppConfig({ PATIENT_CONSENT_VERSION: '2026-10-v1' }),
    ).toThrow(/JWT_SECRET/);
  });

  it('R22: la API no arranca sin PATIENT_CONSENT_VERSION', () => {
    expect(() => loadAppConfig({ JWT_SECRET: valid.JWT_SECRET })).toThrow(
      /PATIENT_CONSENT_VERSION/,
    );
  });

  it('R39: el límite por defecto es 10 peticiones en 60 s y es configurable', () => {
    expect(loadAppConfig(valid)).toMatchObject({
      throttleLimit: 10,
      throttleTtlMs: 60_000,
      patientConsentTextPath: 'docs/legal/consentimiento.md',
    });
    expect(
      loadAppConfig({
        ...valid,
        THROTTLE_LIMIT: '50',
        THROTTLE_TTL_MS: '1000',
      }),
    ).toMatchObject({ throttleLimit: 50, throttleTtlMs: 1000 });
    expect(() => loadAppConfig({ ...valid, THROTTLE_LIMIT: 'abc' })).toThrow(
      /THROTTLE_LIMIT/,
    );
  });
});
