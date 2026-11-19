import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ADVISOR_BUDGET } from '../ai/triage-advisor.js';
import {
  GROQ_CLIENT,
  type LlmCallErrorKind,
  type LlmClient,
  LlmCallError,
  OPENROUTER_CLIENT,
} from '../ai/llm/llm-client.js';
import { redact, type RedactionTarget } from '../ai/redaction.js';
import { loadPrompt } from '../ai/triage-prompt.builder.js';
import {
  answeredDimensions,
  detectRedFlags,
  INTERVIEW_LIMITS,
  type InterviewTurn,
  type NextQuestion,
  nextFallback,
  QUESTION_OUTPUT_SCHEMA,
  type QuestionOutput,
  validateQuestion,
} from './interview.rules.js';

/** Prompt del fallback (ai/prompts/interview-v1.md). */
export const INTERVIEW_PROMPT_VERSION = 'interview-v1';

/** Intentos de salida del LLM: uno y un reintento si no pasa el validador (R12). */
const LLM_ATTEMPTS = 2;

export const LLM_UNAVAILABLE =
  'El asistente no está disponible. Envía el pre-registro sin la entrevista.';

/** De dónde salió la respuesta: para el log y ai:eval (sin contenido). */
export type AdviceSource = 'RULES' | 'LIMIT' | 'LLM' | 'FIXED';

export interface InterviewAdvice {
  result: NextQuestion;
  source: AdviceSource;
  /** Llamadas a proveedores (Groq y OpenRouter). */
  llmCalls: number;
  /** Resultado del validador por cada salida recibida del LLM, en orden (R12). */
  outputs: ('VALID' | 'INVALID')[];
}

/**
 * Fallback de la entrevista sin base de datos (F-11-api, R11–R14, ADR 0010), como TriageAdvisor en F-04: lo comparten
 * el endpoint next-question y npm run ai:eval. Reglas de alarma primero, DONE con el máximo de turnos y, si no, el LLM
 * con el puerto LlmClient de `ai` (Groq → OpenRouter, timeout por llamada, temperature 0, json_schema strict y el
 * presupuesto total de F-04), el validador con un reintento y la pregunta fija. Nunca registra ni guarda contenido.
 */
@Injectable()
export class InterviewAdvisor {
  private readonly system = loadPrompt(INTERVIEW_PROMPT_VERSION);

  constructor(
    @Inject(GROQ_CLIENT) private readonly groq: LlmClient,
    @Inject(OPENROUTER_CLIENT) private readonly openRouter: LlmClient,
    @Inject(ADVISOR_BUDGET) private readonly config: { totalBudgetMs: number },
  ) {}

  /**
   * `target` da el nombre y el documento para redact() (R15); solo se resuelve si hace falta llamar al LLM.
   * 503 (R17) si ningún proveedor responde en el primer intento y no fue por timeout.
   */
  async advise(
    chiefComplaintText: string,
    turns: InterviewTurn[],
    target: () => Promise<RedactionTarget>,
  ): Promise<InterviewAdvice> {
    const none = { llmCalls: 0, outputs: [] };
    // R11: primero las reglas deterministas sobre el motivo y las respuestas.
    const flags = detectRedFlags(
      chiefComplaintText,
      ...turns.flatMap((t) => (t.answer === null ? [] : [t.answer])),
    );
    if (flags.length) {
      return {
        result: { kind: 'RED_FLAG', redFlags: flags },
        source: 'RULES',
        ...none,
      };
    }
    // R14: con el máximo de turnos, la entrevista termina.
    if (turns.length >= INTERVIEW_LIMITS.maxRequestTurns) {
      return { result: { kind: 'DONE' }, source: 'LIMIT', ...none };
    }

    const t = await target();
    const user = JSON.stringify({
      chief_complaint_text: redact(chiefComplaintText, t),
      turns: turns.map((x) => ({
        dimension: x.dimension,
        question: redact(x.question, t),
        answer: x.answer === null ? null : redact(x.answer, t),
      })),
    });

    const budget = AbortSignal.timeout(this.config.totalBudgetMs);
    let llmCalls = 0;
    const outputs: ('VALID' | 'INVALID')[] = [];
    for (let attempt = 1; attempt <= LLM_ATTEMPTS; attempt++) {
      const call = await this.complete(user, budget);
      llmCalls += call.calls;
      if ('failures' in call) {
        // R12: timeout → pregunta fija. R17: sin ninguna salida del LLM y sin timeout → 503.
        if (attempt === 1 && !call.failures.includes('TIMEOUT')) {
          throw new ServiceUnavailableException(LLM_UNAVAILABLE);
        }
        break;
      }
      const checked = validateQuestion(call.content, turns);
      outputs.push(checked.valid ? 'VALID' : 'INVALID');
      if (checked.valid) {
        return {
          result: this.fromOutput(checked.output, turns),
          source: 'LLM',
          llmCalls,
          outputs,
        };
      }
    }
    // R12: dos salidas inválidas (o el timeout) → la pregunta fija de la primera dimensión no cubierta, o DONE.
    return { result: nextFallback(turns), source: 'FIXED', llmCalls, outputs };
  }

  /** R13, R14: redFlagSuspected → RED_FLAG (las reglas no hallaron señales: lista vacía); done con ≥3 respondidas → DONE. */
  private fromOutput(o: QuestionOutput, turns: InterviewTurn[]): NextQuestion {
    if (o.redFlagSuspected) return { kind: 'RED_FLAG', redFlags: [] };
    if (
      o.done &&
      answeredDimensions(turns) >= INTERVIEW_LIMITS.minAnsweredForDone
    ) {
      return { kind: 'DONE' };
    }
    return { kind: 'QUESTION', dimension: o.dimension, question: o.question };
  }

  /** Groq y, si la llamada falla, OpenRouter (D4 de F-04). Sin presupuesto no se inicia otra llamada. */
  private async complete(
    user: string,
    budget: AbortSignal,
  ): Promise<
    | { content: string; calls: number }
    | { failures: LlmCallErrorKind[]; calls: number }
  > {
    const failures: LlmCallErrorKind[] = [];
    let calls = 0;
    for (const client of [this.groq, this.openRouter]) {
      if (budget.aborted) {
        failures.push('TIMEOUT');
        break;
      }
      calls++;
      try {
        const res = await client.complete({
          system: this.system,
          user,
          schema: QUESTION_OUTPUT_SCHEMA,
          signal: budget,
        });
        return { content: res.content, calls };
      } catch (e) {
        failures.push(e instanceof LlmCallError ? e.kind : 'NETWORK');
      }
    }
    return { failures, calls };
  }
}
