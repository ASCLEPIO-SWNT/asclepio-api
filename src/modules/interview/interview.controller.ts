import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PatientOnly } from '../../common/auth/decorators.js';
import type { PatientPrincipal } from '../../common/auth/principal.js';
import { ApiProblemResponse } from '../../common/problem/api-problem-response.js';
import { PatientThrottled } from '../../common/throttle/patient-throttled.decorator.js';
import {
  NextQuestionDto,
  NextQuestionRequestDto,
} from './dto/interview.dto.js';
import { InterviewService } from './interview.service.js';

/** Límite del fallback por paciente (PA-F11-5): 30 peticiones cada 10 min. */
export const NEXT_QUESTION_THROTTLE = Object.freeze({
  limit: 30,
  ttlMs: 10 * 60_000,
});

/** Entrevista de síntomas en el servidor (F-11-api, ADR 0010): solo el paciente, sin estado. */
@ApiTags('patient')
@Controller('patient/symptom-interview')
export class InterviewController {
  constructor(private readonly interview: InterviewService) {}

  @Post('next-question')
  @HttpCode(200)
  @PatientOnly()
  @PatientThrottled(NEXT_QUESTION_THROTTLE.limit, NEXT_QUESTION_THROTTLE.ttlMs)
  @ApiOkResponse({
    type: NextQuestionDto,
    description:
      'Siguiente paso de la entrevista. Primero se aplican las reglas de señales de alarma (RED_FLAG). Nada de la petición ni de la respuesta se guarda ni se registra.',
  })
  @ApiProblemResponse(
    400,
    'Cuerpo inválido: motivo de 1 a 2000 caracteres, 0 a 5 turnos con dimension, question (1–200) y answer (1–500 o null), sin campos extra. Los errores no repiten los valores.',
  )
  @ApiProblemResponse(401, 'Sin token válido.')
  @ApiProblemResponse(403, 'Token de personal.')
  @ApiProblemResponse(
    503,
    'Ningún proveedor del LLM respondió: la app envía el pre-registro sin entrevista.',
  )
  next(
    @CurrentPrincipal() principal: PatientPrincipal,
    @Body() dto: NextQuestionRequestDto,
  ): Promise<NextQuestionDto> {
    return this.interview.next(principal, dto);
  }
}
