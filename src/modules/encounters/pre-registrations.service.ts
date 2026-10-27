import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  PatientPrincipal,
  StaffPrincipal,
} from '../../common/auth/principal.js';
import { Clock } from '../../common/clock/clock.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { isUuid } from '../../common/uuid.js';
import { AuditService } from '../audit/audit.service.js';
import { PatientAccountsService } from '../auth/patient-accounts.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { TenancyService } from '../tenancy/tenancy.service.js';
import type {
  ConfirmPreRegistrationDto,
  CreatePreRegistrationDto,
  EncounterDto,
  PatientPreRegistrationDto,
  PendingPreRegistrationDto,
  RejectedPreRegistrationDto,
} from './dto/encounters.dto.js';
import {
  EncountersService,
  isUniqueViolation,
  NOT_FOUND,
} from './encounters.service.js';
import type { EncounterStatus } from './encounter-state-machine.js';
import {
  effectivePreRegistrationStatus,
  expiresAtFor,
  isVigente,
} from './pre-registration.policy.js';

const BAD_SITE = 'La sede indicada no está disponible.';
const ALREADY_PENDING = 'Ya tienes un pre-registro pendiente.';
const ACTIVE = 'Tienes una atención en curso.';
const NOT_PENDING = 'El pre-registro ya no está pendiente.';
const ACTIVE_ON_CONFIRM = 'El paciente ya tiene una atención activa.';
const IDENTITY_REQUIRED =
  'Para confirmar la llegada hay que verificar la identidad del paciente (identityVerified: true).';
export const PATIENT_LIST_LIMIT = 20;

const PATIENT_VIEW_SELECT = {
  id: true,
  siteId: true,
  status: true,
  preRegisteredAt: true,
  expiresAt: true,
  encounter: { select: { id: true, status: true } },
} as const;

/** Dueño de pre_registrations (D1, módulo encounters). */
@Injectable()
export class PreRegistrationsService {
  private readonly logger = new Logger('encounters');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly encounters: EncountersService,
    private readonly patients: PatientsService,
    private readonly patientAccounts: PatientAccountsService,
    private readonly tenancy: TenancyService,
  ) {}

  /**
   * POST /patient/pre-registrations (R5–R11). Tenant y paciente solo del token. En la misma transacción: materializa
   * los vencidos del paciente (R11, actor SYSTEM, resolved_at = expires_at), aplica R8 y R9 y crea el PENDING.
   */
  async create(
    principal: PatientPrincipal,
    dto: CreatePreRegistrationDto,
  ): Promise<PatientPreRegistrationDto> {
    const { tenantId, patientId } = principal;
    const site = await this.tenancy.findSiteInTenant(tenantId, dto.siteId);
    if (!site) throw new UnprocessableEntityException(BAD_SITE);
    const now = this.clock.now();
    let created: { id: string; expired: number };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const stale = await tx.preRegistration.findMany({
          where: {
            tenantId,
            patientId,
            status: 'PENDING',
            expiresAt: { lte: now },
          },
          select: { id: true, expiresAt: true },
        });
        for (const s of stale) {
          const { count } = await tx.preRegistration.updateMany({
            where: { id: s.id, status: 'PENDING' },
            data: { status: 'EXPIRED', resolvedAt: s.expiresAt },
          });
          if (count === 1) {
            await this.audit.record(
              {
                action: 'PRE_REGISTRATION_EXPIRED',
                actorType: 'SYSTEM',
                actorId: null,
                tenantId,
                entity: 'pre_registration',
                entityId: s.id,
              },
              tx,
            );
          }
        }
        const pending = await tx.preRegistration.count({
          where: { tenantId, patientId, status: 'PENDING' },
        });
        if (pending) throw new ConflictException(ALREADY_PENDING);
        if (await this.encounters.hasActiveEncounter(tenantId, patientId, tx)) {
          throw new ConflictException(ACTIVE);
        }
        const pre = await tx.preRegistration.create({
          data: {
            tenantId,
            patientId,
            siteId: site.id,
            chiefComplaintText: dto.chiefComplaintText,
            complaintSource: dto.complaintSource,
            status: 'PENDING',
            preRegisteredAt: now,
            expiresAt: expiresAtFor(now),
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            action: 'PRE_REGISTRATION_CREATED',
            actorType: 'PATIENT',
            actorId: principal.id,
            tenantId,
            entity: 'pre_registration',
            entityId: pre.id,
            metadata: { siteId: site.id, complaintSource: dto.complaintSource },
          },
          tx,
        );
        return { id: pre.id, expired: stale.length };
      });
    } catch (e) {
      // Dos envíos simultáneos: decide el índice único parcial "un PENDING por paciente" (R8, D7).
      if (isUniqueViolation(e)) throw new ConflictException(ALREADY_PENDING);
      throw e;
    }
    this.logger.log({
      msg: 'pre_registration_created',
      preRegistrationId: created.id,
      expiredMaterialized: created.expired,
      tenantId,
      accountId: principal.id,
    });
    return this.getForPatient(principal, created.id);
  }

  /** GET /patient/pre-registrations (R12): los 20 más recientes del paciente del token. */
  async listForPatient(
    principal: PatientPrincipal,
  ): Promise<PatientPreRegistrationDto[]> {
    const rows = await this.prisma.preRegistration.findMany({
      where: { tenantId: principal.tenantId, patientId: principal.patientId },
      orderBy: [{ preRegisteredAt: 'desc' }, { id: 'desc' }],
      take: PATIENT_LIST_LIMIT,
      select: PATIENT_VIEW_SELECT,
    });
    return this.toPatientViews(principal.tenantId, rows);
  }

  /** GET /patient/pre-registrations/{id} (R13): 404 igual si no existe o es de otro paciente u otro tenant. */
  async getForPatient(
    principal: PatientPrincipal,
    id: string,
  ): Promise<PatientPreRegistrationDto> {
    const row = isUuid(id)
      ? await this.prisma.preRegistration.findFirst({
          where: {
            id,
            tenantId: principal.tenantId,
            patientId: principal.patientId,
          },
          select: PATIENT_VIEW_SELECT,
        })
      : null;
    if (!row) throw new NotFoundException(NOT_FOUND);
    const [view] = await this.toPatientViews(principal.tenantId, [row]);
    return view;
  }

  /** GET /pre-registrations (R15, R16): vigentes del tenant (y de la sede), por pre_registered_at ascendente. */
  async listPending(
    tenantId: string,
    siteId?: string,
  ): Promise<PendingPreRegistrationDto[]> {
    const now = this.clock.now();
    const rows = await this.prisma.preRegistration.findMany({
      where: {
        tenantId,
        status: 'PENDING',
        expiresAt: { gt: now },
        ...(siteId ? { siteId } : {}),
      },
      orderBy: [{ preRegisteredAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        siteId: true,
        patientId: true,
        preRegisteredAt: true,
        expiresAt: true,
        chiefComplaintText: true,
        complaintSource: true,
      },
    });
    const patientIds = rows.map((r) => r.patientId);
    const [sites, patients, flags] = await Promise.all([
      this.tenancy.findSiteNames(
        tenantId,
        rows.map((r) => r.siteId),
      ),
      this.patients.findManyByIds(tenantId, patientIds),
      this.patientAccounts.findIdentityFlags(tenantId, patientIds),
    ]);
    this.logger.log({
      msg: 'pre_registrations_listed',
      count: rows.length,
      tenantId,
    });
    return rows.map((r) => ({
      id: r.id,
      siteId: r.siteId,
      siteName: sites.get(r.siteId) ?? '',
      preRegisteredAt: r.preRegisteredAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      chiefComplaintText: r.chiefComplaintText,
      complaintSource: r.complaintSource,
      identityVerified: flags.get(r.patientId) ?? false,
      patient: patients.get(r.patientId)!,
    }));
  }

  /**
   * POST /pre-registrations/{id}/confirm (R17–R22, D4). En una transacción: UPDATE condicional del pre-registro
   * (PENDING y vigente; 0 filas → 409), atención en WAITING_TRIAGE con arrival_at = hora del servidor, eventos,
   * auditorías y, si hacía falta, verificación de la identidad de la cuenta y del paciente.
   */
  async confirm(
    principal: StaffPrincipal,
    id: string,
    dto: ConfirmPreRegistrationDto,
  ): Promise<EncounterDto> {
    if (dto.identityVerified !== true) {
      throw new UnprocessableEntityException(IDENTITY_REQUIRED);
    }
    const tenantId = principal.tenantId;
    const now = this.clock.now();
    let result: { encounterId: string; identityVerified: boolean };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const pre = isUuid(id)
          ? await tx.preRegistration.findFirst({
              where: { id, tenantId },
              select: {
                id: true,
                patientId: true,
                siteId: true,
                status: true,
                expiresAt: true,
                chiefComplaintText: true,
                complaintSource: true,
              },
            })
          : null;
        if (!pre) throw new NotFoundException(NOT_FOUND);
        if (!isVigente(pre.status, pre.expiresAt, now)) {
          throw new ConflictException(NOT_PENDING);
        }
        // Reclama el pre-registro: ante dos confirmaciones simultáneas, la segunda espera el bloqueo y afecta 0 filas.
        const { count } = await tx.preRegistration.updateMany({
          where: { id, tenantId, status: 'PENDING', expiresAt: { gt: now } },
          data: {
            status: 'CONFIRMED',
            resolvedAt: now,
            resolvedBy: principal.id,
          },
        });
        if (count === 0) throw new ConflictException(NOT_PENDING);
        if (
          await this.encounters.hasActiveEncounter(tenantId, pre.patientId, tx)
        ) {
          throw new ConflictException(ACTIVE_ON_CONFIRM);
        }
        const encounterId = await this.encounters.createInTx(
          {
            tenantId,
            siteId: pre.siteId,
            patientId: pre.patientId,
            chiefComplaintText: pre.chiefComplaintText,
            complaintSource: pre.complaintSource,
            origin: 'PRE_REGISTRATION',
            registeredBy: principal.id,
            now,
            preRegistrationId: pre.id,
          },
          tx,
        );
        await tx.preRegistration.update({
          where: { id: pre.id },
          data: { encounterId },
        });
        await this.audit.record(
          {
            action: 'PRE_REGISTRATION_CONFIRMED',
            actorType: 'STAFF',
            actorId: principal.id,
            tenantId,
            entity: 'pre_registration',
            entityId: pre.id,
            metadata: { encounterId },
          },
          tx,
        );
        // R18: verificación de identidad en el primer pre-registro confirmado (D8).
        const account = await this.patientAccounts.markIdentityVerified(
          tenantId,
          pre.patientId,
          tx,
        );
        if (account?.changed) {
          await this.patients.markIdentityVerified(
            tenantId,
            pre.patientId,
            now,
            tx,
          );
          await this.audit.record(
            {
              action: 'PATIENT_IDENTITY_VERIFIED',
              actorType: 'STAFF',
              actorId: principal.id,
              tenantId,
              entity: 'patient_account',
              entityId: account.accountId,
              metadata: { patientId: pre.patientId },
            },
            tx,
          );
        }
        return { encounterId, identityVerified: account?.changed ?? false };
      });
    } catch (e) {
      // Respaldo de la base: encounter_id único y una atención activa por paciente (D4, D7).
      if (isUniqueViolation(e)) throw new ConflictException(NOT_PENDING);
      throw e;
    }
    this.logger.log({
      msg: 'pre_registration_confirmed',
      preRegistrationId: id,
      encounterId: result.encounterId,
      identityVerifiedNow: result.identityVerified,
      tenantId,
      userId: principal.id,
    });
    return this.encounters.findOne(tenantId, result.encounterId);
  }

  /** POST /pre-registrations/{id}/reject (R23, PA-F02-7): motivo solo en rejection_reason, nunca en la auditoría. */
  async reject(
    principal: StaffPrincipal,
    id: string,
    reason: string,
  ): Promise<RejectedPreRegistrationDto> {
    const tenantId = principal.tenantId;
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      const exists = isUuid(id)
        ? await tx.preRegistration.count({ where: { id, tenantId } })
        : 0;
      if (!exists) throw new NotFoundException(NOT_FOUND);
      const { count } = await tx.preRegistration.updateMany({
        where: { id, tenantId, status: 'PENDING', expiresAt: { gt: now } },
        data: {
          status: 'REJECTED',
          resolvedAt: now,
          resolvedBy: principal.id,
          rejectionReason: reason.trim(),
        },
      });
      if (count === 0) throw new ConflictException(NOT_PENDING);
      await this.audit.record(
        {
          action: 'PRE_REGISTRATION_REJECTED',
          actorType: 'STAFF',
          actorId: principal.id,
          tenantId,
          entity: 'pre_registration',
          entityId: id,
          metadata: { reasonProvided: true },
        },
        tx,
      );
    });
    this.logger.log({
      msg: 'pre_registration_rejected',
      preRegistrationId: id,
      tenantId,
      userId: principal.id,
    });
    return { id, status: 'REJECTED', resolvedAt: now.toISOString() };
  }

  private async toPatientViews(
    tenantId: string,
    rows: {
      id: string;
      siteId: string;
      status: 'PENDING' | 'CONFIRMED' | 'EXPIRED' | 'REJECTED';
      preRegisteredAt: Date;
      expiresAt: Date;
      encounter: { id: string; status: EncounterStatus } | null;
    }[],
  ): Promise<PatientPreRegistrationDto[]> {
    const now = this.clock.now();
    const sites = await this.tenancy.findSiteNames(
      tenantId,
      rows.map((r) => r.siteId),
    );
    return rows.map((r) => ({
      id: r.id,
      siteId: r.siteId,
      siteName: sites.get(r.siteId) ?? '',
      status: effectivePreRegistrationStatus(r.status, r.expiresAt, now),
      preRegisteredAt: r.preRegisteredAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      encounter: r.encounter
        ? { id: r.encounter.id, status: r.encounter.status }
        : null,
    }));
  }
}
