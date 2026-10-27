import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { StaffPrincipal } from '../../common/auth/principal.js';
import { Clock } from '../../common/clock/clock.js';
import {
  PrismaService,
  type PrismaTx,
} from '../../common/prisma/prisma.service.js';
import { isUuid } from '../../common/uuid.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { TenancyService } from '../tenancy/tenancy.service.js';
import { UsersService } from '../users/users.service.js';
import type {
  ComplaintSource,
  CreateEncounterDto,
  EncounterDto,
  EncounterOrigin,
  EncounterSummaryDto,
  ListEncountersQueryDto,
} from './dto/encounters.dto.js';
import { LIST_LIMIT_DEFAULT } from './dto/encounters.dto.js';
import {
  type Actor,
  EncounterEventsService,
} from './encounter-events.service.js';
import {
  canGenericTransition,
  type EncounterStatus,
} from './encounter-state-machine.js';

export const NOT_FOUND = 'El recurso no existe.';
export const ACTIVE_ENCOUNTER =
  'El paciente ya tiene una atención activa o un pre-registro pendiente.';
const INVALID_TRANSITION =
  'La atención no admite ese cambio de estado desde su estado actual.';
const TRIAGED_FORBIDDEN =
  'El paso a TRIAGED exige una decisión de triage y no se hace con la transición genérica.';
const BAD_REFERENCE = 'El paciente o la sede indicados no están disponibles.';

const ACTIVE_STATUSES = { notIn: ['CLOSED', 'CANCELLED'] as EncounterStatus[] };

export interface NewEncounter {
  tenantId: string;
  siteId: string;
  patientId: string;
  chiefComplaintText: string;
  complaintSource: ComplaintSource;
  origin: EncounterOrigin;
  registeredBy: string;
  /** arrival_at y occurred_at de los dos eventos (D22). */
  now: Date;
  preRegistrationId?: string;
}

const SUMMARY_SELECT = {
  id: true,
  siteId: true,
  patientId: true,
  status: true,
  origin: true,
  arrivalAt: true,
  chiefComplaintText: true,
  complaintSource: true,
  cancellationReason: true,
  registeredBy: true,
  preRegistrations: { select: { id: true, preRegisteredAt: true }, take: 1 },
} as const;

type SummaryRow = Prisma.EncounterGetPayload<{ select: typeof SUMMARY_SELECT }>;

/** true si el error es una violación de único (índices parciales de D7 o encounter_id único). */
export function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

/**
 * Dueño de encounters (y de encounter_events vía EncounterEventsService). Toda atención se crea o cambia de estado
 * junto con su evento y su auditoría en la misma transacción (R37–R39).
 */
@Injectable()
export class EncountersService {
  private readonly logger = new Logger('encounters');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EncounterEventsService,
    private readonly patients: PatientsService,
    private readonly tenancy: TenancyService,
    private readonly users: UsersService,
  ) {}

  hasActiveEncounter(
    tenantId: string,
    patientId: string,
    tx: PrismaTx,
  ): Promise<boolean> {
    return tx.encounter
      .count({ where: { tenantId, patientId, status: ACTIVE_STATUSES } })
      .then((n) => n > 0);
  }

  /**
   * Crea la atención directamente en WAITING_TRIAGE (D6) con los dos eventos (ENCOUNTER_CREATED → REGISTERED y
   * STATUS_CHANGED REGISTERED → WAITING_TRIAGE, mismo occurred_at = arrival_at) y la auditoría ENCOUNTER_CREATED.
   * Debe llamarse dentro de una transacción. No ofrece ninguna vía a TRIAGED (R34).
   */
  async createInTx(n: NewEncounter, tx: PrismaTx): Promise<string> {
    const { id } = await tx.encounter.create({
      data: {
        tenantId: n.tenantId,
        siteId: n.siteId,
        patientId: n.patientId,
        status: 'WAITING_TRIAGE',
        origin: n.origin,
        arrivalAt: n.now,
        chiefComplaintText: n.chiefComplaintText,
        complaintSource: n.complaintSource,
        registeredBy: n.registeredBy,
      },
      select: { id: true },
    });
    const actor: Actor = { type: 'STAFF', id: n.registeredBy };
    await this.events.append(
      {
        tenantId: n.tenantId,
        encounterId: id,
        type: 'ENCOUNTER_CREATED',
        toStatus: 'REGISTERED',
        payload: n.preRegistrationId
          ? { origin: n.origin, preRegistrationId: n.preRegistrationId }
          : { origin: n.origin },
        actor,
        occurredAt: n.now,
      },
      tx,
    );
    await this.events.append(
      {
        tenantId: n.tenantId,
        encounterId: id,
        type: 'STATUS_CHANGED',
        fromStatus: 'REGISTERED',
        toStatus: 'WAITING_TRIAGE',
        actor,
        occurredAt: n.now,
      },
      tx,
    );
    await this.audit.record(
      {
        action: 'ENCOUNTER_CREATED',
        actorType: 'STAFF',
        actorId: n.registeredBy,
        tenantId: n.tenantId,
        entity: 'encounter',
        entityId: id,
        metadata: { origin: n.origin },
      },
      tx,
    );
    return id;
  }

  /** POST /encounters (R30–R32): registro directo por recepción, también de NN y menores. */
  async createDirect(
    principal: StaffPrincipal,
    dto: CreateEncounterDto,
  ): Promise<EncounterDto> {
    const tenantId = principal.tenantId;
    const [patient, site] = await Promise.all([
      this.patients.findById(tenantId, dto.patientId),
      this.tenancy.findSiteInTenant(tenantId, dto.siteId),
    ]);
    if (!patient || !site)
      throw new UnprocessableEntityException(BAD_REFERENCE);
    const now = this.clock.now();
    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const pending = await tx.preRegistration.count({
          where: {
            tenantId,
            patientId: patient.id,
            status: 'PENDING',
            expiresAt: { gt: now },
          },
        });
        if (
          pending ||
          (await this.hasActiveEncounter(tenantId, patient.id, tx))
        ) {
          throw new ConflictException(ACTIVE_ENCOUNTER);
        }
        return this.createInTx(
          {
            tenantId,
            siteId: site.id,
            patientId: patient.id,
            chiefComplaintText: dto.chiefComplaintText,
            complaintSource: dto.complaintSource,
            origin: 'DIRECT',
            registeredBy: principal.id,
            now,
          },
          tx,
        );
      });
    } catch (e) {
      // Dos registros simultáneos del mismo paciente: decide el índice único parcial (R32, D7).
      if (isUniqueViolation(e)) throw new ConflictException(ACTIVE_ENCOUNTER);
      throw e;
    }
    this.logger.log({
      msg: 'encounter_created',
      encounterId: id,
      origin: 'DIRECT',
      tenantId,
      userId: principal.id,
    });
    return this.findOne(tenantId, id);
  }

  /**
   * Transición genérica (D5), exportada para F-05/F-06: valida con la máquina de estados (nunca a TRIAGED, R34),
   * hace un UPDATE condicional sobre el estado leído (0 filas → 409, R33) e inserta el evento STATUS_CHANGED y la
   * auditoría ENCOUNTER_STATUS_CHANGED en la misma transacción (R38, R39).
   */
  async transition(
    tenantId: string,
    id: string,
    to: EncounterStatus,
    actor: Actor,
    tx: PrismaTx,
    opts: { cancellationReason?: string } = {},
  ): Promise<{ from: EncounterStatus; to: EncounterStatus }> {
    if (to === 'TRIAGED') throw new ConflictException(TRIAGED_FORBIDDEN);
    const current = isUuid(id)
      ? await tx.encounter.findFirst({
          where: { id, tenantId },
          select: { status: true },
        })
      : null;
    if (!current) throw new NotFoundException(NOT_FOUND);
    const from = current.status;
    if (!canGenericTransition(from, to)) {
      throw new ConflictException(INVALID_TRANSITION);
    }
    const { count } = await tx.encounter.updateMany({
      where: { id, tenantId, status: from },
      data: {
        status: to,
        ...(opts.cancellationReason !== undefined
          ? { cancellationReason: opts.cancellationReason }
          : {}),
      },
    });
    if (count === 0) throw new ConflictException(INVALID_TRANSITION);
    const now = this.clock.now();
    await this.events.append(
      {
        tenantId,
        encounterId: id,
        type: 'STATUS_CHANGED',
        fromStatus: from,
        toStatus: to,
        actor,
        occurredAt: now,
      },
      tx,
    );
    await this.audit.record(
      {
        action: 'ENCOUNTER_STATUS_CHANGED',
        actorType: actor.type,
        actorId: actor.id,
        tenantId,
        entity: 'encounter',
        entityId: id,
        metadata:
          opts.cancellationReason !== undefined
            ? { fromStatus: from, toStatus: to, reasonProvided: true }
            : { fromStatus: from, toStatus: to },
      },
      tx,
    );
    return { from, to };
  }

  /** POST /encounters/{id}/cancel (R35, R36): motivo en encounters.cancellation_reason, nunca en eventos ni auditoría. */
  async cancel(
    principal: StaffPrincipal,
    id: string,
    reason: string,
  ): Promise<EncounterDto> {
    const r = await this.prisma.$transaction((tx) =>
      this.transition(
        principal.tenantId,
        id,
        'CANCELLED',
        { type: 'STAFF', id: principal.id },
        tx,
        { cancellationReason: reason.trim() },
      ),
    );
    this.logger.log({
      msg: 'encounter_status_changed',
      encounterId: id,
      fromStatus: r.from,
      toStatus: r.to,
      tenantId: principal.tenantId,
      userId: principal.id,
    });
    return this.findOne(principal.tenantId, id);
  }

  /** GET /encounters/{id} (R42, R44): 404 igual para inexistente y de otro tenant. */
  async findOne(tenantId: string, id: string): Promise<EncounterDto> {
    const row = isUuid(id)
      ? await this.prisma.encounter.findFirst({
          where: { id, tenantId },
          select: SUMMARY_SELECT,
        })
      : null;
    if (!row) throw new NotFoundException(NOT_FOUND);
    const events = await this.events.listForEncounter(tenantId, id);
    const staffIds = events
      .filter((e) => e.actorType === 'STAFF' && e.actorId)
      .map((e) => e.actorId!);
    const [summary] = await this.toSummaries(tenantId, [row], staffIds);
    const names = summary.names;
    return {
      ...summary.dto,
      events: events.map((e) => ({
        id: e.id.toString(),
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        payload: (e.payload ?? {}) as Record<string, unknown>,
        actor: {
          type: e.actorType,
          id: e.actorId,
          fullName:
            e.actorType === 'STAFF' && e.actorId
              ? (names.get(e.actorId) ?? null)
              : null,
        },
        occurredAt: e.occurredAt.toISOString(),
      })),
    };
  }

  /** GET /encounters (R43): filtros, orden arrival_at DESC, id DESC y paginación limit/offset. */
  async list(
    tenantId: string,
    q: ListEncountersQueryDto,
  ): Promise<{ items: EncounterSummaryDto[] }> {
    const rows = await this.prisma.encounter.findMany({
      where: {
        tenantId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.siteId ? { siteId: q.siteId } : {}),
        ...(q.patientId ? { patientId: q.patientId } : {}),
      },
      orderBy: [{ arrivalAt: 'desc' }, { id: 'desc' }],
      take: q.limit ?? LIST_LIMIT_DEFAULT,
      skip: q.offset ?? 0,
      select: SUMMARY_SELECT,
    });
    const summaries = await this.toSummaries(tenantId, rows, []);
    return { items: summaries.map((s) => s.dto) };
  }

  /** Resuelve sede, paciente y responsable mediante los services de sus módulos dueños. */
  private async toSummaries(
    tenantId: string,
    rows: SummaryRow[],
    extraStaffIds: string[],
  ): Promise<{ dto: EncounterSummaryDto; names: Map<string, string> }[]> {
    const [sites, patients, names] = await Promise.all([
      this.tenancy.findSiteNames(
        tenantId,
        rows.map((r) => r.siteId),
      ),
      this.patients.findManyByIds(
        tenantId,
        rows.map((r) => r.patientId),
      ),
      this.users.findNames(tenantId, [
        ...rows.map((r) => r.registeredBy),
        ...extraStaffIds,
      ]),
    ]);
    return rows.map((r) => {
      const pre = r.preRegistrations[0] ?? null;
      return {
        names,
        dto: {
          id: r.id,
          siteId: r.siteId,
          siteName: sites.get(r.siteId) ?? '',
          status: r.status,
          origin: r.origin,
          arrivalAt: r.arrivalAt.toISOString(),
          preRegistrationId: pre?.id ?? null,
          preRegisteredAt: pre?.preRegisteredAt.toISOString() ?? null,
          chiefComplaintText: r.chiefComplaintText,
          complaintSource: r.complaintSource,
          cancellationReason: r.cancellationReason,
          registeredBy: {
            id: r.registeredBy,
            fullName: names.get(r.registeredBy) ?? null,
          },
          patient: patients.get(r.patientId)!,
        },
      };
    });
  }
}
