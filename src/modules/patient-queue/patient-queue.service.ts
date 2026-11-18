import { Injectable, Logger } from '@nestjs/common';
import type { PatientPrincipal } from '../../common/auth/principal.js';
import { Clock } from '../../common/clock/clock.js';
import { EncountersService } from '../encounters/encounters.service.js';
import { buildQueue } from '../queue/queue.rules.js';
import type { QueuePositionDto } from './dto/patient-queue.dto.js';
import { ESTIMATE, estimateWait, positionOf } from './estimate.rules.js';

/** Instantánea calculada y la atención con la que se calculó (para detectar DONE en el stream, D6). */
export interface Computed {
  snapshot: QueuePositionDto;
  encounterId: string | null;
  siteId: string | null;
}

const empty = (phase: 'NO_ACTIVE' | 'DONE', now: Date): QueuePositionDto => ({
  phase,
  position: null,
  aheadCount: null,
  estimate: null,
  estimateBasis: null,
  serverNow: now.toISOString(),
});

/**
 * Posición del paciente en la fila (F-10-api): atención activa por el token → cola de su sede con buildQueue (D2) →
 * posición → salidas de la fase → estimación (R1–R6). Los logs nunca llevan datos del paciente (R13).
 */
@Injectable()
export class PatientQueueService {
  private readonly logger = new Logger('patient-queue');

  constructor(
    private readonly encounters: EncountersService,
    private readonly clock: Clock,
  ) {}

  /** GET /patient/queue-position (R1). */
  async snapshot(principal: PatientPrincipal): Promise<QueuePositionDto> {
    const { snapshot } = await this.compute(principal, null);
    this.logger.log({
      msg: 'patient_queue_read',
      tenantId: principal.tenantId,
      phase: snapshot.phase,
    });
    return snapshot;
  }

  /**
   * Instantánea con un único serverNow. Si `trackedId` es la atención con la que se abrió el stream y ya no es la
   * activa del paciente, la fase es DONE (D6, R10).
   */
  async compute(
    principal: PatientPrincipal,
    trackedId: string | null,
  ): Promise<Computed> {
    const { tenantId, patientId } = principal;
    const active = await this.encounters.findActiveForPatient(
      tenantId,
      patientId,
    );
    if (trackedId !== null && active?.id !== trackedId) {
      return {
        snapshot: empty('DONE', this.clock.now()),
        encounterId: null,
        siteId: null,
      };
    }
    if (!active) {
      return {
        snapshot: empty('NO_ACTIVE', this.clock.now()),
        encounterId: null,
        siteId: null,
      };
    }
    const rows = await this.encounters.listActiveForQueue(
      tenantId,
      active.siteId,
    );
    const now = this.clock.now();
    const pos = positionOf(buildQueue(rows, now), active.id);
    const since = new Date(now.getTime() - ESTIMATE.windowMinutes * 60_000);
    const exits =
      pos.phase === 'WAITING_TRIAGE' || pos.phase === 'WAITING_CARE'
        ? await this.encounters.countPhaseExits(
            tenantId,
            active.siteId,
            pos.phase,
            since,
            now,
          )
        : 0;
    return {
      snapshot: {
        ...pos,
        ...estimateWait(pos.aheadCount, exits),
        serverNow: now.toISOString(),
      },
      encounterId: active.id,
      siteId: active.siteId,
    };
  }
}
