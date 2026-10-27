/** Configuración de la API validada al arrancar: si falta algo obligatorio, la API no arranca (D2, D10). */
export interface AppConfig {
  jwtSecret: string;
  patientConsentVersion: string;
  patientConsentTextPath: string;
  throttleLimit: number;
  throttleTtlMs: number;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export const JWT_SECRET_MIN_BYTES = 32;
const DEFAULT_CONSENT_TEXT_PATH = 'docs/legal/consentimiento.md';
const DEFAULT_THROTTLE_LIMIT = 10;
const DEFAULT_THROTTLE_TTL_MS = 60_000;

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
  if (errors.length) {
    throw new Error(`Configuración inválida: ${errors.join('; ')}.`);
  }
  return {
    jwtSecret,
    patientConsentVersion,
    patientConsentTextPath,
    throttleLimit,
    throttleTtlMs,
  };
}
