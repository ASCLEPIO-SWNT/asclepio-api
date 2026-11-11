import { Controller, Get, Query, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
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

  @Get('encounters.csv')
  @StaffRoles('ADMIN')
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: 'CSV de atenciones del periodo (formato interno)',
    description:
      'Una fila por atención de la misma población que GET /reports/summary con los mismos parámetros, ordenadas por arrivalAt e id. FORMATO INTERNO documentado en docs/reports-csv.md: NO es el formato oficial de la Res. 373 ni de SISPRO. RFC 4180 (coma, CRLF, cabecera en la primera fila), UTF-8, horas ISO-8601 con -05:00, minutos con 1 decimal y vacío si no hay valor. Columnas: encounter_id, site_name, status, origin, complaint_source, arrival_at, triaged_at, in_care_at, closed_at, final_level, decision_action, suggestion_status, suggested_level, llm_level, guard_applied, provider, minutes_to_triage, minutes_triage_to_care (desde la clasificación hasta la atención médica, Res. 256 de 2016) y compliant (solo nivel II que llegó a IN_CARE: ≤ 30 min). Sin nombre, documento, motivo de consulta, motivo de corrección ni nombres del personal. Las celdas de texto que empiezan por =, +, -, @, tabulador o CR van precedidas de comilla simple. Cada descarga se audita (REPORT_EXPORTED).',
  })
  @ApiOkResponse({
    description:
      'CSV con Content-Disposition: attachment; filename="asclepio-atenciones-<from>_<to>.csv".',
    headers: {
      'Content-Disposition': {
        description:
          'attachment; filename="asclepio-atenciones-<from>_<to>.csv"',
        schema: { type: 'string' },
      },
    },
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  @ApiProblemResponse(400, BAD_PARAMS)
  @ApiProblemResponse(401, 'Sin token válido.')
  @ApiProblemResponse(403, 'Rol distinto de ADMIN, o token de paciente.')
  @ApiProblemResponse(422, BAD_PERIOD)
  async csv(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Query() q: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const out = await this.reports.csv(principal, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.filename}"`,
    );
    return out.body;
  }
}
