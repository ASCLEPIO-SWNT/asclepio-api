import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { UsersModule } from '../users/users.module.js';
import { EncounterEventsService } from './encounter-events.service.js';
import { EncountersController } from './encounters.controller.js';
import { EncountersService } from './encounters.service.js';
import { PatientPreRegistrationsController } from './patient-pre-registrations.controller.js';
import { PreRegistrationsController } from './pre-registrations.controller.js';
import { PreRegistrationsService } from './pre-registrations.service.js';

/**
 * Dueño de encounters, encounter_events y pre_registrations (D1). Usa patients, tenancy, auth, users y audit.
 * Exporta EncountersService (transition) para F-05/F-06.
 */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    PatientsModule,
    TenancyModule,
    UsersModule,
  ],
  controllers: [
    PatientPreRegistrationsController,
    PreRegistrationsController,
    EncountersController,
  ],
  providers: [
    EncounterEventsService,
    EncountersService,
    PreRegistrationsService,
  ],
  exports: [EncountersService],
})
export class EncountersModule {}
