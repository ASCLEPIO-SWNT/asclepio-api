import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { StaffPrincipal } from '../../common/auth/principal.js';
import { Clock } from '../../common/clock/clock.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { UsersService } from '../users/users.service.js';
import type {
  ClinicalCaptureDto,
  CreateSymptomFindingsDto,
  CreateVitalSignsDto,
  SymptomFindingDto,
  SymptomFindingListDto,
  VitalSignsDto,
} from './dto/clinical-capture.dto.js';
import { EncounterEventsService } from './encounter-events.service.js';
import { EncountersService, NOT_FOUND } from './encounters.service.js';
import type { SymptomFindingKind } from './symptom-findings.rules.js';
import {
  type ConsciousnessLevel,
  validateVitalSigns,
} from './vital-signs.rules.js';

const INVALID_VITALS = 'La toma de signos vitales no superó la validación.';

const VITAL_SELECT = {
  id: true,
  encounterId: true,
  respiratoryRate: true,
  oxygenSaturation: true,
  supplementalOxygen: true,
  systolicBp: true,
  heartRate: true,
  consciousness: true,
  temperatureC: true,
  diastolicBp: true,
  glucoseMgDl: true,
  recordedAt: true,
  recordedBy: true,
} as const;

const FINDING_SELECT = {
  id: true,
  encounterId: true,
  kind: true,
  description: true,
  recordedAt: true,
  recordedBy: true,
} as const;

interface VitalRow {
  id: string;
  encounterId: string;
  respiratoryRate: number | null;
  oxygenSaturation: number | null;
  supplementalOxygen: boolean | null;
  systolicBp: number | null;
  heartRate: number | null;
  consciousness: ConsciousnessLevel | null;
  temperatureC: { toNumber(): number } | null;
  diastolicBp: number | null;
  glucoseMgDl: number | null;
  recordedAt: Date;
  recordedBy: string;
}

interface FindingRow {
  id: string;
  encounterId: string;
  kind: SymptomFindingKind;
  description: string;
  recordedAt: Date;
  recordedBy: string;
}

/**
 * Captura clínica de enfermería (F-03-api): tomas de signos vitales y síntomas/hallazgos, solo inserciones (R2, R9).
 * Único usuario de vital_signs y symptom_findings. Cada captura bloquea la atención en WAITING_TRIAGE (D5) e inserta
 * su encounter_event y su auditoría en la misma transacción (R14–R16). Horas del Clock y responsable del token (D10).
 * Se exporta para F-04 (ai lee la captura). No ofrece ninguna vía que modifique el motivo de consulta (R10).
 * Nunca registra en logs, eventos ni auditoría valores clínicos ni textos (R18).
 */
@Injectable()
export class ClinicalCaptureService {
  private readonly logger = new Logger('encounters');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EncounterEventsService,
    private readonly encounters: EncountersService,
    private readonly users: UsersService,
  ) {}

  /** POST /encounters/{id}/vital-signs (R1–R6, R11–R14, R16). */
  async recordVitalSigns(
    principal: StaffPrincipal,
    encounterId: string,
    dto: CreateVitalSignsDto,
  ): Promise<VitalSignsDto> {
    // D4: las reglas puras (422) van antes de tocar la base; un 422 no revela nada de otro tenant.
    const errors = validateVitalSigns(dto);
    if (errors.length) {
      throw new UnprocessableEntityException({
        detail: INVALID_VITALS,
        errors,
      });
    }
    const tenantId = principal.tenantId;
    const now = this.clock.now();
    const row = await this.prisma.$transaction(async (tx) => {
      await this.encounters.lockForCapture(tenantId, encounterId, now, tx);
      const created = await tx.vitalSign.create({
        data: {
          tenantId,
          encounterId,
          respiratoryRate: dto.respiratoryRate ?? null,
          oxygenSaturation: dto.oxygenSaturation ?? null,
          supplementalOxygen: dto.supplementalOxygen ?? null,
          systolicBp: dto.systolicBp ?? null,
          heartRate: dto.heartRate ?? null,
          consciousness: dto.consciousness ?? null,
          temperatureC: dto.temperatureC ?? null,
          diastolicBp: dto.diastolicBp ?? null,
          glucoseMgDl: dto.glucoseMgDl ?? null,
          recordedAt: now,
          recordedBy: principal.id,
        },
        select: VITAL_SELECT,
      });
      await this.events.append(
        {
          tenantId,
          encounterId,
          type: 'VITAL_SIGNS_RECORDED',
          payload: { vitalSignsId: created.id },
          actor: { type: 'STAFF', id: principal.id },
          occurredAt: now,
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'VITAL_SIGNS_RECORDED',
          actorType: 'STAFF',
          actorId: principal.id,
          tenantId,
          entity: 'vital_signs',
          entityId: created.id,
          metadata: { encounterId },
        },
        tx,
      );
      return created;
    });
    this.logger.log({
      msg: 'vital_signs_recorded',
      encounterId,
      vitalSignsId: row.id,
      tenantId,
      userId: principal.id,
    });
    const names = await this.users.findNames(tenantId, [row.recordedBy]);
    return toVitalDto(row, names);
  }

  /** POST /encounters/{id}/symptom-findings (R7–R12, R15, R16): una fila por elemento, en el orden recibido. */
  async recordSymptomFindings(
    principal: StaffPrincipal,
    encounterId: string,
    dto: CreateSymptomFindingsDto,
  ): Promise<SymptomFindingListDto> {
    const tenantId = principal.tenantId;
    const now = this.clock.now();
    const rows = await this.prisma.$transaction(async (tx) => {
      await this.encounters.lockForCapture(tenantId, encounterId, now, tx);
      // Inserciones una a una (no createMany) para conservar el orden recibido y devolver los ids.
      const created: FindingRow[] = [];
      for (const item of dto.items) {
        created.push(
          await tx.symptomFinding.create({
            data: {
              tenantId,
              encounterId,
              kind: item.kind,
              description: item.description.trim(),
              recordedAt: now,
              recordedBy: principal.id,
            },
            select: FINDING_SELECT,
          }),
        );
      }
      const findingIds = created.map((f) => f.id);
      await this.events.append(
        {
          tenantId,
          encounterId,
          type: 'SYMPTOM_FINDINGS_RECORDED',
          payload: { findingIds, count: findingIds.length },
          actor: { type: 'STAFF', id: principal.id },
          occurredAt: now,
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'SYMPTOM_FINDINGS_RECORDED',
          actorType: 'STAFF',
          actorId: principal.id,
          tenantId,
          entity: 'encounter',
          entityId: encounterId,
          metadata: { count: findingIds.length },
        },
        tx,
      );
      return created;
    });
    this.logger.log({
      msg: 'symptom_findings_recorded',
      encounterId,
      count: rows.length,
      tenantId,
      userId: principal.id,
    });
    const names = await this.users.findNames(tenantId, [principal.id]);
    return { items: rows.map((r) => toFindingDto(r, names)) };
  }

  /**
   * GET /encounters/{id}/clinical-capture (R20): motivo original, estado y todas las tomas y hallazgos ordenados por
   * recorded_at e id, en cualquier estado de la atención. 404 igual para inexistente, otro tenant o mal formado (R12).
   */
  async getCapture(
    tenantId: string,
    encounterId: string,
  ): Promise<ClinicalCaptureDto> {
    const header = await this.encounters.findCaptureHeader(
      tenantId,
      encounterId,
    );
    if (!header) throw new NotFoundException(NOT_FOUND);
    const where = { tenantId, encounterId };
    const orderBy = [{ recordedAt: 'asc' as const }, { id: 'asc' as const }];
    const [vitals, findings] = await Promise.all([
      this.prisma.vitalSign.findMany({ where, orderBy, select: VITAL_SELECT }),
      this.prisma.symptomFinding.findMany({
        where,
        orderBy,
        select: FINDING_SELECT,
      }),
    ]);
    const names = await this.users.findNames(tenantId, [
      ...vitals.map((v) => v.recordedBy),
      ...findings.map((f) => f.recordedBy),
    ]);
    this.logger.log({
      msg: 'clinical_capture_read',
      encounterId,
      tenantId,
    });
    return {
      encounterId,
      status: header.status,
      chiefComplaintText: header.chiefComplaintText,
      complaintSource: header.complaintSource,
      vitalSigns: vitals.map((v) => toVitalDto(v, names)),
      symptomFindings: findings.map((f) => toFindingDto(f, names)),
    };
  }
}

function staffRef(id: string, names: Map<string, string>) {
  return { id, fullName: names.get(id) ?? null };
}

/**
 * Los obligatorios siempre llegan por la API (R4), así que la respuesta los declara no nulos; el tipo de la base es
 * nullable (D2) y se conserva un null si una fila no los tuviera.
 */
function toVitalDto(r: VitalRow, names: Map<string, string>): VitalSignsDto {
  return {
    id: r.id,
    encounterId: r.encounterId,
    respiratoryRate: r.respiratoryRate as number,
    oxygenSaturation: r.oxygenSaturation as number,
    supplementalOxygen: r.supplementalOxygen as boolean,
    systolicBp: r.systolicBp as number,
    heartRate: r.heartRate as number,
    consciousness: r.consciousness as ConsciousnessLevel,
    temperatureC: (r.temperatureC?.toNumber() ?? null) as number,
    diastolicBp: r.diastolicBp,
    glucoseMgDl: r.glucoseMgDl,
    recordedAt: r.recordedAt.toISOString(),
    recordedBy: staffRef(r.recordedBy, names),
  };
}

function toFindingDto(
  r: FindingRow,
  names: Map<string, string>,
): SymptomFindingDto {
  return {
    id: r.id,
    encounterId: r.encounterId,
    kind: r.kind,
    description: r.description,
    recordedAt: r.recordedAt.toISOString(),
    recordedBy: staffRef(r.recordedBy, names),
  };
}
