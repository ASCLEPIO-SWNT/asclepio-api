import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PatientPrincipal } from '../../common/auth/principal.js';
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
import { PatientsService } from '../patients/patients.service.js';
import type { NextQuestionRequestDto } from './dto/interview.dto.js';
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

/** De dónde salió la respuesta: solo para el log (sin contenido). */
type Source = 'RULES' | 'LIMIT' | 'LLM' | 'FIXED';

/**
 * Fallback de la entrevista en el servidor (F-11-api, R11–R15, ADR 0010). Sin estado ni base de datos (D4): no guarda
 * nada de la petición ni de la respuesta, y los logs solo llevan el resultado. El LLM se llama con el puerto LlmClient
 * de `ai` (Groq → OpenRouter, timeout por llamada, temperature 0 y json_schema strict) y el presupuesto total de F-04.
 */
@Injectable()
export class InterviewService {
  private readonly logger = new Logger('interview');
  private readonly system = loadPrompt(INTERVIEW_PROMPT_VERSION);

  constructor(
    @Inject(GROQ_CLIENT) private readonly groq: LlmClient,
    @Inject(OPENROUTER_CLIENT) private readonly openRouter: LlmClient,
    @Inject(ADVISOR_BUDGET) private readonly config: { totalBudgetMs: number },
    private readonly patients: PatientsService,
  ) {}

  async next(
    principal: PatientPrincipal,
    dto: NextQuestionRequestDto,
  ): Promise<NextQuestion> {
    const turns: InterviewTurn[] = dto.turns.map((t) => ({
      dimension: t.dimension,
      question: t.question,
      answer: t.answer,
    }));
    const { result, source, attempts } = await this.decide(
      principal,
      dto.chiefComplaintText,
      turns,
    );
    // R15: sin el motivo, las preguntas, las respuestas ni la salida del LLM.
    this.logger.log({
      msg: 'interview_next_question',
      kind: result.kind,
      source,
      llmAttempts: attempts,
      turns: turns.length,
      tenantId: principal.tenantId,
      accountId: principal.id,
    });
    return result;
  }

  private async decide(
    principal: PatientPrincipal,
    chiefComplaintText: string,
    turns: InterviewTurn[],
  ): Promise<{ result: NextQuestion; source: Source; attempts: number }> {
    // R11: primero las reglas deterministas sobre el motivo y las respuestas.
    const flags = detectRedFlags(
      chiefComplaintText,
      ...turns.flatMap((t) => (t.answer === null ? [] : [t.answer])),
    );
    if (flags.length) {
      return {
        result: { kind: 'RED_FLAG', redFlags: flags },
        source: 'RULES',
        attempts: 0,
      };
    }
    // R14: con el máximo de turnos, la entrevista termina.
    if (turns.length >= INTERVIEW_LIMITS.maxRequestTurns) {
      return { result: { kind: 'DONE' }, source: 'LIMIT', attempts: 0 };
    }

    // R15: el nombre y el documento salen del paciente del token (pid y tid), nunca del cuerpo.
    const patient = await this.patients.findById(
      principal.tenantId,
      principal.patientId,
    );
    const target: RedactionTarget = {
      fullName: patient?.fullName ?? null,
      documentNumber: patient?.documentNumber ?? null,
    };
    const user = JSON.stringify({
      chief_complaint_text: redact(chiefComplaintText, target),
      turns: turns.map((t) => ({
        dimension: t.dimension,
        question: redact(t.question, target),
        answer: t.answer === null ? null : redact(t.answer, target),
      })),
    });

    const budget = AbortSignal.timeout(this.config.totalBudgetMs);
    let calls = 0;
    for (let attempt = 1; attempt <= LLM_ATTEMPTS; attempt++) {
      const call = await this.complete(user, budget);
      calls += call.calls;
      if ('failures' in call) {
        // R12: timeout → pregunta fija. R17: sin ninguna salida del LLM y sin timeout → 503.
        if (attempt === 1 && !call.failures.includes('TIMEOUT')) {
          throw new ServiceUnavailableException(LLM_UNAVAILABLE);
        }
        break;
      }
      const checked = validateQuestion(call.content, turns);
      if (checked.valid) {
        return {
          result: this.fromOutput(checked.output, turns),
          source: 'LLM',
          attempts: calls,
        };
      }
    }
    // R12: dos salidas inválidas (o el timeout) → la pregunta fija de la primera dimensión no cubierta, o DONE.
    return { result: nextFallback(turns), source: 'FIXED', attempts: calls };
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
