import { Module } from '@nestjs/common';
import { loadLlmConfig } from '../../common/config/app-config.js';
import { AuditModule } from '../audit/audit.module.js';
import { EncountersModule } from '../encounters/encounters.module.js';
import { UsersModule } from '../users/users.module.js';
import { GROQ_CLIENT, OPENROUTER_CLIENT } from './llm/llm-client.js';
import {
  createGroqAdapter,
  createOpenRouterAdapter,
} from './llm/openai-compatible.adapter.js';
import { ADVISOR_BUDGET, TriageAdvisor } from './triage-advisor.js';
import { TriagePromptBuilder } from './triage-prompt.builder.js';
import { TriageSuggestionsController } from './triage-suggestions.controller.js';
import { TriageSuggestionsService } from './triage-suggestions.service.js';

export const LLM_CONFIG = Symbol('LLM_CONFIG');

/**
 * Núcleo de la sugerencia sin base de datos (D14): configuración del LLM, los dos adaptadores, el prompt y el
 * TriageAdvisor. Lo usan AiModule y npm run ai:eval.
 */
@Module({
  providers: [
    { provide: LLM_CONFIG, useFactory: () => loadLlmConfig() },
    {
      provide: GROQ_CLIENT,
      inject: [LLM_CONFIG],
      useFactory: createGroqAdapter,
    },
    {
      provide: OPENROUTER_CLIENT,
      inject: [LLM_CONFIG],
      useFactory: createOpenRouterAdapter,
    },
    { provide: ADVISOR_BUDGET, useExisting: LLM_CONFIG },
    TriagePromptBuilder,
    TriageAdvisor,
  ],
  exports: [TriageAdvisor, GROQ_CLIENT, OPENROUTER_CLIENT],
})
export class AiCoreModule {}

/**
 * Dueño de triage_suggestions (F-04-api). Usa encounters (lectura de la captura), audit y users (nombre del
 * responsable en la respuesta).
 */
@Module({
  imports: [AiCoreModule, EncountersModule, AuditModule, UsersModule],
  controllers: [TriageSuggestionsController],
  providers: [TriageSuggestionsService],
  // F-05-api: triage lee la sugerencia vigente y su nivel (findCurrent, findSuggestedLevel).
  exports: [TriageSuggestionsService],
})
export class AiModule {}
