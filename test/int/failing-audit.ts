import { Injectable } from '@nestjs/common';
import type { PrismaTx } from '../../src/common/prisma/prisma.service.js';
import {
  type AuditEntry,
  AuditService,
} from '../../src/modules/audit/audit.service.js';

/** AuditService de prueba que falla en las acciones indicadas, para comprobar el fallo cerrado (R33). */
@Injectable()
export class FailingAuditService extends AuditService {
  static failOn = new Set<string>([
    'AUTH_LOGIN_SUCCEEDED',
    'PATIENT_ACCOUNT_CREATED',
  ]);

  async record(entry: AuditEntry, tx?: PrismaTx): Promise<void> {
    if (FailingAuditService.failOn.has(entry.action)) {
      throw new Error('audit_log no disponible (simulado)');
    }
    return super.record(entry, tx);
  }
}
