import { Module } from '@nestjs/common';
import { EncountersModule } from '../encounters/encounters.module.js';
import { PatientQueueController } from './patient-queue.controller.js';
import { PatientQueueService } from './patient-queue.service.js';

/**
 * Posición del paciente en la fila (F-10-api). Sin tablas propias: lee con EncountersService y ordena con la función
 * pura buildQueue de queue (D2). Instantánea y stream SSE (ADR 0009).
 */
@Module({
  imports: [EncountersModule],
  controllers: [PatientQueueController],
  providers: [PatientQueueService],
})
export class PatientQueueModule {}
