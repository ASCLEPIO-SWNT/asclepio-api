/** Configuración de la API validada al arrancar: si falta algo obligatorio, la API no arranca (D2, D10). */
export interface AppConfig {
  jwtSecret: string;
  patientConsentVersion: string;
  patientConsentTextPath: string;
  throttleLimit: number;
  throttleTtlMs: number;
  llm: LlmConfig;
}

/** Proveedores LLM de F-04-api (PA-F04-2, PA-F04-3): modelo fijado por proveedor, timeout por llamada y presupuesto. */
export interface LlmConfig {
  groq: { apiKey: string; model: string };
  openRouter: { apiKey: string; model: string };
  timeoutMs: number;
  totalBudgetMs: number;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export const JWT_SECRET_MIN_BYTES = 32;
const DEFAULT_CONSENT_TEXT_PATH = 'docs/legal/consentimiento.md';
const DEFAULT_THROTTLE_LIMIT = 10;
const DEFAULT_THROTTLE_TTL_MS = 60_000;
/** PA-F04-3 (humano, 2026-11-09): 8 s por llamada y 20 s en total. */
export const DEFAULT_LLM_TIMEOUT_MS = 8_000;
export const DEFAULT_LLM_TOTAL_BUDGET_MS = 20_000;
const LLM_REQUIRED = [
  'GROQ_API_KEY',
  'GROQ_MODEL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
] as const;

function positiveInt(
  raw: string | undefined,
  fallback: number,
  name: string,
  errors: string[],
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    errors.push(`${name} debe ser un entero positivo`);
    return fallback;
  }
  return n;
}

function readLlmConfig(env: NodeJS.ProcessEnv, errors: string[]): LlmConfig {
  const values: Record<string, string> = {};
  for (const name of LLM_REQUIRED) {
    values[name] = (env[name] ?? '').trim();
    if (!values[name]) errors.push(`${name} es obligatoria`);
  }
  const timeoutMs = positiveInt(
    env.LLM_TIMEOUT_MS,
    DEFAULT_LLM_TIMEOUT_MS,
    'LLM_TIMEOUT_MS',
    errors,
  );
  const totalBudgetMs = positiveInt(
    env.LLM_TOTAL_BUDGET_MS,
    DEFAULT_LLM_TOTAL_BUDGET_MS,
    'LLM_TOTAL_BUDGET_MS',
    errors,
  );
  if (timeoutMs > totalBudgetMs) {
    errors.push('LLM_TIMEOUT_MS no puede superar LLM_TOTAL_BUDGET_MS');
  }
  return {
    groq: { apiKey: values.GROQ_API_KEY, model: values.GROQ_MODEL },
    openRouter: {
      apiKey: values.OPENROUTER_API_KEY,
      model: values.OPENROUTER_MODEL,
    },
    timeoutMs,
    totalBudgetMs,
  };
}

/**
 * Configuración del LLM (R29 de F-04-api), reutilizable por npm run ai:eval sin el resto de la API.
 * Los mensajes de error nombran la variable, nunca su valor.
 */
export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const errors: string[] = [];
  const llm = readLlmConfig(env, errors);
  if (errors.length) {
    throw new Error(`Configuración inválida: ${errors.join('; ')}.`);
  }
  return llm;
}

/** Lee y valida el entorno. Los mensajes de error nombran la variable, nunca su valor. */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const errors: string[] = [];
  const jwtSecret = env.JWT_SECRET ?? '';
  if (Buffer.byteLength(jwtSecret, 'utf8') < JWT_SECRET_MIN_BYTES) {
    errors.push(`JWT_SECRET debe tener al menos ${JWT_SECRET_MIN_BYTES} bytes`);
  }
  const patientConsentVersion = (env.PATIENT_CONSENT_VERSION ?? '').trim();
  if (!patientConsentVersion) {
    errors.push('PATIENT_CONSENT_VERSION es obligatoria');
  }
  const patientConsentTextPath =
    env.PATIENT_CONSENT_TEXT_PATH?.trim() || DEFAULT_CONSENT_TEXT_PATH;
  const throttleLimit = positiveInt(
    env.THROTTLE_LIMIT,
    DEFAULT_THROTTLE_LIMIT,
    'THROTTLE_LIMIT',
    errors,
  );
  const throttleTtlMs = positiveInt(
    env.THROTTLE_TTL_MS,
    DEFAULT_THROTTLE_TTL_MS,
    'THROTTLE_TTL_MS',
    errors,
  );
  const llm = readLlmConfig(env, errors);
  if (errors.length) {
    throw new Error(`Configuración inválida: ${errors.join('; ')}.`);
  }
  return {
    llm,
    jwtSecret,
    patientConsentVersion,
    patientConsentTextPath,
    throttleLimit,
    throttleTtlMs,
  };
}
