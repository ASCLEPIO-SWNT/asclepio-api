import { FixedClock } from '../../common/clock/clock.js';
import {
  effectivePreRegistrationStatus,
  expiresAtFor,
  isVigente,
  PRE_REGISTRATION_TTL_MS,
} from './pre-registration.policy.js';

const AT = new Date('2026-10-26T15:00:00.000Z');

describe('Política del pre-registro (expiración perezosa, D2)', () => {
  it('R5: expires_at = pre_registered_at + 6 h, tomado del reloj del servidor', () => {
    const clock = new FixedClock(AT);
    expect(PRE_REGISTRATION_TTL_MS).toBe(6 * 60 * 60 * 1000);
    expect(expiresAtFor(clock.now()).toISOString()).toBe(
      '2026-10-26T21:00:00.000Z',
    );
  });

  it('R10: un PENDING es vigente justo antes de las 6 h y EXPIRED exactamente en y después de expires_at', () => {
    const clock = new FixedClock(AT);
    const expiresAt = expiresAtFor(clock.now());
    clock.set(new Date(expiresAt.getTime() - 1));
    expect(
      effectivePreRegistrationStatus('PENDING', expiresAt, clock.now()),
    ).toBe('PENDING');
    expect(isVigente('PENDING', expiresAt, clock.now())).toBe(true);
    clock.set(expiresAt);
    expect(
      effectivePreRegistrationStatus('PENDING', expiresAt, clock.now()),
    ).toBe('EXPIRED');
    expect(isVigente('PENDING', expiresAt, clock.now())).toBe(false);
    clock.advance(60_000);
    expect(
      effectivePreRegistrationStatus('PENDING', expiresAt, clock.now()),
    ).toBe('EXPIRED');
  });

  it('R10: los estados no PENDING se presentan tal cual, aunque haya pasado expires_at', () => {
    const late = new Date(AT.getTime() + PRE_REGISTRATION_TTL_MS * 2);
    const expiresAt = expiresAtFor(AT);
    for (const s of ['CONFIRMED', 'REJECTED', 'EXPIRED'] as const) {
      expect(effectivePreRegistrationStatus(s, expiresAt, late)).toBe(s);
      expect(isVigente(s, expiresAt, AT)).toBe(false);
    }
  });
});
