import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  type AuthenticatedRequest,
  IS_PUBLIC_KEY,
  PATIENT_ONLY_KEY,
  STAFF_ROLES_KEY,
} from '../../common/auth/decorators.js';
import type { StaffRole } from '../../common/auth/principal.js';
import { TokenService } from './token.service.js';

const BEARER = /^Bearer ([A-Za-z0-9\-_.]+)$/;

/**
 * Guard global (APP_GUARD) con denegación por defecto (D4):
 * @Public() → pasa; si no, Bearer válido (401) y después @StaffRoles(...) o @PatientOnly() (403).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const req = context
      .switchToHttp()
      .getRequest<Request & AuthenticatedRequest>();
    const match = BEARER.exec(req.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException('Token ausente o inválido.');
    const principal = await this.tokens.verify(match[1]);

    const staffRoles = this.reflector.getAllAndOverride<
      StaffRole[] | undefined
    >(STAFF_ROLES_KEY, targets);
    const patientOnly = this.reflector.getAllAndOverride<boolean | undefined>(
      PATIENT_ONLY_KEY,
      targets,
    );
    const allowed =
      principal.kind === 'STAFF'
        ? (staffRoles ?? []).includes(principal.role)
        : patientOnly === true;
    if (!allowed) throw new ForbiddenException('Acceso denegado.');
    req.principal = principal;
    return true;
  }
}
