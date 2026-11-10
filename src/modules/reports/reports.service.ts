import { Injectable, Logger } from '@nestjs/common';
import type { StaffPrincipal } from '../../common/auth/principal.js';
import { Clock } from '../../common/clock/clock.js';
import { TriageSuggestionsService } from '../ai/triage-suggestions.service.js';
import { EncountersService } from '../encounters/encounters.service.js';
import { TriageDecisionsService } from '../triage/triage-decisions.service.js';
import type {
  ReportQueryDto,
  ReportSummaryDto,
} from './dto/report-summary.dto.js';
import { parsePeriod, type ReportPeriod } from './report-period.js';
import {
  buildRows,
  type ReportRow,
  type ReportSuggestionSource,
  summarize,
} from './report-rows.js';

interface Loaded {
  period: ReportPeriod;
  siteId: string | null;
  rows: ReportRow[];
  suggestions: ReportSuggestionSource[];
}

/**
 * Reportes de F-07-api (solo ADMIN). Sin tablas propias: lee con los services de encounters, triage y ai (D2) y calcula
 * con funciones puras. El resumen y el CSV comparten la misma carga (R16).
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger('reports');

  constructor(
    private readonly encounters: EncountersService,
    private readonly decisions: TriageDecisionsService,
    private readonly suggestions: TriageSuggestionsService,
    private readonly clock: Clock,
  ) {}

  /** Población, decisiones y sugerencias del tenant del token (R3, R4, R16, R17), en tres consultas (D2). */
  private async load(tenantId: string, q: ReportQueryDto): Promise<Loaded> {
    const period = parsePeriod(q.from, q.to);
    const encounters = await this.encounters.listForReport(
      tenantId,
      period.start,
      period.end,
      q.siteId,
    );
    const ids = encounters.map((e) => e.id);
    const [decisions, suggestions] = await Promise.all([
      this.decisions.listByEncounters(tenantId, ids),
      this.suggestions.listByEncounters(tenantId, ids),
    ]);
    return {
      period,
      siteId: q.siteId ?? null,
      rows: buildRows(encounters, decisions, suggestions),
      suggestions,
    };
  }

  /** GET /reports/summary (R5–R10): una sola lectura del reloj (generatedAt). */
  async summary(
    principal: StaffPrincipal,
    q: ReportQueryDto,
  ): Promise<ReportSummaryDto> {
    const generatedAt = this.clock.now();
    const { period, siteId, rows, suggestions } = await this.load(
      principal.tenantId,
      q,
    );
    const body = summarize(rows, suggestions);
    // Sin datos del paciente (R19): solo recuentos.
    this.logger.log({
      msg: 'report_summary_read',
      tenantId: principal.tenantId,
      userId: principal.id,
      encounters: body.population.encounters,
    });
    return {
      period: { from: period.from, to: period.to, siteId },
      generatedAt: generatedAt.toISOString(),
      ...body,
    };
  }
}
