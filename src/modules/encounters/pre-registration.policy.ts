export const PRE_REGISTRATION_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'EXPIRED',
  'REJECTED',
] as const;
export type PreRegistrationStatus = (typeof PRE_REGISTRATION_STATUSES)[number];

/** Un pre-registro PENDING sin confirmar expira a las 6 h (PA-PAC-3, D2). */
export const PRE_REGISTRATION_TTL_MS = 6 * 60 * 60 * 1000;

export function expiresAtFor(preRegisteredAt: Date): Date {
  return new Date(preRegisteredAt.getTime() + PRE_REGISTRATION_TTL_MS);
}

/** Vigente = PENDING y expires_at posterior a la hora del servidor. */
export function isVigente(
  status: PreRegistrationStatus,
  expiresAt: Date,
  now: Date,
): boolean {
  return status === 'PENDING' && expiresAt.getTime() > now.getTime();
}

/** Estado efectivo (R10): EXPIRED si es PENDING y ya pasó expires_at; si no, el status guardado. */
export function effectivePreRegistrationStatus(
  status: PreRegistrationStatus,
  expiresAt: Date,
  now: Date,
): PreRegistrationStatus {
  return status === 'PENDING' && !isVigente(status, expiresAt, now)
    ? 'EXPIRED'
    : status;
}
