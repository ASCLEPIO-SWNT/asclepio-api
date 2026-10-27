import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  isStaffRole,
  JWT_ISSUER,
  PATIENT_AUDIENCE,
  STAFF_AUDIENCE,
  type PatientPrincipal,
  type Principal,
  type StaffPrincipal,
} from '../../common/auth/principal.js';
import { Clock } from '../../common/clock/clock.js';
import { APP_CONFIG, type AppConfig } from '../../common/config/app-config.js';

export interface AccessToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
}

const INVALID_TOKEN = 'Token ausente o inválido.';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Emisión y verificación de JWT con jose (D2, D3): HS256 fijo, issuer y audiencia verificados, 8 h sin refresh. */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly clock: Clock,
  ) {
    this.key = new TextEncoder().encode(config.jwtSecret);
  }

  issueStaff(p: Omit<StaffPrincipal, 'kind'>): Promise<AccessToken> {
    return this.issue(STAFF_AUDIENCE, p.id, { tid: p.tenantId, role: p.role });
  }

  issuePatient(p: Omit<PatientPrincipal, 'kind'>): Promise<AccessToken> {
    return this.issue(PATIENT_AUDIENCE, p.id, {
      tid: p.tenantId,
      pid: p.patientId,
    });
  }

  /** Devuelve el principal del token o lanza 401 (R9). */
  async verify(token: string): Promise<Principal> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: [STAFF_AUDIENCE, PATIENT_AUDIENCE],
        currentDate: this.clock.now(),
        requiredClaims: ['sub', 'iat', 'exp'],
      }));
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN);
    }
    const principal = toPrincipal(payload);
    if (!principal) throw new UnauthorizedException(INVALID_TOKEN);
    return principal;
  }

  private async issue(
    audience: string,
    subject: string,
    claims: Record<string, string>,
  ): Promise<AccessToken> {
    const iat = Math.floor(this.clock.now().getTime() / 1000);
    const exp = iat + ACCESS_TOKEN_TTL_SECONDS;
    const accessToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(JWT_ISSUER)
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.key);
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }
}

function toPrincipal(payload: JWTPayload): Principal | null {
  const { aud, sub, tid } = payload;
  if (typeof aud !== 'string' || !isNonEmptyString(sub)) return null;
  if (!isNonEmptyString(tid)) return null;
  if (aud === STAFF_AUDIENCE) {
    if (!isStaffRole(payload.role) || 'pid' in payload) return null;
    return { kind: 'STAFF', id: sub, tenantId: tid, role: payload.role };
  }
  if (aud === PATIENT_AUDIENCE) {
    if (!isNonEmptyString(payload.pid) || 'role' in payload) return null;
    return { kind: 'PATIENT', id: sub, tenantId: tid, patientId: payload.pid };
  }
  return null;
}
