import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Clock } from '../../common/clock/clock.js';
import {
  PrismaService,
  type PrismaTx,
} from '../../common/prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { TenancyService } from '../tenancy/tenancy.service.js';
import { isAdult } from '../../common/clock/age.js';
import { ConsentService } from './consent.service.js';
import type {
  CreatePatientAccountDto,
  PatientAccountCreatedDto,
} from './dto/auth.dto.js';
import { PasswordHasher } from './password/password-hasher.js';

export interface PatientAccountForLogin {
  id: string;
  tenantId: string;
  patientId: string;
  passwordHash: string;
  active: boolean;
  lockedUntil: Date | null;
}

export interface PatientAccountView {
  id: string;
  tenantId: string;
  patientId: string;
  consentVersion: string;
  identityVerified: boolean;
  active: boolean;
}

const DUPLICATE =
  'Ya existe una cuenta de paciente para ese documento en esta IPS.';

/** Dueño de patient_accounts (auth, ver design.md). Alta con consentimiento y mayoría de edad (R20–R26, R44–R47). */
@Injectable()
export class PatientAccountsService {
  private readonly logger = new Logger('auth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly hasher: PasswordHasher,
    private readonly consent: ConsentService,
    private readonly audit: AuditService,
    private readonly patients: PatientsService,
    private readonly tenancy: TenancyService,
  ) {}

  async create(
    dto: CreatePatientAccountDto,
  ): Promise<PatientAccountCreatedDto> {
    // Reglas de negocio → 422 (D11). Los mensajes no repiten valores enviados por el cliente (R36).
    if (dto.consentAccepted !== true) {
      throw new UnprocessableEntityException(
        'Es obligatorio aceptar el consentimiento de tratamiento de datos.',
      );
    }
    if (!this.consent.isCurrent(dto.consentVersion)) {
      throw new UnprocessableEntityException(
        'La versión del consentimiento aceptada no es la vigente.',
      );
    }
    if (!isAdult(dto.birthDate, this.clock.todayInBogota())) {
      throw new UnprocessableEntityException(
        'La cuenta de paciente requiere ser mayor de edad.',
      );
    }
    if (!(await this.tenancy.isActive(dto.tenantId))) {
      throw new UnprocessableEntityException(
        'La IPS indicada no está disponible.',
      );
    }
    const passwordHash = await this.hasher.hash(dto.password);
    const consentVersion = dto.consentVersion as string;

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const existing = await this.patients.findByDocument(
          dto.tenantId,
          dto.documentType,
          dto.documentNumber,
          tx,
        );
        if (
          existing &&
          (await tx.patientAccount.count({ where: { patientId: existing.id } }))
        ) {
          throw new ConflictException(DUPLICATE);
        }
        // R44 / D19: si el paciente ya existe se vincula sin modificar sus datos.
        const patient =
          existing ??
          (await this.patients.create(
            {
              tenantId: dto.tenantId,
              documentType: dto.documentType,
              documentNumber: dto.documentNumber,
              fullName: dto.fullName,
              birthDate: dto.birthDate,
              sex: dto.sex,
            },
            tx,
          ));
        const account = await tx.patientAccount.create({
          data: {
            tenantId: dto.tenantId,
            patientId: patient.id,
            passwordHash,
            consentAt: this.clock.now(),
            consentVersion,
            identityVerified: false, // R45: solo recepción la verifica (F-02).
          },
          select: { id: true, patientId: true },
        });
        await this.audit.record(
          {
            action: 'PATIENT_ACCOUNT_CREATED',
            actorType: 'PATIENT',
            actorId: account.id,
            tenantId: dto.tenantId,
            entity: 'patient_account',
            entityId: account.id,
            metadata: { consentVersion, linkedExistingPatient: !!existing },
          },
          tx,
        );
        return account;
      });
      this.logger.log({
        msg: 'patient_account_created',
        accountId: created.id,
        tenantId: dto.tenantId,
      });
      return { id: created.id, patientId: created.patientId };
    } catch (e) {
      // Carrera entre dos altas simultáneas del mismo documento: el único de la base decide (R25).
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(DUPLICATE);
      }
      throw e;
    }
  }

  async findForLogin(
    tenantId: string,
    documentType: string,
    documentNumber: string,
  ): Promise<PatientAccountForLogin | null> {
    const patient = await this.patients.findByDocument(
      tenantId,
      documentType,
      documentNumber,
    );
    if (!patient) return null;
    return this.prisma.patientAccount.findUnique({
      where: { patientId: patient.id },
      select: {
        id: true,
        tenantId: true,
        patientId: true,
        passwordHash: true,
        active: true,
        lockedUntil: true,
      },
    });
  }

  async findById(id: string): Promise<PatientAccountView | null> {
    return this.prisma.patientAccount.findUnique({
      where: { id },
      select: {
        id: true,
        tenantId: true,
        patientId: true,
        consentVersion: true,
        identityVerified: true,
        active: true,
      },
    });
  }

  /**
   * F-02 (R18, D8): pone identity_verified = true en la cuenta del paciente, solo si estaba en false.
   * Devuelve null si el paciente no tiene cuenta en ese tenant; changed = false si ya estaba verificada.
   */
  async markIdentityVerified(
    tenantId: string,
    patientId: string,
    tx: PrismaTx,
  ): Promise<{ accountId: string; changed: boolean } | null> {
    const account = await tx.patientAccount.findFirst({
      where: { tenantId, patientId },
      select: { id: true },
    });
    if (!account) return null;
    const { count } = await tx.patientAccount.updateMany({
      where: { id: account.id, identityVerified: false },
      data: { identityVerified: true },
    });
    return { accountId: account.id, changed: count === 1 };
  }

  /** identity_verified de la cuenta de cada paciente del tenant (los que no tienen cuenta no aparecen). */
  async findIdentityFlags(
    tenantId: string,
    patientIds: string[],
  ): Promise<Map<string, boolean>> {
    const unique = [...new Set(patientIds)];
    if (!unique.length) return new Map();
    const rows = await this.prisma.patientAccount.findMany({
      where: { tenantId, patientId: { in: unique } },
      select: { patientId: true, identityVerified: true },
    });
    return new Map(rows.map((r) => [r.patientId, r.identityVerified]));
  }

  async incrementFailedAttempts(id: string, tx: PrismaTx): Promise<number> {
    const { failedAttempts } = await tx.patientAccount.update({
      where: { id },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });
    return failedAttempts;
  }

  async lock(id: string, lockedUntil: Date, tx: PrismaTx): Promise<void> {
    await tx.patientAccount.update({
      where: { id },
      data: { lockedUntil, failedAttempts: 0 },
    });
  }

  async resetFailedAttempts(id: string, tx: PrismaTx): Promise<void> {
    await tx.patientAccount.update({
      where: { id },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  }
}
