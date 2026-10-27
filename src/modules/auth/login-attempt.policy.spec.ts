import { LoginAttemptPolicy } from './login-attempt.policy.js';

describe('LoginAttemptPolicy', () => {
  const policy = new LoginAttemptPolicy();
  const NOW = new Date('2026-10-26T15:00:00Z');

  it('R5: al 5º fallo consecutivo bloquea 15 min desde la hora del servidor; antes no', () => {
    for (const n of [1, 2, 3, 4]) {
      expect(policy.lockAfterFailure(n, NOW)).toBeNull();
    }
    expect(policy.lockAfterFailure(5, NOW)?.toISOString()).toBe(
      '2026-10-26T15:15:00.000Z',
    );
  });

  it('R6: está bloqueada mientras locked_until sea posterior a la hora del servidor', () => {
    const until = new Date('2026-10-26T15:15:00Z');
    expect(policy.isLocked(until, NOW)).toBe(true);
    expect(policy.isLocked(until, new Date('2026-10-26T15:14:59.999Z'))).toBe(
      true,
    );
    expect(policy.isLocked(until, until)).toBe(false);
    expect(policy.isLocked(null, NOW)).toBe(false);
  });

  it('R7: tras un bloqueo vencido la cuenta vuelve a admitir login', () => {
    const until = policy.lockAfterFailure(5, NOW)!;
    expect(policy.isLocked(until, new Date(NOW.getTime() + 15 * 60_000))).toBe(
      false,
    );
  });
});
