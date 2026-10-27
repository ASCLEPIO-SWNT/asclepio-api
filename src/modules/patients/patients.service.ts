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
import { isAdult } from '../../common/clock/age.js';
import { Clock } from '../../common/clock/clock.js';
import {
  PrismaService,
  type PrismaTx,
} from '../../common/prisma/prisma.service.js';
import { isUuid } from '../../common/uuid.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type {
  PatientProfileDto,
  UpdatePatientProfileDto,
} from './dto/patient-profile.dto.js';
import type { CreatePatientDto } from './dto/patients.dto.js';

const DUPLICATE = 'Ya existe un paciente con ese documento en esta IPS.';
const NOT_FOUND = 'El recurso no existe.';
const LOCKED =
  'Los datos ya fueron verificados por recepción y no se pueden modificar desde la app.';
const MINOR = 'La cuenta de paciente requiere ser mayor de edad.';
const PROFILE_SELECT = {
  id: true,
  documentType: true,
  documentNumber: true,
  fullName: true,
  birthDate: true,
  sex: true,
  identityVerifiedAt: true,
} as const;
const FUTURE_BIRTH = 'La fecha de nacimiento no puede ser posterior a hoy.';

export type PatientSex = 'M' | 'F' | 'X';

/** Vista de paciente para el personal (PatientDto de design.md, R24). */
export interface PatientView {
  id: string;
  documentType: string | null;
  documentNumber: string | null;
  fullName: string | null;
  /** Fecha civil YYYY-MM-DD. */
  birthDate: string | null;
  estimatedAgeYears: number | null;
  sex: PatientSex | null;
  isNN: boolean;
}

export const PATIENT_VIEW_SELECT = {
  id: true,
  documentType: true,
  documentNumber: true,
  fullName: true,
  birthDate: true,
  estimatedAgeYears: true,
  sex: true,
} as const;

type PatientRow = {
  id: string;
  documentType: string | null;
  documentNumber: string | null;
  fullName: string | null;
  birthDate: Date | null;
  estimatedAgeYears: number | null;
  sex: PatientSex | null;
};

/** Date de una columna date → YYYY-MM-DD. */
export function toCivilDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** YYYY-MM-DD → Date a medianoche UTC (columna date). */
export function fromCivilDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

export function toPatientView(p: PatientRow): PatientView {
  return {
    id: p.id,
    documentType: p.documentType,
    documentNumber: p.documentNumber,
    fullName: p.fullName,
    birthDate: toCivilDate(p.birthDate),
    estimatedAgeYears: p.estimatedAgeYears,
    sex: p.sex,
    // NN = sin documento (el CHECK de la base garantiza tipo y número juntos).
    isNN: p.documentNumber === null,
  };
}

function toProfile(p: {
  id: string;
  documentType: string | null;
  documentNumber: string | null;
  fullName: string | null;
  birthDate: Date | null;
  sex: PatientSex | null;
  identityVerifiedAt: Date | null;
}): PatientProfileDto {
  return {
    id: p.id,
    documentType: p.documentType,
    documentNumber: p.documentNumber,
    fullName: p.fullName,
    birthDate: toCivilDate(p.birthDate),
    sex: p.sex,
    editable: p.identityVerifiedAt === null,
  };
}

/** Dueño de patients. Todo método que lee datos de una IPS recibe tenantId primero. */
@Injectable()
export class PatientsService {
  private readonly logger = new Logger('patients');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** GET /patients (R24, D20): documento exacto dentro del tenant → lista de 0 o 1. */
  async searchByDocument(
    tenantId: string,
    documentType: string,
    documentNumber: string,
  ): Promise<PatientView[]> {
    const p = await this.prisma.patient.findUnique({
      where: {
        tenantId_documentType_documentNumber: {
          tenantId,
          documentType,
          documentNumber,
        },
      },
      select: PATIENT_VIEW_SELECT,
    });
    return p ? [toPatientView(p)] : [];
  }

  /**
   * Alta por recepción (R26–R29). Con documento: identity_verified_at = hora del servidor (lo registra en persona).
   * NN: sin documento ni identity_verified_at. Auditoría PATIENT_CREATED en la misma transacción.
   */
  async createByReception(
    principal: StaffPrincipal,
    dto: CreatePatientDto,
  ): Promise<PatientView> {
    const now = this.clock.now();
    if (dto.birthDate && dto.birthDate > this.clock.todayInBogota()) {
      throw new UnprocessableEntityException(FUTURE_BIRTH);
    }
    const isNN = dto.documentNumber === undefined;
    const tenantId = principal.tenantId;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        if (
          !isNN &&
          (await this.findByDocument(
            tenantId,
            dto.documentType!,
            dto.documentNumber!,
            tx,
          ))
        ) {
          throw new ConflictException(DUPLICATE);
        }
        const p = await tx.patient.create({
          data: {
            tenantId,
            documentType: dto.documentType ?? null,
            documentNumber: dto.documentNumber ?? null,
            fullName: dto.fullName ?? null,
            birthDate: dto.birthDate ? fromCivilDate(dto.birthDate) : null,
            estimatedAgeYears: dto.estimatedAgeYears ?? null,
            sex: dto.sex,
            identityVerifiedAt: isNN ? null : now,
          },
          select: PATIENT_VIEW_SELECT,
        });
        await this.audit.record(
          {
            action: 'PATIENT_CREATED',
            actorType: 'STAFF',
            actorId: principal.id,
            tenantId,
            entity: 'patient',
            entityId: p.id,
            metadata: { isNN },
          },
          tx,
        );
        return p;
      });
      this.logger.log({
        msg: 'patient_created',
        patientId: created.id,
        tenantId,
        userId: principal.id,
        isNN,
      });
      return toPatientView(created);
    } catch (e) {
      // Dos altas simultáneas del mismo documento: decide el único de la base (R28).
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(DUPLICATE);
      }
      throw e;
    }
  }

  /** GET /patient/profile (R1): el paciente del token; editable mientras identity_verified_at sea NULL. */
  async getProfile(
    tenantId: string,
    patientId: string,
  ): Promise<PatientProfileDto> {
    const p = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId },
      select: PROFILE_SELECT,
    });
    if (!p) throw new NotFoundException(NOT_FOUND);
    return toProfile(p);
  }

  /**
   * PATCH /patient/profile (R2–R4, PA-F02-5): solo fullName, birthDate y sex, solo mientras identity_verified_at
   * sea NULL (UPDATE condicional: 0 filas → 409). Auditoría PATIENT_UPDATED con los nombres de los campos.
   */
  async updateProfile(
    principal: PatientPrincipal,
    dto: UpdatePatientProfileDto,
  ): Promise<PatientProfileDto> {
    if (dto.birthDate && !isAdult(dto.birthDate, this.clock.todayInBogota())) {
      throw new UnprocessableEntityException(MINOR);
    }
    const { tenantId, patientId } = principal;
    const data: Prisma.PatientUpdateManyMutationInput = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.birthDate !== undefined)
      data.birthDate = fromCivilDate(dto.birthDate);
    if (dto.sex !== undefined) data.sex = dto.sex;
    const fields = Object.keys(data).sort();
    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.patient.updateMany({
        where: { id: patientId, tenantId, identityVerifiedAt: null },
        data,
      });
      if (count === 0) {
        const exists = await tx.patient.count({
          where: { id: patientId, tenantId },
        });
        throw exists
          ? new ConflictException(LOCKED)
          : new NotFoundException(NOT_FOUND);
      }
      await this.audit.record(
        {
          action: 'PATIENT_UPDATED',
          actorType: 'PATIENT',
          actorId: principal.id,
          tenantId,
          entity: 'patient',
          entityId: patientId,
          metadata: { fields },
        },
        tx,
      );
      return tx.patient.findFirstOrThrow({
        where: { id: patientId, tenantId },
        select: PROFILE_SELECT,
      });
    });
    this.logger.log({
      msg: 'patient_profile_updated',
      patientId,
      tenantId,
      accountId: principal.id,
      fields,
    });
    return toProfile(updated);
  }

  async findByDocument(
    tenantId: string,
    documentType: string,
    documentNumber: string,
    tx?: PrismaTx,
  ): Promise<{ id: string } | null> {
    return (tx ?? this.prisma).patient.findUnique({
      where: {
        tenantId_documentType_documentNumber: {
          tenantId,
          documentType,
          documentNumber,
        },
      },
      select: { id: true },
    });
  }

  /** birthDate es una fecha civil YYYY-MM-DD (columna date). Alta desde la cuenta de paciente (F-01). */
  async create(
    data: {
      tenantId: string;
      documentType: string;
      documentNumber: string;
      fullName: string;
      birthDate: string;
      sex: PatientSex;
    },
    tx?: PrismaTx,
  ): Promise<{ id: string }> {
    return (tx ?? this.prisma).patient.create({
      data: { ...data, birthDate: fromCivilDate(data.birthDate) },
      select: { id: true },
    });
  }

  /** Paciente del tenant o null si no existe, es de otro tenant o el id no es UUID. */
  async findById(
    tenantId: string,
    id: string,
    tx?: PrismaTx,
  ): Promise<PatientView | null> {
    if (!isUuid(id)) return null;
    const p = await (tx ?? this.prisma).patient.findFirst({
      where: { id, tenantId },
      select: PATIENT_VIEW_SELECT,
    });
    return p ? toPatientView(p) : null;
  }

  /** Pacientes del tenant por id (los de otro tenant no aparecen). */
  async findManyByIds(
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, PatientView>> {
    const unique = [...new Set(ids)].filter(isUuid);
    if (!unique.length) return new Map();
    const rows = await this.prisma.patient.findMany({
      where: { tenantId, id: { in: unique } },
      select: PATIENT_VIEW_SELECT,
    });
    return new Map(rows.map((r) => [r.id, toPatientView(r)]));
  }

  /** Fija identity_verified_at = at solo si era NULL (R18, D8). true si cambió. */
  async markIdentityVerified(
    tenantId: string,
    patientId: string,
    at: Date,
    tx: PrismaTx,
  ): Promise<boolean> {
    const { count } = await tx.patient.updateMany({
      where: { id: patientId, tenantId, identityVerifiedAt: null },
      data: { identityVerifiedAt: at },
    });
    return count === 1;
  }
}
