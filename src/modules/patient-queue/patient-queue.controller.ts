import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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
}
