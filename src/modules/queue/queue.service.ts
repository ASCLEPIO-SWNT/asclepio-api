import { Injectable, Logger } from '@nestjs/common';
import type { StaffPrincipal } from '../../common/auth/principal.js';
import { Clock } from '../../common/clock/clock.js';
import { EncountersService } from '../encounters/encounters.service.js';
import type { QueueDto } from './dto/queue.dto.js';
import { buildQueue } from './queue.rules.js';

/** Cola priorizada (F-06-api): lee con EncountersService (D2) y ordena con buildQueue, con un único serverNow (R3). */
@Injectable()
export class QueueService {
  private readonly logger = new Logger('queue');

  constructor(
    private readonly encounters: EncountersService,
    private readonly clock: Clock,
  ) {}

  async get(principal: StaffPrincipal, siteId?: string): Promise<QueueDto> {
    const rows = await this.encounters.listActiveForQueue(
      principal.tenantId,
      siteId,
    );
    const now = this.clock.now();
    const queue = buildQueue(rows, now);
    // Sin datos del paciente (R15): solo recuentos por sección.
    this.logger.log({
      msg: 'queue_read',
      tenantId: principal.tenantId,
      userId: principal.id,
      waitingTriage: queue.waitingTriage.length,
      triaged: queue.triaged.length,
      inCare: queue.inCare.length,
    });
    return queue;
  }
}
