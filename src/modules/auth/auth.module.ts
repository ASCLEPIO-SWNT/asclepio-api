import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { ConsentController } from './consent.controller.js';
import { ConsentService } from './consent.service.js';
import { LoginAttemptPolicy } from './login-attempt.policy.js';
import { PasswordModule } from './password/password.module.js';
import { PatientAccountsService } from './patient-accounts.service.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [
    PasswordModule,
    AuditModule,
    UsersModule,
    PatientsModule,
    TenancyModule,
  ],
  controllers: [AuthController, ConsentController],
  providers: [
    TokenService,
    AuthService,
    PatientAccountsService,
    ConsentService,
    LoginAttemptPolicy,
    // Guard global con denegación por defecto (D4).
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  // F-02: encounters usa PatientAccountsService (verificación de identidad e identityVerified de la bandeja).
  exports: [TokenService, PatientAccountsService],
})
export class AuthModule {}
