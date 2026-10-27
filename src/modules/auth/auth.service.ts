import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Clock } from '../../common/clock/clock.js';
import {
  PrismaService,
  type PrismaTx,
} from '../../common/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenancyService } from '../tenancy/tenancy.service.js';
import { UsersService } from '../users/users.service.js';
import type { PatientLoginDto, StaffLoginDto } from './dto/auth.dto.js';
import { LoginAttemptPolicy } from './login-attempt.policy.js';
import { PasswordHasher } from './password/password-hasher.js';
import { PatientAccountsService } from './patient-accounts.service.js';
import { type AccessToken, TokenService } from './token.service.js';

/** Respuesta 401 genérica (R4): mismo cuerpo para cualquier causa de fallo de login. */
export const LOGIN_FAILED_DETAIL = 'Credenciales inválidas.';

type FailureReason = 'UNKNOWN_ACCOUNT' | 'BAD_PASSWORD' | 'INACTIVE' | 'LOCKED';

interface LoginSubject {
  id: string;
  tenantId: string;
  passwordHash: string;
  active: boolean;
  lockedUntil: Date | null;
}

interface LoginKind {
  actorType: 'STAFF' | 'PATIENT';
  entity: 'user' | 'patient_account';
  incrementFailedAttempts(id: string, tx: PrismaTx): Promise<number>;
  lock(id: string, until: Date, tx: PrismaTx): Promise<void>;
  resetFailedAttempts(id: string, tx: PrismaTx): Promise<void>;
}

/**
 * Login del personal y del paciente con la misma política (R1–R7, R28–R30, R33, D8, D13).
 * Los logs solo llevan ids, tenant, tipo de principal y motivo: nunca email, documento, contraseña ni token (R35).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger('auth');
  private readonly staffKind: LoginKind;
  private readonly patientKind: LoginKind;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly hasher: PasswordHasher,
    private readonly policy: LoginAttemptPolicy,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly tenancy: TenancyService,
    private readonly patientAccounts: PatientAccountsService,
  ) {
    this.staffKind = {
      actorType: 'STAFF',
      entity: 'user',
      incrementFailedAttempts: (id, tx) =>
        users.incrementFailedAttempts(id, tx),
      lock: (id, until, tx) => users.lock(id, until, tx),
      resetFailedAttempts: (id, tx) => users.resetFailedAttempts(id, tx),
    };
    this.patientKind = {
      actorType: 'PATIENT',
      entity: 'patient_account',
      incrementFailedAttempts: (id, tx) =>
        patientAccounts.incrementFailedAttempts(id, tx),
      lock: (id, until, tx) => patientAccounts.lock(id, until, tx),
      resetFailedAttempts: (id, tx) =>
        patientAccounts.resetFailedAttempts(id, tx),
    };
  }

  async loginStaff(dto: StaffLoginDto): Promise<AccessToken> {
    const found = await this.users.findForLogin(dto.email);
    const user = await this.authenticate(
      this.staffKind,
      found?.user ?? null,
      found?.tenantActive ?? false,
      dto.password,
    );
    return this.tokens.issueStaff({
      id: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });
  }

  async loginPatient(dto: PatientLoginDto): Promise<AccessToken> {
    const account = await this.patientAccounts.findForLogin(
      dto.tenantId,
      dto.documentType,
      dto.documentNumber,
    );
    const tenantActive = account
      ? await this.tenancy.isActive(account.tenantId)
      : false;
    const ok = await this.authenticate(
      this.patientKind,
      account,
      tenantActive,
      dto.password,
    );
    return this.tokens.issuePatient({
      id: ok.id,
      tenantId: ok.tenantId,
      patientId: ok.patientId,
    });
  }

  private async authenticate<T extends LoginSubject>(
    kind: LoginKind,
    subject: T | null,
    tenantActive: boolean,
    password: string,
  ): Promise<T> {
    if (!subject) {
      await this.hasher.verifyDummy(password);
      return this.fail(kind, null, 'UNKNOWN_ACCOUNT');
    }
    if (this.policy.isLocked(subject.lockedUntil, this.clock.now())) {
      // R6: rechazo aunque la contraseña sea correcta, sin tocar el contador.
      await this.hasher.verifyDummy(password);
      return this.fail(kind, subject, 'LOCKED');
    }
    if (!subject.active || !tenantActive) {
      await this.hasher.verifyDummy(password);
      return this.fail(kind, subject, 'INACTIVE');
    }
    if (!(await this.hasher.verify(password, subject.passwordHash))) {
      // R5, R29, R30: incremento atómico, bloqueo y auditoría en la misma transacción.
      await this.prisma.$transaction(async (tx) => {
        const attempts = await kind.incrementFailedAttempts(subject.id, tx);
        const lockedUntil = this.policy.lockAfterFailure(
          attempts,
          this.clock.now(),
        );
        if (lockedUntil) {
          await kind.lock(subject.id, lockedUntil, tx);
          await this.audit.record(
            {
              action: 'AUTH_ACCOUNT_LOCKED',
              entity: kind.entity,
              entityId: subject.id,
              tenantId: subject.tenantId,
              metadata: { lockedUntil: lockedUntil.toISOString() },
            },
            tx,
          );
        }
        await this.recordFailure(kind, subject, 'BAD_PASSWORD', tx);
      });
      return this.reject(kind, subject, 'BAD_PASSWORD');
    }
    // R7, R28, R33: reinicio y auditoría en una transacción; si la auditoría falla no hay token (500).
    await this.prisma.$transaction(async (tx) => {
      await kind.resetFailedAttempts(subject.id, tx);
      await this.audit.record(
        {
          action: 'AUTH_LOGIN_SUCCEEDED',
          actorType: kind.actorType,
          actorId: subject.id,
          tenantId: subject.tenantId,
          entity: kind.entity,
          entityId: subject.id,
        },
        tx,
      );
    });
    this.logger.log({
      msg: 'login_succeeded',
      principal: kind.actorType,
      accountId: subject.id,
      tenantId: subject.tenantId,
    });
    return subject;
  }

  private async fail(
    kind: LoginKind,
    subject: LoginSubject | null,
    reason: FailureReason,
  ): Promise<never> {
    await this.recordFailure(kind, subject, reason);
    return this.reject(kind, subject, reason);
  }

  private recordFailure(
    kind: LoginKind,
    subject: LoginSubject | null,
    reason: FailureReason,
    tx?: PrismaTx,
  ): Promise<void> {
    return this.audit.record(
      {
        action: 'AUTH_LOGIN_FAILED',
        actorId: null,
        entity: kind.entity,
        entityId: subject?.id ?? null,
        tenantId: subject?.tenantId ?? null,
        metadata: { reason },
      },
      tx,
    );
  }

  private reject(
    kind: LoginKind,
    subject: LoginSubject | null,
    reason: FailureReason,
  ): never {
    this.logger.warn({
      msg: 'login_failed',
      principal: kind.actorType,
      reason,
      accountId: subject?.id ?? null,
      tenantId: subject?.tenantId ?? null,
    });
    throw new UnauthorizedException(LOGIN_FAILED_DETAIL);
  }
}
