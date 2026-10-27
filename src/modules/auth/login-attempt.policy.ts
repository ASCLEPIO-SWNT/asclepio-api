import { Injectable } from '@nestjs/common';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60_000;

/** Política de bloqueo (PA-F01-2, R5–R7): 5 fallos consecutivos → 15 min bloqueada. */
@Injectable()
export class LoginAttemptPolicy {
  isLocked(lockedUntil: Date | null, now: Date): boolean {
    return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
  }

  /** Recibe el contador ya incrementado; devuelve locked_until si toca bloquear. */
  lockAfterFailure(failedAttempts: number, now: Date): Date | null {
    return failedAttempts >= MAX_FAILED_ATTEMPTS
      ? new Date(now.getTime() + LOCK_DURATION_MS)
      : null;
  }
}
