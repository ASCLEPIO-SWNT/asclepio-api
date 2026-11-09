/**
 * Puerto LlmClient (F-04-api): una llamada a un proveedor LLM compatible con OpenAI. Las pruebas lo sustituyen por un
 * cliente falso; solo los adaptadores de este directorio hacen HTTP al LLM (docs/architecture.md).
 */

export type LlmProviderName = 'GROQ' | 'OPENROUTER';

export interface LlmRequest {
  system: string;
  user: string;
  /** Esquema JSON de la salida (response_format json_schema strict). */
  schema: object;
  /** Señal externa (presupuesto total, R13). */
  signal?: AbortSignal;
}

export interface LlmResponse {
  content: string;
  /** El que informa la respuesta del proveedor; si no lo informa, el configurado (R20). */
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  httpStatus: number;
}

/** Fallo de llamada (R13): timeout, red, HTTP distinto de 2xx o cuerpo sin mensaje del asistente. */
export type LlmCallErrorKind = 'TIMEOUT' | 'NETWORK' | 'HTTP' | 'EMPTY';

/** Error sin la clave ni los cuerpos de la petición o la respuesta (R27). */
export class LlmCallError extends Error {
  constructor(
    readonly kind: LlmCallErrorKind,
    readonly httpStatus: number | null = null,
  ) {
    super(
      `Fallo de llamada al LLM: ${kind}${httpStatus ? ` (HTTP ${httpStatus})` : ''}.`,
    );
    this.name = 'LlmCallError';
  }
}

export interface LlmClient {
  readonly provider: LlmProviderName;
  /** Modelo configurado (PA-F04-2). */
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Tokens de inyección de los dos proveedores (se sustituyen en las pruebas). */
export const GROQ_CLIENT = Symbol('GROQ_CLIENT');
export const OPENROUTER_CLIENT = Symbol('OPENROUTER_CLIENT');
