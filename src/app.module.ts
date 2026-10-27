import { Module } from '@nestjs/common';
import { ClockModule } from './common/clock/clock.module.js';
import { ConfigModule } from './common/config/config.module.js';
import { HealthController } from './common/health/health.controller.js';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { ThrottleModule } from './common/throttle/throttle.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { PatientsModule } from './modules/patients/patients.module.js';
import { TenancyHttpModule } from './modules/tenancy/tenancy.module.js';
import { UsersModule } from './modules/users/users.module.js';

// Los módulos de dominio (src/modules/*) se registran aquí según llegan sus features.
@Module({
  imports: [
    ConfigModule,
    ClockModule,
    PrismaModule,
    ThrottleModule,
    AuditModule,
    TenancyHttpModule,
    UsersModule,
    PatientsModule,
    AuthModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
