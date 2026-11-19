import { Injectable, Logger } from '@nestjs/common';
import type { PatientPrincipal } from '../../common/auth/principal.js';
import { PatientsService } from '../patients/patients.service.js';
import type { NextQuestionRequestDto } from './dto/interview.dto.js';
import { InterviewAdvisor } from './interview-advisor.js';
import type { InterviewTurn, NextQuestion } from './interview.rules.js';

/**
 * POST /patient/symptom-interview/next-question (F-11-api, R11–R15): resuelve el paciente del token para redact() y
 * delega en InterviewAdvisor. Sin estado ni base de datos propia (D4): no guarda nada de la petición ni de la
 * respuesta, y el log solo lleva el resultado.
 */
@Injectable()
export class InterviewService {
  private readonly logger = new Logger('interview');

  constructor(
    private readonly advisor: InterviewAdvisor,
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
    // R15: el nombre y el documento salen del paciente del token (pid y tid), nunca del cuerpo.
    const advice = await this.advisor.advise(
      dto.chiefComplaintText,
      turns,
      async () => {
        const p = await this.patients.findById(
          principal.tenantId,
          principal.patientId,
        );
        return {
          fullName: p?.fullName ?? null,
          documentNumber: p?.documentNumber ?? null,
        };
      },
    );
    // R15: sin el motivo, las preguntas, las respuestas ni la salida del LLM.
    this.logger.log({
      msg: 'interview_next_question',
      kind: advice.result.kind,
      source: advice.source,
      llmCalls: advice.llmCalls,
      turns: turns.length,
      tenantId: principal.tenantId,
      accountId: principal.id,
    });
    return advice.result;
  }
}
