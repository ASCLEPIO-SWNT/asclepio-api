import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { StaffPrincipal } from '../../common/auth/principal.js';
import { Clock } from '../../common/clock/clock.js';
import {
  PrismaService,
  type PrismaTx,
} from '../../common/prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { ClinicalCaptureService } from '../encounters/clinical-capture.service.js';
import {
  EncountersService,
  NOT_FOUND,
  NOT_WAITING_TRIAGE,
} from '../encounters/encounters.service.js';
import { UsersService } from '../users/users.service.js';
import type {
  TriageSuggestionDto,
  TriageSuggestionListDto,
} from './dto/triage-suggestion.dto.js';
import type { GuardReason } from './safety-guards.js';
import { TriageAdvisor } from './triage-advisor.js';
import { buildSnapshot } from './triage-input.js';
import type { TriageFactor } from './triage-response.validator.js';

/** 409 de R3 (D12): constante y distinto del de R2. */
export const NO_VITAL_SIGNS =
  'La atención no tiene signos vitales registrados.';

const ROW_SELECT = {
  id: true,
  encounterId: true,
  status: true,
  llmLevel: true,
  suggestedLevel: true,
  explanation: true,
  guardApplied: true,
  guardReasons: true,
  provider: true,
  model: true,
  promptVersion: true,
  latencyMs: true,
  createdAt: true,
  requestedBy: true,
} as const;

type Row = Prisma.TriageSuggestionGetPayload<{ select: typeof ROW_SELECT }>;

/** Sugerencia vigente para la decisión de triage de F-05 (D2): id, estado y nivel sugerido (ya ajustado). */
export interface CurrentSuggestionRow {
  id: string;
  status: 'OK' | 'INVALID_OUTPUT' | 'TIMEOUT' | 'FAILED';
  suggestedLevel: number | null;
}

/**
 * Dueño de triage_suggestions (solo INSERT y SELECT, R24). Lee la captura vía ClinicalCaptureService (D1), llama al
 * TriageAdvisor fuera de la transacción e inserta la sugerencia y su auditoría juntas (D6, R25, R26). Nunca modifica
 * la atención (R23). Los logs solo llevan ids, estado y latencia (R27).
 */
@Injectable()
export class TriageSuggestionsService {
  private readonly logger = new Logger('ai');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly capture: ClinicalCaptureService,
    private readonly encounters: EncountersService,
    private readonly users: UsersService,
    private readonly advisor: TriageAdvisor,
  ) {}

  /** POST /encounters/{id}/triage-suggestions (R1–R27). */
  async request(
    principal: StaffPrincipal,
    encounterId: string,
  ): Promise<TriageSuggestionDto> {
    const tenantId = principal.tenantId;
    // (1) Precondiciones: 404 (R4), 409 fuera de WAITING_TRIAGE (R2) y 409 sin signos vitales (R3).
    const capture = await this.capture.getForSuggestion(tenantId, encounterId);
    if (!capture) throw new NotFoundException(NOT_FOUND);
    if (capture.status !== 'WAITING_TRIAGE') {
      throw new ConflictException(NOT_WAITING_TRIAGE);
    }
    if (!capture.latestVitalSigns) {
      throw new ConflictException(NO_VITAL_SIGNS);
    }
    // (2) Advisor fuera de la transacción (D6): la instantánea no lleva datos identificables (R8–R10).
    const snapshot = buildSnapshot(capture, this.clock.todayInBogota());
    const result = await this.advisor.advise(snapshot);
    // (3) Sugerencia + auditoría en la misma transacción (R25, R26).
    const createdAt = this.clock.now();
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.triageSuggestion.create({
        data: {
          tenantId,
          encounterId,
          requestedBy: principal.id,
          inputSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          status: result.status,
          llmLevel: result.llmLevel,
          suggestedLevel: result.suggestedLevel,
          explanation: result.explanation
            ? (result.explanation as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          guardApplied: result.guardApplied,
          guardReasons: result.guardReasons as unknown as Prisma.InputJsonValue,
          provider: result.provider,
          model: result.model,
          promptVersion: result.promptVersion,
          rawResponse: result.rawResponse,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          latencyMs: result.latencyMs,
          attempts: result.attempts as unknown as Prisma.InputJsonValue,
          createdAt,
        },
        select: ROW_SELECT,
      });
      await this.audit.record(
        {
          action: 'TRIAGE_SUGGESTION_CREATED',
          actorType: 'STAFF',
          actorId: principal.id,
          tenantId,
          entity: 'triage_suggestions',
          entityId: created.id,
          metadata: {
            encounterId,
            status: result.status,
            guardApplied: result.guardApplied,
          },
        },
        tx,
      );
      return created;
    });
    this.logger.log({
      msg: 'triage_suggestion_created',
      suggestionId: row.id,
      encounterId,
      status: row.status,
      guardApplied: row.guardApplied,
      provider: row.provider,
      attempts: result.attempts.length,
      latencyMs: row.latencyMs,
      tenantId,
      userId: principal.id,
    });
    const names = await this.users.findNames(tenantId, [row.requestedBy]);
    return toDto(row, names);
  }

  /** GET /encounters/{id}/triage-suggestions (R21): de la más reciente a la más antigua, en cualquier estado. */
  async list(
    tenantId: string,
    encounterId: string,
  ): Promise<TriageSuggestionListDto> {
    const header = await this.encounters.findCaptureHeader(
      tenantId,
      encounterId,
    );
    if (!header) throw new NotFoundException(NOT_FOUND);
    const rows = await this.prisma.triageSuggestion.findMany({
      where: { tenantId, encounterId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: ROW_SELECT,
    });
    const names = await this.users.findNames(
      tenantId,
      rows.map((r) => r.requestedBy),
    );
    this.logger.log({
      msg: 'triage_suggestions_read',
      encounterId,
      count: rows.length,
      tenantId,
    });
    return { items: rows.map((r) => toDto(r, names)) };
  }

  /**
   * Sugerencia vigente de la atención del tenant (R21 de F-04: mayor created_at y después mayor id), dentro de la
   * transacción de la decisión de F-05 (D2); null si no hay ninguna o la atención es de otro tenant.
   */
  findCurrent(
    tenantId: string,
    encounterId: string,
    tx: PrismaTx,
  ): Promise<CurrentSuggestionRow | null> {
    return tx.triageSuggestion.findFirst({
      where: { tenantId, encounterId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, status: true, suggestedLevel: true },
    });
  }

  /** Nivel sugerido (ya ajustado) de una sugerencia del tenant, para el GET de la decisión de F-05 (R15, R16). */
  async findSuggestedLevel(
    tenantId: string,
    suggestionId: string,
  ): Promise<number | null> {
    const row = await this.prisma.triageSuggestion.findFirst({
      where: { id: suggestionId, tenantId },
      select: { suggestedLevel: true },
    });
    return row?.suggestedLevel ?? null;
  }
}

/** R22: niveles, explicación y factores en null si status ≠ OK; sin input_snapshot, raw_response ni attempts. */
function toDto(r: Row, names: Map<string, string>): TriageSuggestionDto {
  const ok = r.status === 'OK';
  const explanation = r.explanation as {
    summary: string;
    factors: TriageFactor[];
  } | null;
  return {
    id: r.id,
    encounterId: r.encounterId,
    status: r.status,
    suggestedLevel: ok ? r.suggestedLevel : null,
    llmLevel: ok ? r.llmLevel : null,
    explanation: ok ? (explanation?.summary ?? null) : null,
    factors: ok ? (explanation?.factors ?? null) : null,
    guardApplied: r.guardApplied,
    guardReasons: r.guardReasons as unknown as GuardReason[],
    provider: r.provider,
    model: r.model,
    promptVersion: r.promptVersion,
    latencyMs: r.latencyMs,
    createdAt: r.createdAt.toISOString(),
    requestedBy: {
      id: r.requestedBy,
      fullName: names.get(r.requestedBy) ?? null,
    },
  };
}
