/** Roles del personal (R14). Mismos valores que el enum user_role de la base. */
export const STAFF_ROLES = [
  'RECEPTION',
  'NURSE',
  'PHYSICIAN',
  'ADMIN',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: unknown): value is StaffRole {
  return (STAFF_ROLES as readonly unknown[]).includes(value);
}

/** Principal de personal: token con aud = asclepio-staff (D3). */
export interface StaffPrincipal {
  kind: 'STAFF';
  id: string;
  tenantId: string;
  role: StaffRole;
}

/** Principal de paciente: token con aud = asclepio-patient (D3, ADR 0008). */
export interface PatientPrincipal {
  kind: 'PATIENT';
  id: string;
  tenantId: string;
  patientId: string;
}

export type Principal = StaffPrincipal | PatientPrincipal;

export const JWT_ISSUER = 'asclepio-api';
export const STAFF_AUDIENCE = 'asclepio-staff';
export const PATIENT_AUDIENCE = 'asclepio-patient';
/** Duración del token de acceso: 8 h, un turno (PA-F01-1). Sin refresh token (R2). */
export const ACCESS_TOKEN_TTL_SECONDS = 28_800;
