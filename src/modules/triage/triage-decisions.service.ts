import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { StaffPrincipal } from '../../common/auth/principal.js';
import { Clock } from '../../common/clock/clock.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { TriageSuggestionsService } from '../ai/triage-suggestions.service.js';
import {
  EncountersService,
  isUniqueViolation,
  NOT_FOUND,
} from '../encounters/encounters.service.js';
import { UsersService } from '../users/users.service.js';
import {
  type CreateTriageDecisionDto,
  type TriageDecisionDto,
  validateDecisionBody,
} from './dto/triage-decision.dto.js';
import { type DecisionError, decide } from './triage-decision.rules.js';

/** 422 de R5 (cuerpo). */
export const INVALID_DECISION =
  'La decisión de triage no superó la validación.';
/** 422 de R6. */
export const SAME_AS_SUGGESTED =
  'El nivel corregido coincide con el nivel sugerido: use VALIDATE.';
/** 409 de R7 (constante, sin revelar si la sugerencia existe o de quién es). */
export const NOT_CURRENT_OR_INVALID =
  'La sugerencia no es la vigente o no es válida.';
/** 409 de R8. */
export const HAS_VALID_SUGGESTION =
  'La atención tiene una sugerencia válida: valídela o corríjala.';
/** 409 de R12. */
export const ALREADY_DECIDED = 'La atención ya tiene una decisión de triage.';
/** 409 de R13. */
export const NOT_WAITING_TRIAGE_DECISION =
  'La atención no está en espera de triage: no admite una decisión de triage.';
/** 404 de R16 (distinto del de R14). */
export const NO_DECISION = 'La atención no tiene una decisión de triage.';

/** Decisión para los reportes (F-07-api, D2): sin reason, decided_by ni decided_at. */
export interface DecisionForReport {
  encounterId: string;
  action: TriageDecisionDto['action'];
  level: number;
  suggestionId: string | null;
}

const ROW_SELECT = {
  id: true,
  encounterId: true,
  action: true,
  level: true,
  suggestionId: true,
  reason: true,
  decidedAt: true,
  decidedBy: true,
} as const;

interface Row {
  id: string;
  encounterId: string;
  action: TriageDecisionDto['action'];
  level: number;
  suggestionId: string | null;
  reason: string | null;
  decidedAt: Date;
  decidedBy: string;
}

/** Excepción de cada error de las reglas (R6–R8). */
function ruleException(error: DecisionError): Error {
  switch (error) {
    case 'NOT_CURRENT_OR_INVALID':
      return new ConflictException(NOT_CURRENT_OR_INVALID);
    case 'HAS_VALID_SUGGESTION':
      return new ConflictException(HAS_VALID_SUGGESTION);
    case 'SAME_AS_SUGGESTED':
      return new UnprocessableEntityException({
        detail: SAME_AS_SUGGESTED,
        errors: [
          {
            field: 'level',
            message: 'level debe ser distinto del nivel sugerido en CORRECT',
          },
        ],
      });
  }
}

/**
 * Dueño de triage_decisions (F-05-api): solo INSERT y SELECT (R19). Registra la decisión de enfermería y, en la misma
 * transacción, pasa la atención a TRIAGED vía EncountersService.recordTriage (D2, D3, R9, R10). Lee la sugerencia
 * vigente vía TriageSuggestionsService (ai). Hora del Clock y responsable/tenant del token (R20). Los logs solo
 * llevan ids y la acción: nunca el nivel ni el motivo (R21).
 */
@Injectable()
export class TriageDecisionsService {
  private readonly logger = new Logger('triage');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly encounters: EncountersService,
    private readonly suggestions: TriageSuggestionsService,
    private readonly users: UsersService,
  ) {}

  /** POST /encounters/{id}/triage-decision (R1–R14, R20, R21). Orden de errores de D5. */
  async decide(
    principal: StaffPrincipal,
    encounterId: string,
    dto: CreateTriageDecisionDto,
  ): Promise<TriageDecisionDto> {
    // (0) 422 del cuerpo antes de tocar la base (D5, R5).
    const body = validateDecisionBody(dto);
    if ('errors' in body) {
      throw new UnprocessableEntityException({
        detail: INVALID_DECISION,
        errors: body.errors,
      });
    }
    const tenantId = principal.tenantId;
    const now = this.clock.now();
    let result: { row: Row; suggestedLevel: number | null };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        // (1) Bloqueo de la atención en WAITING_TRIAGE: 404 (R14) o 409 (R12 si ya hay decisión, si no R13).
        try {
          await this.encounters.lockForCapture(
            tenantId,
            encounterId,
            now,
            tx,
            NOT_WAITING_TRIAGE_DECISION,
          );
        } catch (e) {
          if (
            e instanceof ConflictException &&
            (await tx.triageDecision.count({
              where: { tenantId, encounterId },
            }))
          ) {
            throw new ConflictException(ALREADY_DECIDED);
          }
          throw e;
        }
        // (2) Sugerencia vigente y (3) reglas R6–R8.
        const current = await this.suggestions.findCurrent(
          tenantId,
          encounterId,
          tx,
        );
        const outcome = decide(body.input, current);
        if (!outcome.ok) throw ruleException(outcome.error);
        const d = outcome.decision;
        // (4) La decisión; el índice único de encounter_id es la segunda barrera de R12.
        const row = await tx.triageDecision.create({
          data: {
            tenantId,
            encounterId,
            suggestionId: d.suggestionId,
            action: d.action,
            level: d.level,
            reason: d.reason,
            decidedBy: principal.id,
            decidedAt: now,
          },
          select: ROW_SELECT,
        });
        // (5) TRIAGED, evento y auditoría (R9).
        await this.encounters.recordTriage(
          tenantId,
          encounterId,
          {
            level: d.level,
            decisionId: row.id,
            action: d.action,
            actorId: principal.id,
            now,
          },
          tx,
        );
        return { row, suggestedLevel: d.suggestedLevel };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(ALREADY_DECIDED);
      throw e;
    }
    this.logger.log({
      msg: 'triage_decided',
      decisionId: result.row.id,
      encounterId,
      action: result.row.action,
      tenantId,
      userId: principal.id,
    });
    return this.toDto(tenantId, result.row, result.suggestedLevel);
  }

  /**
   * Decisiones de las atenciones dadas, del tenant (F-07-api, D2, R17): sin motivo de corrección ni responsable (R13).
   * Lista vacía → sin consulta.
   */
  async listByEncounters(
    tenantId: string,
    encounterIds: string[],
  ): Promise<DecisionForReport[]> {
    if (!encounterIds.length) return [];
    return this.prisma.triageDecision.findMany({
      where: { tenantId, encounterId: { in: encounterIds } },
      select: {
        encounterId: true,
        action: true,
        level: true,
        suggestionId: true,
      },
    });
  }

  /** GET /encounters/{id}/triage-decision (R14–R16). */
  async findOne(
    tenantId: string,
    encounterId: string,
  ): Promise<TriageDecisionDto> {
    const header = await this.encounters.findCaptureHeader(
      tenantId,
      encounterId,
    );
    if (!header) throw new NotFoundException(NOT_FOUND);
    const row = await this.prisma.triageDecision.findFirst({
      where: { tenantId, encounterId },
      select: ROW_SELECT,
    });
    if (!row) throw new NotFoundException(NO_DECISION);
    const suggestedLevel = row.suggestionId
      ? await this.suggestions.findSuggestedLevel(tenantId, row.suggestionId)
      : null;
    this.logger.log({
      msg: 'triage_decision_read',
      decisionId: row.id,
      encounterId,
      tenantId,
    });
    return this.toDto(tenantId, row, suggestedLevel);
  }

  /** R15. */
  private async toDto(
    tenantId: string,
    r: Row,
    suggestedLevel: number | null,
  ): Promise<TriageDecisionDto> {
    const names = await this.users.findNames(tenantId, [r.decidedBy]);
    return {
      id: r.id,
      encounterId: r.encounterId,
      action: r.action,
      level: r.level,
      suggestionId: r.suggestionId,
      suggestedLevel: r.suggestionId ? suggestedLevel : null,
      reason: r.reason,
      decidedAt: r.decidedAt.toISOString(),
      decidedBy: { id: r.decidedBy, fullName: names.get(r.decidedBy) ?? null },
    };
  }
}
