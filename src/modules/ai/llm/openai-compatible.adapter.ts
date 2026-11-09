import type { LlmConfig } from '../../../common/config/app-config.js';
import {
  type LlmClient,
  LlmCallError,
  type LlmProviderName,
  type LlmRequest,
  type LlmResponse,
} from './llm-client.js';

export type FetchFn = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface AdapterOptions {
  provider: LlmProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Campos extra del cuerpo (OpenRouter: provider.ignore y require_parameters, D5). */
  extraBody?: Record<string, unknown>;
  fetch?: FetchFn;
}

interface ChatCompletion {
  model?: unknown;
  choices?: { message?: { content?: unknown } }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

const intOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;

/**
 * Único adaptador HTTP al LLM (D5): POST {baseUrl}/chat/completions de la API compatible con OpenAI, con fetch
 * nativo, temperature 0 y salida json_schema strict (R11). Aborta a los timeoutMs o con la señal externa (R13).
 * Los errores no llevan la clave ni los cuerpos (R27).
 */
export class OpenAiCompatibleAdapter implements LlmClient {
  readonly provider: LlmProviderName;
  readonly model: string;
  private readonly fetchFn: FetchFn;

  constructor(private readonly opts: AdapterOptions) {
    this.provider = opts.provider;
    this.model = opts.model;
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const timeout = AbortSignal.timeout(this.opts.timeoutMs);
    const signal = req.signal
      ? AbortSignal.any([timeout, req.signal])
      : timeout;
    const body = {
      model: this.opts.model,
      temperature: 0,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'triage_suggestion',
          strict: true,
          schema: req.schema,
        },
      },
      ...(this.opts.extraBody ?? {}),
    };
    let res: Response;
    let text: string;
    try {
      res = await this.fetchFn(`${this.opts.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
      text = await res.text();
    } catch {
      // La causa original puede llevar la URL, la clave o el cuerpo: no se propaga (R27).
      throw new LlmCallError(signal.aborted ? 'TIMEOUT' : 'NETWORK');
    }
    if (!res.ok) throw new LlmCallError('HTTP', res.status);
    let parsed: ChatCompletion;
    try {
      parsed = JSON.parse(text) as ChatCompletion;
    } catch {
      throw new LlmCallError('EMPTY', res.status);
    }
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new LlmCallError('EMPTY', res.status);
    }
    return {
      content,
      model:
        typeof parsed.model === 'string' && parsed.model
          ? parsed.model
          : this.opts.model,
      tokensIn: intOrNull(parsed.usage?.prompt_tokens),
      tokensOut: intOrNull(parsed.usage?.completion_tokens),
      httpStatus: res.status,
    };
  }
}

export function createGroqAdapter(
  config: LlmConfig,
  fetchFn?: FetchFn,
): OpenAiCompatibleAdapter {
  return new OpenAiCompatibleAdapter({
    provider: 'GROQ',
    baseUrl: GROQ_BASE_URL,
    apiKey: config.groq.apiKey,
    model: config.groq.model,
    timeoutMs: config.timeoutMs,
    fetch: fetchFn,
  });
}

/** OpenRouter como respaldo: nunca enrutado de vuelta a Groq y solo con proveedores que respetan el esquema (D5). */
export function createOpenRouterAdapter(
  config: LlmConfig,
  fetchFn?: FetchFn,
): OpenAiCompatibleAdapter {
  return new OpenAiCompatibleAdapter({
    provider: 'OPENROUTER',
    baseUrl: OPENROUTER_BASE_URL,
    apiKey: config.openRouter.apiKey,
    model: config.openRouter.model,
    timeoutMs: config.timeoutMs,
    extraBody: { provider: { ignore: ['groq'], require_parameters: true } },
    fetch: fetchFn,
  });
}
