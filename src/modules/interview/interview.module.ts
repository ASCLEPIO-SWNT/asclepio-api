import { Module } from '@nestjs/common';
import { AiCoreModule } from '../ai/ai.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { InterviewAdvisor } from './interview-advisor.js';
import { InterviewController } from './interview.controller.js';
import { InterviewService } from './interview.service.js';

/**
 * Núcleo del fallback sin base de datos (como AiCoreModule): InterviewAdvisor sobre los puertos del LLM de `ai`. Lo
 * usan InterviewModule y npm run ai:eval.
 */
@Module({
  imports: [AiCoreModule],
  providers: [InterviewAdvisor],
  exports: [InterviewAdvisor],
})
export class InterviewCoreModule {}

/**
 * Entrevista de síntomas (F-11-api): reglas puras (las usa también encounters) y el fallback next-question. Sin tablas.
 * Usa `ai` (puertos del LLM, redact y presupuesto) y `patients` (nombre y documento para redact()).
 */
@Module({
  imports: [InterviewCoreModule, PatientsModule],
  controllers: [InterviewController],
  providers: [InterviewService],
})
export class InterviewModule {}
