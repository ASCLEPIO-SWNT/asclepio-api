import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Principal, StaffRole } from './principal.js';

export const IS_PUBLIC_KEY = 'asclepio:isPublic';
export const STAFF_ROLES_KEY = 'asclepio:staffRoles';
export const PATIENT_ONLY_KEY = 'asclepio:patientOnly';
export const BEARER_SCHEME = 'bearer';

/** Endpoint sin autenticación. Todo lo que no lo declare es protegido (R8, D4). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Roles de personal permitidos. Sin este decorador ni @PatientOnly() → 403 (R10). */
export const StaffRoles = (...roles: StaffRole[]) =>
  applyDecorators(
    SetMetadata(STAFF_ROLES_KEY, roles),
    ApiBearerAuth(BEARER_SCHEME),
  );

/** Endpoint al que acceden los tokens de paciente (R12, R13). */
export const PatientOnly = () =>
  applyDecorators(
    SetMetadata(PATIENT_ONLY_KEY, true),
    ApiBearerAuth(BEARER_SCHEME),
  );

export interface AuthenticatedRequest {
  principal?: Principal;
}

/** Principal construido por el guard a partir del token (el tenant sale solo del claim tid, R15). */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.principal) {
      throw new Error('CurrentPrincipal usado en un endpoint público.');
    }
    return req.principal;
  },
);
