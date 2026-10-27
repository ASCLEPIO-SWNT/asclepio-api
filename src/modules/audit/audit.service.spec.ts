import { FixedClock } from '../../common/clock/clock.js';
import type { PrismaService } from '../../common/prisma/prisma.service.js';
import { AuditService, assertSafeMetadata } from './audit.service.js';

describe('AuditService', () => {
  const NOW = new Date('2026-10-26T15:00:00Z');

  function setup() {
    const calls: unknown[] = [];
    const create = (args: unknown) => {
      calls.push(args);
      return Promise.resolve({});
    };
    const prisma = { auditLog: { create } } as unknown as PrismaService;
    return { calls, svc: new AuditService(prisma, new FixedClock(NOW)) };
  }

  it('R32: rechaza en metadata la contraseña, el hash, el email, el documento, nombres, fecha de nacimiento, sexo y tokens', () => {
    for (const key of [
      'password',
      'passwordHash',
      'password_hash',
      'email',
      'documentType',
      'document_number',
      'fullName',
      'name',
      'birthDate',
      'sex',
      'token',
      'accessToken',
    ]) {
      expect(() => assertSafeMetadata({ [key]: 'x' })).toThrow(/metadata/);
      expect(() => assertSafeMetadata({ nested: [{ [key]: 'x' }] })).toThrow(
        /metadata/,
      );
    }
    expect(() =>
      assertSafeMetadata({
        reason: 'BAD_PASSWORD',
        consentVersion: '2026-10-v1',
        linkedExistingPatient: false,
        lockedUntil: NOW.toISOString(),
      }),
    ).not.toThrow();
  });

  it('R41: rechaza en metadata el motivo de consulta, los motivos de cancelación y rechazo y la edad estimada; admite fields, isNN, origin y estados', () => {
    for (const key of [
      'chiefComplaintText',
      'chief_complaint_text',
      'complaintText',
      'cancellationReason',
      'rejection_reason',
      'estimatedAgeYears',
    ]) {
      expect(() => assertSafeMetadata({ [key]: 'x' })).toThrow(/metadata/);
      expect(() => assertSafeMetadata({ nested: { [key]: 'x' } })).toThrow(
        /metadata/,
      );
    }
    expect(() =>
      assertSafeMetadata({
        fields: ['fullName', 'sex'],
        isNN: true,
        origin: 'DIRECT',
        fromStatus: 'WAITING_TRIAGE',
        toStatus: 'CANCELLED',
        reasonProvided: true,
        complaintSource: 'TYPED',
      }),
    ).not.toThrow();
  });

  it('R18: rechaza en metadata y payload los nueve signos vitales, sus variantes genéricas, description, values, vitalSigns y findings; admite vitalSignsId, findingIds, count y encounterId', () => {
    for (const key of [
      'respiratoryRate',
      'oxygenSaturation',
      'supplementalOxygen',
      'systolicBp',
      'heartRate',
      'consciousness',
      'temperatureC',
      'diastolicBp',
      'glucoseMgDl',
      'respiratory_rate',
      'temperature_c',
      'glucose_mg_dl',
      'spo2',
      'SpO2',
      'temperature',
      'glucose',
      'description',
      'values',
      'vitalSigns',
      'vital_signs',
      'findings',
    ]) {
      expect(() => assertSafeMetadata({ [key]: 1 })).toThrow(/metadata/);
      expect(() => assertSafeMetadata({ nested: [{ [key]: 1 }] })).toThrow(
        /metadata/,
      );
    }
    expect(() =>
      assertSafeMetadata({
        vitalSignsId: '6f1c1d2e-0000-4000-8000-000000000000',
        findingIds: ['6f1c1d2e-0000-4000-8000-000000000001'],
        count: 2,
        encounterId: '6f1c1d2e-0000-4000-8000-000000000002',
      }),
    ).not.toThrow();
  });

  it('R32: record no inserta nada si la metadata trae datos personales', async () => {
    const { svc, calls } = setup();
    await expect(
      svc.record({
        action: 'AUTH_LOGIN_FAILED',
        entity: 'user',
        metadata: { email: 'x' },
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('R34: record solo hace INSERT, con occurred_at del reloj del servidor', async () => {
    const { svc, calls } = setup();
    await svc.record({
      action: 'AUTH_LOGIN_SUCCEEDED',
      actorType: 'STAFF',
      actorId: 'a',
      tenantId: 't',
      entity: 'user',
      entityId: 'a',
    });
    expect(calls).toEqual([
      {
        data: {
          action: 'AUTH_LOGIN_SUCCEEDED',
          actorType: 'STAFF',
          actorId: 'a',
          tenantId: 't',
          entity: 'user',
          entityId: 'a',
          metadata: {},
          occurredAt: NOW,
        },
      },
    ]);
    expect(Object.getOwnPropertyNames(AuditService.prototype)).toEqual([
      'constructor',
      'record',
    ]);
  });
});
