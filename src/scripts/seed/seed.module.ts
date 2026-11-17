import { type DynamicModule, Module } from '@nestjs/common';
import { Clock, type FixedClock } from '../../common/clock/clock.js';
import { DEFAULT_LLM_TOTAL_BUDGET_MS } from '../../common/config/app-config.js';
import { ConfigModule } from '../../common/config/config.module.js';
import { PrismaModule } from '../../common/prisma/prisma.module.js';
import { ThrottleModule } from '../../common/throttle/throttle.module.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../../modules/ai/llm/llm-client.js';
import {
  ADVISOR_BUDGET,
  ADVISOR_TIMER,
  TriageAdvisor,
} from '../../modules/ai/triage-advisor.js';
import { TriagePromptBuilder } from '../../modules/ai/triage-prompt.builder.js';
import { TriageSuggestionsService } from '../../modules/ai/triage-suggestions.service.js';
import { AuditModule } from '../../modules/audit/audit.module.js';
import { AuthModule } from '../../modules/auth/auth.module.js';
import { PasswordModule } from '../../modules/auth/password/password.module.js';
import { EncountersModule } from '../../modules/encounters/encounters.module.js';
import { PatientsModule } from '../../modules/patients/patients.module.js';
import { TenancyModule } from '../../modules/tenancy/tenancy.module.js';
import { TriageDecisionsService } from '../../modules/triage/triage-decisions.service.js';
import { UsersModule } from '../../modules/users/users.module.js';
import type { SeedLlm } from './seed-llm.js';

/** Reloj global del seed: un FixedClock que el runner mueve a la hora de cada paso (en lugar de ClockModule). */
@Module({})
class SeedClockModule {
  static register(clock: FixedClock): DynamicModule {
    return {
      module: SeedClockModule,
      global: true,
      providers: [{ provide: Clock, useValue: clock }],
      exports: [Clock],
    };
  }
}

/**
 * Contexto del seed (F-09-api): los services reales de los módulos dueños con un reloj fijo y, en vez de AiCoreModule,
 * el TriageAdvisor real conectado a las respuestas programadas de SeedLlm (sin HTTP, nunca llama al LLM). Conecta con
 * DATABASE_URL como la API: asclepio_app tiene todos los permisos que el seed necesita (INSERT en las tablas
 * append-only, INSERT/UPDATE en encounters y pre_registrations), así que no hace falta el rol dueño.
 */
@Module({})
export class SeedModule {
  static register(clock: FixedClock, llm: SeedLlm): DynamicModule {
    return {
      module: SeedModule,
      imports: [
        ConfigModule,
        PrismaModule,
        SeedClockModule.register(clock),
        // AuthModule declara controladores con ThrottlerGuard: hace falta su configuración aunque no haya HTTP.
        ThrottleModule,
        AuditModule,
        TenancyModule,
        UsersModule,
        PasswordModule,
        PatientsModule,
        AuthModule,
        EncountersModule,
      ],
      providers: [
        { provide: GROQ_CLIENT, useValue: llm.groq },
        { provide: OPENROUTER_CLIENT, useValue: llm.openRouter },
        {
          provide: ADVISOR_BUDGET,
          useValue: { totalBudgetMs: DEFAULT_LLM_TOTAL_BUDGET_MS },
        },
        { provide: ADVISOR_TIMER, useValue: llm.timer },
        TriagePromptBuilder,
        TriageAdvisor,
        TriageSuggestionsService,
        TriageDecisionsService,
      ],
    };
  }
}
