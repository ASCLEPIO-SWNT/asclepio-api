import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  GROQ_CLIENT,
  type LlmClient,
  LlmCallError,
  type LlmProviderName,
  OPENROUTER_CLIENT,
} from './llm/llm-client.js';
import { scoreNews2 } from './news2.js';
import { applyGuards, type GuardReason } from './safety-guards.js';
import type { TriageInputSnapshot } from './triage-input.js';
import { TriagePromptBuilder } from './triage-prompt.builder.js';
import {
  TRIAGE_OUTPUT_SCHEMA,
  type TriageFactor,
  validateTriageResponse,
} from './triage-response.validator.js';

export type SuggestionStatus = 'OK' | 'INVALID_OUTPUT' | 'TIMEOUT' | 'FAILED';

export type AttemptOutcome =
  | 'OK'
  | 'INVALID_OUTPUT'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'HTTP'
  | 'EMPTY'
  | 'BUDGET_EXHAUSTED';

/** Una entrada por llamada a un proveedor (D2). */
export interface Attempt {
  provider: LlmProviderName;
  model: string;
  outcome: AttemptOutcome;
  latencyMs: number;
  httpStatus: number | null;
}

export interface AdvisorResult {
  status: SuggestionStatus;
  llmLevel: number | null;
  suggestedLevel: number | null;
  explanation: { summary: string; factors: TriageFactor[] } | null;
  guardApplied: boolean;
  guardReasons: GuardReason[];
  provider: LlmProviderName | null;
  model: string | null;
  promptVersion: string;
  rawResponse: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
  attempts: Attempt[];
}

/** Reloj monotónico y señal del presupuesto total (sustituibles en pruebas). */
export interface AdvisorTimer {
  now(): number;
  budget(ms: number): AbortSignal;
}

export const ADVISOR_TIMER = Symbol('ADVISOR_TIMER');
export const ADVISOR_BUDGET = Symbol('ADVISOR_BUDGET');

export const SYSTEM_TIMER: AdvisorTimer = {
  now: () => performance.now(),
  budget: (ms) => AbortSignal.timeout(ms),
};

/**
 * TriageAdvisor (F-04-api): prompt → Groq → (fallo de llamada) OpenRouter → validador → SafetyGuards. Sin base de
 * datos: lo comparten el endpoint y npm run ai:eval (D14). Una salida inválida no pasa al otro proveedor (R15, D4);
 * el presupuesto total aborta la llamada en curso y no deja iniciar otra (R13). Nunca registra la instantánea ni la
 * respuesta cruda (R27).
 */
@Injectable()
export class TriageAdvisor {
  constructor(
    @Inject(GROQ_CLIENT) private readonly groq: LlmClient,
    @Inject(OPENROUTER_CLIENT) private readonly openRouter: LlmClient,
    private readonly prompts: TriagePromptBuilder,
    @Inject(ADVISOR_BUDGET) private readonly config: { totalBudgetMs: number },
    @Optional()
    @Inject(ADVISOR_TIMER)
    private readonly timer: AdvisorTimer = SYSTEM_TIMER,
  ) {
    this.timer ??= SYSTEM_TIMER;
  }

  async advise(snapshot: TriageInputSnapshot): Promise<AdvisorResult> {
    const prompt = this.prompts.build(snapshot);
    const start = this.timer.now();
    const budget = this.timer.budget(this.config.totalBudgetMs);
    const attempts: Attempt[] = [];
    const elapsed = () => Math.max(0, Math.round(this.timer.now() - start));
    const base = {
      llmLevel: null,
      suggestedLevel: null,
      explanation: null,
      guardApplied: false,
      guardReasons: [] as GuardReason[],
      promptVersion: prompt.promptVersion,
      rawResponse: null,
      tokensIn: null,
      tokensOut: null,
    };

    for (const client of [this.groq, this.openRouter]) {
      if (budget.aborted) break; // R13/R14: sin presupuesto no se inicia otra llamada.
      const t0 = this.timer.now();
      const since = () => Math.max(0, Math.round(this.timer.now() - t0));
      try {
        const res = await client.complete({
          system: prompt.system,
          user: prompt.user,
          schema: TRIAGE_OUTPUT_SCHEMA,
          signal: budget,
        });
        const checked = validateTriageResponse(res.content, snapshot);
        attempts.push({
          provider: client.provider,
          model: res.model,
          outcome: checked.valid ? 'OK' : 'INVALID_OUTPUT',
          latencyMs: since(),
          httpStatus: res.httpStatus,
        });
        const responded = {
          ...base,
          provider: client.provider,
          model: res.model,
          rawResponse: res.content,
          tokensIn: res.tokensIn,
          tokensOut: res.tokensOut,
          attempts,
        };
        if (!checked.valid) {
          return {
            ...responded,
            status: 'INVALID_OUTPUT',
            latencyMs: elapsed(),
          };
        }
        const { level, explanation, factors } = checked.output;
        const guards = applyGuards(level, scoreNews2(snapshot.vital_signs));
        return {
          ...responded,
          status: 'OK',
          llmLevel: level,
          suggestedLevel: guards.suggestedLevel,
          explanation: { summary: explanation, factors },
          guardApplied: guards.guardApplied,
          guardReasons: guards.guardReasons,
          latencyMs: elapsed(),
        };
      } catch (e) {
        const err = e instanceof LlmCallError ? e : null;
        attempts.push({
          provider: client.provider,
          model: client.model,
          // Un aborto por el presupuesto total (no por el timeout de la llamada) queda como BUDGET_EXHAUSTED.
          outcome:
            err?.kind === 'TIMEOUT' && budget.aborted
              ? 'BUDGET_EXHAUSTED'
              : (err?.kind ?? 'NETWORK'),
          latencyMs: since(),
          httpStatus: err?.httpStatus ?? null,
        });
      }
    }

    const last = attempts[attempts.length - 1];
    const allTimeouts = attempts.every(
      (a) => a.outcome === 'TIMEOUT' || a.outcome === 'BUDGET_EXHAUSTED',
    );
    return {
      ...base,
      status: allTimeouts ? 'TIMEOUT' : 'FAILED',
      provider: last?.provider ?? null,
      model: last?.model ?? null,
      latencyMs: elapsed(),
      attempts,
    };
  }
}
