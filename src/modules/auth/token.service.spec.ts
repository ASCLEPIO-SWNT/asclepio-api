import { UnauthorizedException } from '@nestjs/common';
import { decodeJwt, decodeProtectedHeader, SignJWT, UnsecuredJWT } from 'jose';
import { FixedClock } from '../../common/clock/clock.js';
import type { AppConfig } from '../../common/config/app-config.js';
import { TokenService } from './token.service.js';

const SECRET = 'unit-test-secret-0123456789abcdef0123456789';
const config = { jwtSecret: SECRET } as AppConfig;
const NOW = new Date('2026-10-26T15:00:00Z');
const STAFF = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  role: 'NURSE' as const,
};
const PATIENT = {
  id: '33333333-3333-4333-8333-333333333333',
  tenantId: STAFF.tenantId,
  patientId: '44444444-4444-4444-8444-444444444444',
};

function service(clock = new FixedClock(NOW)) {
  return new TokenService(config, clock);
}

async function sign(
  claims: Record<string, unknown>,
  opts: {
    alg?: string;
    secret?: string;
    iss?: string;
    aud?: string;
    sub?: string;
    iat?: number;
    exp?: number;
  } = {},
) {
  const iat = opts.iat ?? Math.floor(NOW.getTime() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: opts.alg ?? 'HS256' })
    .setIssuer(opts.iss ?? 'asclepio-api')
    .setAudience(opts.aud ?? 'asclepio-staff')
    .setSubject(opts.sub ?? STAFF.id)
    .setIssuedAt(iat)
    .setExpirationTime(opts.exp ?? iat + 3600)
    .sign(new TextEncoder().encode(opts.secret ?? SECRET));
}

describe('TokenService', () => {
  it('R1: el token de personal es HS256 con iss, aud asclepio-staff, sub, tid, role y exp = iat + 28 800 s', async () => {
    const res = await service().issueStaff(STAFF);
    expect(res.tokenType).toBe('Bearer');
    expect(decodeProtectedHeader(res.accessToken).alg).toBe('HS256');
    const claims = decodeJwt(res.accessToken);
    expect(claims).toMatchObject({
      iss: 'asclepio-api',
      aud: 'asclepio-staff',
      sub: STAFF.id,
      tid: STAFF.tenantId,
      role: 'NURSE',
      iat: NOW.getTime() / 1000,
    });
    expect(claims.exp! - claims.iat!).toBe(28_800);
    expect(claims).not.toHaveProperty('pid');
    expect(res.expiresAt).toBe('2026-10-26T23:00:00.000Z');
  });

  it('R3: el token de paciente tiene aud asclepio-patient, sub = cuenta, tid, pid, sin role y exp = iat + 28 800 s', async () => {
    const res = await service().issuePatient(PATIENT);
    const claims = decodeJwt(res.accessToken);
    expect(claims).toMatchObject({
      iss: 'asclepio-api',
      aud: 'asclepio-patient',
      sub: PATIENT.id,
      tid: PATIENT.tenantId,
      pid: PATIENT.patientId,
    });
    expect(claims).not.toHaveProperty('role');
    expect(claims.exp! - claims.iat!).toBe(28_800);
  });

  it('R2: la respuesta de login solo trae accessToken, tokenType y expiresAt (sin refresh token)', async () => {
    const staff = await service().issueStaff(STAFF);
    const patient = await service().issuePatient(PATIENT);
    for (const res of [staff, patient]) {
      expect(Object.keys(res).sort()).toEqual([
        'accessToken',
        'expiresAt',
        'tokenType',
      ]);
    }
  });

  it('R9: verifica los tokens emitidos y devuelve el principal correcto', async () => {
    const svc = service();
    await expect(
      svc.verify((await svc.issueStaff(STAFF)).accessToken),
    ).resolves.toEqual({ kind: 'STAFF', ...STAFF });
    await expect(
      svc.verify((await svc.issuePatient(PATIENT)).accessToken),
    ).resolves.toEqual({ kind: 'PATIENT', ...PATIENT });
  });

  it.each([
    ['mal formado', () => Promise.resolve('no-es-un-jwt')],
    [
      'alg none',
      () =>
        Promise.resolve(
          new UnsecuredJWT({ tid: STAFF.tenantId, role: 'NURSE' })
            .setIssuer('asclepio-api')
            .setAudience('asclepio-staff')
            .setSubject(STAFF.id)
            .setExpirationTime('1h')
            .encode(),
        ),
    ],
    [
      'HS512',
      () => sign({ tid: STAFF.tenantId, role: 'NURSE' }, { alg: 'HS512' }),
    ],
    [
      'firma con otro secreto',
      () =>
        sign(
          { tid: STAFF.tenantId, role: 'NURSE' },
          { secret: 'otro-secreto-0123456789abcdef0123456789' },
        ),
    ],
    [
      'iss desconocido',
      () => sign({ tid: STAFF.tenantId, role: 'NURSE' }, { iss: 'otro' }),
    ],
    [
      'aud desconocida',
      () => sign({ tid: STAFF.tenantId, role: 'NURSE' }, { aud: 'otra' }),
    ],
    ['rol desconocido', () => sign({ tid: STAFF.tenantId, role: 'SUPERUSER' })],
    ['sin tid', () => sign({ role: 'NURSE' })],
    [
      'paciente sin pid',
      () => sign({ tid: STAFF.tenantId }, { aud: 'asclepio-patient' }),
    ],
  ])('R9: rechaza un token %s con 401', async (_label, make) => {
    await expect(service().verify(await make())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('R9: rechaza un token vencido según la hora del servidor', async () => {
    const clock = new FixedClock(NOW);
    const svc = service(clock);
    const { accessToken } = await svc.issueStaff(STAFF);
    clock.advance(28_800 * 1000 - 1000);
    await expect(svc.verify(accessToken)).resolves.toMatchObject({
      kind: 'STAFF',
    });
    clock.advance(1000);
    await expect(svc.verify(accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
