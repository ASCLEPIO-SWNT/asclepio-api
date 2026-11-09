import {
  type LlmClient,
  LlmCallError,
  type LlmProviderName,
  type LlmRequest,
  type LlmResponse,
} from '../../src/modules/ai/llm/llm-client.js';

export type FakeStep =
  | { content: string; model?: string; tokens?: [number, number] }
  | { fail: LlmCallError['kind']; http?: number };

/**
 * LlmClient falso para las pruebas (un puerto, no el proveedor real: ninguna prueba llama a Groq ni a OpenRouter,
 * R32). Responde con los pasos programados (o con `fallback` si no quedan) y registra cada petición recibida.
 */
export class FakeLlmClient implements LlmClient {
  readonly requests: LlmRequest[] = [];
  private steps: FakeStep[] = [];

  constructor(
    readonly provider: LlmProviderName,
    readonly model: string,
    private fallback: FakeStep,
  ) {}

  /** Programa las respuestas de las próximas llamadas y olvida las peticiones anteriores. */
  script(...steps: FakeStep[]): void {
    this.steps = steps;
    this.requests.length = 0;
  }

  setFallback(step: FakeStep): void {
    this.fallback = step;
  }

  complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(req);
    const step = this.steps.shift() ?? this.fallback;
    if ('fail' in step) {
      return Promise.reject(new LlmCallError(step.fail, step.http ?? null));
    }
    return Promise.resolve({
      content: step.content,
      model: step.model ?? this.model,
      tokensIn: step.tokens?.[0] ?? null,
      tokensOut: step.tokens?.[1] ?? null,
      httpStatus: 200,
    });
  }
}

/** Salida válida para la toma VITALS de f03-fixtures (cita campos presentes en la instantánea). */
export function validOutput(level = 2): string {
  return JSON.stringify({
    level,
    explanation:
      'Dolor torácico con taquicardia: descartar síndrome coronario agudo.',
    factors: [
      { field: 'chief_complaint_text', note: 'Dolor torácico' },
      { field: 'vital_signs.heart_rate', note: 'Taquicardia' },
    ],
  });
}
