import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock/clock.js';
import {
  PrismaService,
  type PrismaTx,
} from '../../common/prisma/prisma.service.js';

export type AuditAction =
  | 'AUTH_LOGIN_SUCCEEDED'
  | 'AUTH_LOGIN_FAILED'
  | 'AUTH_ACCOUNT_LOCKED'
  | 'PATIENT_ACCOUNT_CREATED'
  | 'USER_CREATED'
  | 'SITE_CREATED'
  // F-02-api
  | 'PATIENT_CREATED'
  | 'PATIENT_UPDATED'
  | 'PATIENT_IDENTITY_VERIFIED'
  | 'PRE_REGISTRATION_CREATED'
  | 'PRE_REGISTRATION_EXPIRED'
  | 'PRE_REGISTRATION_CONFIRMED'
  | 'PRE_REGISTRATION_REJECTED'
  | 'ENCOUNTER_CREATED'
  | 'ENCOUNTER_STATUS_CHANGED'
  // F-03-api
  | 'VITAL_SIGNS_RECORDED'
  | 'SYMPTOM_FINDINGS_RECORDED'
  // F-04-api
  | 'TRIAGE_SUGGESTION_CREATED'
  // F-05-api
  | 'TRIAGE_DECIDED';

export type AuditJson =
  string | number | boolean | null | AuditJson[] | { [key: string]: AuditJson };

export interface AuditEntry {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  tenantId?: string | null;
  actorType?: 'STAFF' | 'PATIENT' | 'SYSTEM' | null;
  actorId?: string | null;
  metadata?: Record<string, AuditJson>;
}

// Claves prohibidas en audit_log.metadata (R32, RNF-05). Se comparan en minúsculas y sin '_' ni '-'.
const FORBIDDEN_KEYS = new Set([
  'password',
  'passwordhash',
  'hash',
  'email',
  'document',
  'documenttype',
  'documentnumber',
  'name',
  'fullname',
  'firstname',
  'lastname',
  'birthdate',
  'sex',
  'token',
  'accesstoken',
  'refreshtoken',
  // F-02-api (D16, R41): texto libre clínico o motivos (posibles datos personales) y edad estimada.
  // 'reason' no se prohíbe: F-01 lo usa para códigos (AUTH_LOGIN_FAILED); F-02 solo guarda reasonProvided.
  'chiefcomplainttext',
  'complainttext',
  'cancellationreason',
  'rejectionreason',
  'estimatedageyears',
  // F-03-api (D9, R18): valores clínicos de la captura y textos de los hallazgos. Se admiten vitalSignsId,
  // findingIds, count y encounterId (solo ids y conteos).
  'respiratoryrate',
  'oxygensaturation',
  'supplementaloxygen',
  'systolicbp',
  'heartrate',
  'consciousness',
  'temperaturec',
  'diastolicbp',
  'glucosemgdl',
  'spo2',
  'temperature',
  'glucose',
  'description',
  'values',
  'vitalsigns',
  'findings',
  // F-04-api (R25, R27): la sugerencia se audita solo con encounterId, status y guardApplied; nunca la instantánea,
  // la respuesta cruda, el prompt, los niveles, la explicación ni los factores.
  'inputsnapshot',
  'rawresponse',
  'snapshot',
  'level',
  'llmlevel',
  'suggestedlevel',
  'explanation',
  'factors',
  'prompt',
  // F-05-api (R21): la decisión se audita solo con encounterId y action (y el evento con decisionId y action); nunca
  // el nivel final ni el motivo de corrección. 'reason' no se prohíbe: F-01 la usa para códigos (enmienda 2026-11-09).
  'finallevel',
  'correctionreason',
]);

/** Lanza si la metadata contiene (a cualquier profundidad) una clave con datos personales o secretos. */
export function assertSafeMetadata(value: AuditJson | undefined): void {
  if (Array.isArray(value)) {
    value.forEach(assertSafeMetadata);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''))) {
        throw new Error('audit_log.metadata no admite datos personales.');
      }
      assertSafeMetadata(child);
    }
  }
}

/** Único escritor de audit_log (append-only, R34): solo INSERT. Acepta la transacción del llamador. */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async record(entry: AuditEntry, tx?: PrismaTx): Promise<void> {
    const metadata = entry.metadata ?? {};
    assertSafeMetadata(metadata);
    await (tx ?? this.prisma).auditLog.create({
      data: {
        action: entry.action,
        actorType: entry.actorType ?? null,
        actorId: entry.actorId ?? null,
        tenantId: entry.tenantId ?? null,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        metadata,
        occurredAt: this.clock.now(),
      },
    });
  }
}
