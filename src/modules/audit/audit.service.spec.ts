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
