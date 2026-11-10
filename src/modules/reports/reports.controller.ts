import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, StaffRoles } from '../../common/auth/decorators.js';
import type { StaffPrincipal } from '../../common/auth/principal.js';
import { ApiProblemResponse } from '../../common/problem/api-problem-response.js';
import { ReportQueryDto, ReportSummaryDto } from './dto/report-summary.dto.js';
import { ReportsService } from './reports.service.js';

const BAD_PARAMS =
  'from o to ausentes o que no son fechas YYYY-MM-DD válidas, siteId que no es un UUID o un parámetro de consulta desconocido (errors[] con el campo).';
const BAD_PERIOD =
  'from posterior a to o periodo de más de 366 días (errors[] con el campo).';

/** Reportes de tiempos, cumplimiento, concordancia y CSV (F-07-api): solo administración. */
@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  @StaffRoles('ADMIN')
  @ApiOperation({
    summary: 'Resumen de indicadores del periodo',
    description:
      'Indicadores de las atenciones del tenant (o de la sede siteId) cuya llegada cae en el periodo [from 00:00 −05:00, to+1 00:00 −05:00) de America/Bogota: minutos de llegada a triage por nivel (n, mediana y p90), minutos de triage a atención de los niveles I y II, cumplimiento del nivel II (≤ 30 min desde la clasificación hasta la atención médica, como el indicador "Tiempo de espera Triage II" de la Res. 256 de 2016; el nivel I se informa sin porcentaje), concordancia IA–enfermería (acuerdo exacto, kappa de Cohen ponderado cuadrático, sub y sobreclasificación y matriz 5×5, solo con VALIDATE y CORRECT y la sugerencia decidida) y uso del respaldo y de los safety guards. Porcentajes con 1 decimal y null si el denominador es 0.',
  })
  @ApiOkResponse({ type: ReportSummaryDto })
  @ApiProblemResponse(400, BAD_PARAMS)
  @ApiProblemResponse(401, 'Sin token válido.')
  @ApiProblemResponse(403, 'Rol distinto de ADMIN, o token de paciente.')
  @ApiProblemResponse(422, BAD_PERIOD)
  summary(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Query() q: ReportQueryDto,
  ): Promise<ReportSummaryDto> {
    return this.reports.summary(principal, q);
  }
}
