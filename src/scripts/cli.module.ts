import { Module } from '@nestjs/common';
import { ClockModule } from '../common/clock/clock.module.js';
import { PrismaModule } from '../common/prisma/prisma.module.js';
import { AuditModule } from '../modules/audit/audit.module.js';
import { PasswordModule } from '../modules/auth/password/password.module.js';
import { TenancyModule } from '../modules/tenancy/tenancy.module.js';
import { UsersModule } from '../modules/users/users.module.js';

/** Contexto mínimo de los scripts CLI (D20, D21): sin HTTP, sin JWT ni guard. Conecta con DATABASE_URL. */
@Module({
  imports: [
    ClockModule,
    PrismaModule,
    AuditModule,
    TenancyModule,
    UsersModule,
    PasswordModule,
  ],
})
export class CliModule {}
