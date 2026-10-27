import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  type PrismaTx,
} from '../../common/prisma/prisma.service.js';
import { type AuditJson, assertSafeMetadata } from '../audit/audit.service.js';
import type { EncounterStatus } from './encounter-state-machine.js';

export type EncounterEventType = 'ENCOUNTER_CREATED' | 'STATUS_CHANGED';
export type ActorType = 'STAFF' | 'PATIENT' | 'SYSTEM';

export interface Actor {
  type: ActorType;
  /** NULL solo si type = SYSTEM (CHECK de la base, D10). */
  id: string | null;
}

export interface NewEncounterEvent {
  tenantId: string;
  encounterId: string;
  type: EncounterEventType;
  fromStatus?: EncounterStatus | null;
  toStatus?: EncounterStatus | null;
  payload?: Record<string, AuditJson>;
  actor: Actor;
  occurredAt: Date;
}

export interface EncounterEventRow {
  id: bigint;
  type: string;
  fromStatus: EncounterStatus | null;
  toStatus: EncounterStatus | null;
  payload: unknown;
  actorType: ActorType;
  actorId: string | null;
  occurredAt: Date;
}

/**
 * Línea de tiempo append-only (RNF-02, R40): solo INSERT y lecturas. Nunca update ni delete; los grants de
 * asclepio_app lo garantizan además en la base. payload sin datos personales (R41).
 */
@Injectable()
export class EncounterEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async append(e: NewEncounterEvent, tx: PrismaTx): Promise<void> {
    const payload = e.payload ?? {};
    assertSafeMetadata(payload);
    await tx.encounterEvent.create({
      data: {
        tenantId: e.tenantId,
        encounterId: e.encounterId,
        type: e.type,
        fromStatus: e.fromStatus ?? null,
        toStatus: e.toStatus ?? null,
        payload,
        actorType: e.actor.type,
        actorId: e.actor.id,
        occurredAt: e.occurredAt,
      },
    });
  }

  /** Eventos de la atención ordenados por occurred_at y después por id (R42). */
  listForEncounter(
    tenantId: string,
    encounterId: string,
  ): Promise<EncounterEventRow[]> {
    return this.prisma.encounterEvent.findMany({
      where: { tenantId, encounterId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        type: true,
        fromStatus: true,
        toStatus: true,
        payload: true,
        actorType: true,
        actorId: true,
        occurredAt: true,
      },
    });
  }
}
