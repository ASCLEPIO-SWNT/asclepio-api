// Respuestas programadas del seed (F-09-api): sustituyen a los adaptadores de Groq y OpenRouter SOLO dentro de
// npm run db:seed. Nunca hay HTTP: así las sugerencias sembradas pasan por el TriageAdvisor, el validador y los
// SafetyGuards reales, con estado, proveedor, intentos y guards coherentes con los CHECK de F-04, sin llamar al LLM.
import {
  type LlmClient,
  LlmCallError,
  type LlmProviderName,
  type LlmResponse,
} from '../../modules/ai/llm/llm-client.js';
import type { AdvisorTimer } from '../../modules/ai/triage-advisor.js';
import {
  SEED_LLM_MODEL,
  type SeedLlmPlan,
  type SeedVitals,
} from './seed-data.js';

/** Latencias simuladas (ms) del reloj virtual del advisor: la sugerencia guarda una latency_ms verosímil. */
const LATENCY = { ok: 1_400, rateLimited: 300, failed: 450, timeout: 8_000 };

export class SeedLlm {
  readonly groq: LlmClient;
  readonly openRouter: LlmClient;
  /** Reloj monotónico virtual: avanza solo con las latencias simuladas; el presupuesto nunca se agota. */
  readonly timer: AdvisorTimer = {
    now: () => this.virtualMs,
    budget: () => new AbortController().signal,
  };
  private virtualMs = 0;
  private plan: { plan: SeedLlmPlan; content: string | null } | null = null;

  constructor() {
    this.groq = this.client('GROQ');
    this.openRouter = this.client('OPENROUTER');
  }

  /** Programa la respuesta de la próxima solicitud de sugerencia (una sola vez). */
  program(plan: SeedLlmPlan, vitals: SeedVitals): void {
    this.plan = {
      plan,
      content: plan.kind === 'OK' ? seedOutput(plan, vitals) : null,
    };
  }

  /** Olvida la respuesta programada (tras cada solicitud). */
  clear(): void {
    this.plan = null;
  }

  private client(provider: LlmProviderName): LlmClient {
    return {
      provider,
      model: SEED_LLM_MODEL,
      complete: () => this.answer(provider),
    };
  }

  private answer(provider: LlmProviderName): Promise<LlmResponse> {
    const p = this.plan;
    if (!p) return Promise.reject(new LlmCallError('NETWORK'));
    const fail = (
      kind: LlmCallError['kind'],
      http: number | null,
      ms: number,
    ) => {
      this.virtualMs += ms;
      return Promise.reject(new LlmCallError(kind, http));
    };
    if (p.plan.kind === 'TIMEOUT')
      return fail('TIMEOUT', null, LATENCY.timeout);
    if (p.plan.kind === 'FAILED') {
      return fail('HTTP', provider === 'GROQ' ? 503 : 502, LATENCY.failed);
    }
    if (p.plan.provider !== provider) {
      return fail('HTTP', 429, LATENCY.rateLimited);
    }
    this.virtualMs += LATENCY.ok + p.plan.level * 90;
    return Promise.resolve({
      content: p.content ?? '',
      model: SEED_LLM_MODEL,
      tokensIn: null,
      tokensOut: null,
      httpStatus: 200,
    });
  }
}

/** Salida con la forma de TRIAGE_OUTPUT_SCHEMA; los factores citan campos presentes en la instantánea. */
export function seedOutput(
  plan: Extract<SeedLlmPlan, { kind: 'OK' }>,
  v: SeedVitals,
): string {
  return JSON.stringify({
    level: plan.level,
    explanation: plan.summary,
    factors: [
      { field: 'chief_complaint_text', note: 'Motivo de consulta' },
      { field: 'vital_signs.heart_rate', note: `FC ${v.heartRate} lpm` },
      { field: 'vital_signs.spo2', note: `SatO2 ${v.oxygenSaturation} %` },
      {
        field: 'vital_signs.systolic_bp',
        note: `PA ${v.systolicBp}/${v.diastolicBp} mmHg`,
      },
    ],
  });
}
