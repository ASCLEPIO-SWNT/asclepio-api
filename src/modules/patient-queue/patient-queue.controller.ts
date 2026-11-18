import {
  Controller,
  Get,
  Headers,
  type MessageEvent,
  Query,
  Sse,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { decodeJwt } from 'jose';
import type { Observable } from 'rxjs';
import { CurrentPrincipal, PatientOnly } from '../../common/auth/decorators.js';
import type { PatientPrincipal } from '../../common/auth/principal.js';
import { ApiProblemResponse } from '../../common/problem/api-problem-response.js';
import {
  PatientQueueQueryDto,
  QueuePositionDto,
} from './dto/patient-queue.dto.js';
import { PatientQueueService } from './patient-queue.service.js';

/** Posición del paciente en la fila (F-10-api): el paciente sale solo de pid y tid del token (R13). */
@ApiTags('patient')
@Controller('patient/queue-position')
export class PatientQueueController {
  constructor(private readonly patientQueue: PatientQueueService) {}

  @Get()
  @PatientOnly()
  @ApiOperation({
    summary: 'Posición del paciente en la fila y espera estimada',
    description:
      'Instantánea de la atención activa del paciente del token: fase, posición dentro de la fase (el mismo orden de la cola del personal, limitado a su sede), personas delante y un rango de espera por el ritmo reciente de la sede (PA-F10-1, provisional). Sin atención activa → NO_ACTIVE. Nunca incluye identificadores, niveles de triage (tampoco el propio) ni datos de otros pacientes.',
  })
  @ApiOkResponse({ type: QueuePositionDto })
  @ApiProblemResponse(
    400,
    'Hay algún parámetro de consulta (no admite ninguno).',
  )
  @ApiProblemResponse(401, 'Sin token válido.')
  @ApiProblemResponse(403, 'Token de personal.')
  get(
    @CurrentPrincipal() principal: PatientPrincipal,
    // Solo para que ValidationPipe rechace cualquier parámetro (R13).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Query() _q: PatientQueueQueryDto,
  ): Promise<QueuePositionDto> {
    return this.patientQueue.snapshot(principal);
  }

  @Sse('stream')
  @PatientOnly()
  @ApiProduces('text/event-stream')
  @ApiOperation({
    summary: 'Posición del paciente en vivo (Server-Sent Events)',
    description:
      'Stream text/event-stream (ADR 0009). Al abrirlo envía un evento `position` cuyo data es un QueuePositionDto; después envía uno nuevo solo cuando la instantánea cambia: en ≤ 2 s tras un registro, una decisión de triage o un cambio de estado en la sede, y en un recálculo cada 15 s. Si el recálculo no cambia nada, envía el comentario de latido `: ping`. Cuando la atención termina (CLOSED o CANCELLED) envía `position` con phase = DONE y cierra; también cierra al vencer el token. El cliente se reconecta con backoff. Los errores 400, 401 y 403 llegan antes de abrir el stream, en application/problem+json.',
  })
  @ApiOkResponse({
    description:
      'event: position · data: QueuePositionDto (JSON); comentarios `: ping` de latido.',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  @ApiProblemResponse(
    400,
    'Hay algún parámetro de consulta (no admite ninguno).',
  )
  @ApiProblemResponse(401, 'Sin token válido.')
  @ApiProblemResponse(403, 'Token de personal.')
  stream(
    @CurrentPrincipal() principal: PatientPrincipal,
    @Headers('authorization') authorization: string,
    // Solo para que ValidationPipe rechace cualquier parámetro (R13).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Query() _q: PatientQueueQueryDto,
  ): Observable<MessageEvent> {
    // El guard ya verificó el token: aquí solo se lee su exp para cerrar el stream al vencer (R11).
    const { exp } = decodeJwt(authorization.replace(/^Bearer /, ''));
    return this.patientQueue.stream(principal, new Date((exp ?? 0) * 1000));
  }
}
