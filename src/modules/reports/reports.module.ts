import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { EncountersModule } from '../encounters/encounters.module.js';
import { TriageModule } from '../triage/triage.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/**
 * Reportes (F-07-api). Sin tablas propias: lee con EncountersService.listForReport, TriageDecisionsService
 * .listByEncounters y TriageSuggestionsService.listByEncounters (D2), y audita la exportación del CSV con AuditService.
 * De queue solo usa la constante pura MAX_WAIT_MINUTES_BY_LEVEL.
 */
@Module({
  imports: [EncountersModule, TriageModule, AiModule, AuditModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
