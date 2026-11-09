import { loadAppConfig, loadLlmConfig } from './app-config.js';

const LLM = {
  GROQ_API_KEY: 'gsk-ficticia-zz-groq',
  GROQ_MODEL: 'openai/gpt-oss-120b',
  OPENROUTER_API_KEY: 'sk-or-ficticia-zz-or',
  OPENROUTER_MODEL: 'openai/gpt-oss-120b',
};

const valid = {
  JWT_SECRET: 'x'.repeat(32),
  PATIENT_CONSENT_VERSION: '2026-10-v1',
  ...LLM,
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
      loadAppConfig({ PATIENT_CONSENT_VERSION: '2026-10-v1', ...LLM }),
    ).toThrow(/JWT_SECRET/);
  });

  it('R22: la API no arranca sin PATIENT_CONSENT_VERSION', () => {
    expect(() =>
      loadAppConfig({ JWT_SECRET: valid.JWT_SECRET, ...LLM }),
    ).toThrow(/PATIENT_CONSENT_VERSION/);
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

describe('loadLlmConfig (F-04-api)', () => {
  it('R29: falta cada variable obligatoria del LLM → error que la nombra sin mostrar ningún valor', () => {
    for (const name of Object.keys(LLM) as (keyof typeof LLM)[]) {
      for (const missing of [undefined, '', '   ']) {
        const env: NodeJS.ProcessEnv = { ...LLM, [name]: missing };
        let message = '';
        try {
          loadLlmConfig(env);
        } catch (e) {
          message = (e as Error).message;
        }
        expect([name, message.includes(name)]).toEqual([name, true]);
        for (const value of Object.values(LLM)) {
          expect(message).not.toContain(value);
        }
      }
    }
    // La API completa tampoco arranca sin ellas.
    expect(() =>
      loadAppConfig({ ...valid, OPENROUTER_API_KEY: undefined }),
    ).toThrow(/OPENROUTER_API_KEY/);
  });

  it('R29: LLM_TIMEOUT_MS y LLM_TOTAL_BUDGET_MS valen 8000 y 20000 por defecto', () => {
    expect(loadLlmConfig(LLM)).toEqual({
      groq: { apiKey: LLM.GROQ_API_KEY, model: LLM.GROQ_MODEL },
      openRouter: {
        apiKey: LLM.OPENROUTER_API_KEY,
        model: LLM.OPENROUTER_MODEL,
      },
      timeoutMs: 8000,
      totalBudgetMs: 20000,
    });
    expect(loadAppConfig(valid).llm).toEqual(loadLlmConfig(LLM));
    expect(
      loadLlmConfig({
        ...LLM,
        LLM_TIMEOUT_MS: '5000',
        LLM_TOTAL_BUDGET_MS: '12000',
      }),
    ).toMatchObject({ timeoutMs: 5000, totalBudgetMs: 12000 });
  });

  it('R29: LLM_TIMEOUT_MS y LLM_TOTAL_BUDGET_MS deben ser enteros positivos y el timeout no puede superar el presupuesto', () => {
    for (const [name, raw] of [
      ['LLM_TIMEOUT_MS', 'abc'],
      ['LLM_TIMEOUT_MS', '0'],
      ['LLM_TIMEOUT_MS', '-5'],
      ['LLM_TIMEOUT_MS', '2.5'],
      ['LLM_TOTAL_BUDGET_MS', 'zz-presupuesto'],
      ['LLM_TOTAL_BUDGET_MS', '0'],
    ]) {
      let message = '';
      try {
        loadLlmConfig({ ...LLM, [name]: raw });
      } catch (e) {
        message = (e as Error).message;
      }
      expect([name, raw, message.includes(name)]).toEqual([name, raw, true]);
      expect(message).not.toContain(`${raw}`.length > 1 ? raw : 'zz');
    }
    expect(() =>
      loadLlmConfig({
        ...LLM,
        LLM_TIMEOUT_MS: '9000',
        LLM_TOTAL_BUDGET_MS: '8000',
      }),
    ).toThrow(/LLM_TIMEOUT_MS.*LLM_TOTAL_BUDGET_MS/);
    expect(() =>
      loadLlmConfig({
        ...LLM,
        LLM_TIMEOUT_MS: '8000',
        LLM_TOTAL_BUDGET_MS: '8000',
      }),
    ).not.toThrow();
  });
});
