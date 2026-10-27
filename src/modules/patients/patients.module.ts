import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PatientProfileController } from './patient-profile.controller.js';
import { PatientsController } from './patients.controller.js';
import { PatientsService } from './patients.service.js';

/** Servicio de patients, sin HTTP: lo importan auth y encounters. */
@Module({
  imports: [AuditModule],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}

/** Endpoints HTTP de patients (F-02). Solo lo importa AppModule (PATCH /patient/profile necesita el throttler). */
@Module({
  imports: [PatientsModule],
  controllers: [PatientsController, PatientProfileController],
})
export class PatientsHttpModule {}
