import { Module } from '@nestjs/common';
import { AiCoreModule } from '../ai/ai.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { InterviewController } from './interview.controller.js';
import { InterviewService } from './interview.service.js';

/**
 * Entrevista de síntomas (F-11-api): reglas puras (las usa también encounters) y el fallback next-question. Sin tablas.
 * Usa el LLM de `ai` (AiCoreModule: puertos GROQ_CLIENT/OPENROUTER_CLIENT y presupuesto) y `patients` (nombre y
 * documento para redact()).
 */
@Module({
  imports: [AiCoreModule, PatientsModule],
  controllers: [InterviewController],
  providers: [InterviewService],
})
export class InterviewModule {}
