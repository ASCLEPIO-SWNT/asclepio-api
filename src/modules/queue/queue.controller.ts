import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, StaffRoles } from '../../common/auth/decorators.js';
import type { StaffPrincipal } from '../../common/auth/principal.js';
import { ApiProblemResponse } from '../../common/problem/api-problem-response.js';
import { QueueDto, QueueQueryDto } from './dto/queue.dto.js';
import { QueueService } from './queue.service.js';

/** Cola priorizada (F-06-api): la leen medicina, enfermería y administración. */
@ApiTags('queue')
@Controller('queue')
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  @Get()
  @StaffRoles('PHYSICIAN', 'NURSE', 'ADMIN')
  @ApiOperation({
    summary: 'Cola priorizada por nivel y espera',
    description:
      'Atenciones activas del tenant (o de la sede siteId) en tres secciones: waitingTriage, triaged e inCare. La espera se mide desde la llegada (arrivalAt) hasta serverNow, con el reloj del servidor. Tiempos máximos de la Res. 5596 de 2015: nivel I = 0 min (inmediato) y nivel II = 30 min; III, IV y V sin tiempo máximo ni alerta (PA-F06-1). overdue solo en triaged. Del paciente solo se devuelven iniciales, edad y sexo.',
  })
  @ApiOkResponse({ type: QueueDto })
  @ApiProblemResponse(
    400,
    'siteId no es un UUID o hay un parámetro de consulta desconocido (errors[] con el campo).',
  )
  @ApiProblemResponse(401, 'Sin token válido.')
  @ApiProblemResponse(
    403,
    'Rol distinto de PHYSICIAN, NURSE o ADMIN, o token de paciente.',
  )
  get(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Query() q: QueueQueryDto,
  ): Promise<QueueDto> {
    return this.queue.get(principal, q.siteId);
  }
}
