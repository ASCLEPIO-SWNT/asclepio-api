import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { EncountersModule } from '../encounters/encounters.module.js';
import { UsersModule } from '../users/users.module.js';
import { TriageDecisionsController } from './triage-decisions.controller.js';
import { TriageDecisionsService } from './triage-decisions.service.js';

/**
 * Dueño de triage_decisions (F-05-api). Usa encounters (bloqueo y recordTriage), ai (sugerencia vigente y su nivel),
 * audit (la auditoría la escribe recordTriage dentro de la transacción) y users (nombre del responsable).
 */
@Module({
  imports: [EncountersModule, AiModule, AuditModule, UsersModule],
  controllers: [TriageDecisionsController],
  providers: [TriageDecisionsService],
})
export class TriageModule {}
