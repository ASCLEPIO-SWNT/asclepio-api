import { Controller, Get, type INestApplication, Post } from '@nestjs/common';
import { SignJWT } from 'jose';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  CurrentPrincipal,
  PatientOnly,
  Public,
  StaffRoles,
} from '../src/common/auth/decorators.js';
import type { Principal } from '../src/common/auth/principal.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { TenancyService } from '../src/modules/tenancy/tenancy.service.js';
import { createApp, problem } from './e2e-app.js';

const TENANT = '22222222-2222-4222-8222-222222222222';
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999';

/** Controlador solo de prueba: rutas sin decorador, de NURSE, de paciente y pública. */
@Controller('test-guard')
class GuardTestController {
  @Get('undeclared')
  undeclared() {
    return { ok: true };
  }

  @Get('nurse')
  @StaffRoles('NURSE')
  nurse(@CurrentPrincipal() p: Principal) {
    return p;
  }

  @Get('patient')
  @PatientOnly()
  patient(@CurrentPrincipal() p: Principal) {
    return p;
  }

  @Post('tenant')
  @StaffRoles('NURSE')
  @PatientOnly()
  tenant(@CurrentPrincipal() p: Principal) {
    return { tenantId: p.tenantId };
  }

  @Get('public')
  @Public()
  pub() {
    return { ok: true };
  }
}

describe('AuthGuard (e2e, sin base)', () => {
  let app: INestApplication<App>;
  let tokens: TokenService;
  let nurse: string;
  let physician: string;
  let patient: string;
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);

  beforeAll(async () => {
    app = await createApp({
      controllers: [GuardTestController],
      overrides: [
        {
          provide: TenancyService,
          useValue: { listActiveWithSites: () => [] },
        },
      ],
    });
    tokens = app.get(TokenService);
    const staff = {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: TENANT,
    };
    nurse = (await tokens.issueStaff({ ...staff, role: 'NURSE' })).accessToken;
    physician = (await tokens.issueStaff({ ...staff, role: 'PHYSICIAN' }))
      .accessToken;
    patient = (
      await tokens.issuePatient({
        id: '33333333-3333-4333-8333-333333333333',
        tenantId: TENANT,
        patientId: '44444444-4444-4444-8444-444444444444',
      })
    ).accessToken;
  });

  afterAll(() => app.close());

  const get = (path: string, token?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('R8: los únicos endpoints públicos de la API son health, los dos logins, el alta de paciente, public/tenants y public/consent', async () => {
    const publicRoutes: [string, string][] = [
      ['get', '/api/v1/health'],
      ['post', '/api/v1/auth/login'],
      ['post', '/api/v1/auth/patient/login'],
      ['post', '/api/v1/auth/patient/accounts'],
      ['get', '/api/v1/public/tenants'],
      ['get', '/api/v1/public/consent'],
    ];
    for (const [method, path] of publicRoutes) {
      const res = await (method === 'get'
        ? request(app.getHttpServer()).get(path)
        : request(app.getHttpServer()).post(path).send({}));
      expect([path, res.status]).not.toEqual([path, 401]);
    }
    // Todo lo demás exige token, incluidas las rutas sin decorador.
    await get('/api/v1/me').expect(401);
    await get('/api/v1/test-guard/undeclared').expect(401);
    await get('/api/v1/test-guard/public').expect(200);
  });

  it('R9: sin cabecera Authorization Bearer responde 401 problem+json', async () => {
    const res = await get('/api/v1/test-guard/nurse').expect(401);
    expect(problem(res)).toMatchObject({ status: 401, title: 'Unauthorized' });
    await request(app.getHttpServer())
      .get('/api/v1/test-guard/nurse')
      .set('Authorization', `Basic ${nurse}`)
      .expect(401);
  });

  it.each([
    ['mal formado', () => Promise.resolve('abc.def')],
    [
      'con firma inválida',
      async () =>
        new SignJWT({ tid: TENANT, role: 'NURSE' })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuer('asclepio-api')
          .setAudience('asclepio-staff')
          .setSubject('u')
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(new TextEncoder().encode('x'.repeat(40))),
    ],
    [
      'con algoritmo HS384',
      async () =>
        new SignJWT({ tid: TENANT, role: 'NURSE' })
          .setProtectedHeader({ alg: 'HS384' })
          .setIssuer('asclepio-api')
          .setAudience('asclepio-staff')
          .setSubject('u')
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(secret),
    ],
    [
      'con iss no reconocido',
      async () =>
        new SignJWT({ tid: TENANT, role: 'NURSE' })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuer('otro-emisor')
          .setAudience('asclepio-staff')
          .setSubject('u')
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(secret),
    ],
    [
      'con aud no reconocida',
      async () =>
        new SignJWT({ tid: TENANT, role: 'NURSE' })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuer('asclepio-api')
          .setAudience('otra-app')
          .setSubject('u')
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(secret),
    ],
    [
      'vencido',
      async () =>
        new SignJWT({ tid: TENANT, role: 'NURSE' })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuer('asclepio-api')
          .setAudience('asclepio-staff')
          .setSubject('u')
          .setIssuedAt(Math.floor(Date.now() / 1000) - 30_000)
          .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
          .sign(secret),
    ],
  ])('R9: un token %s responde 401 problem+json', async (_l, make) => {
    const res = await get('/api/v1/test-guard/nurse', await make()).expect(401);
    expect(problem(res).status).toBe(401);
  });

  it('R10: un endpoint protegido sin roles ni acceso de paciente responde 403 a cualquier token válido', async () => {
    for (const token of [nurse, physician, patient]) {
      const res = await get('/api/v1/test-guard/undeclared', token).expect(403);
      expect(problem(res)).toMatchObject({ status: 403, title: 'Forbidden' });
    }
  });

  it('R11: un token de personal con un rol no permitido responde 403; con el rol permitido, 200', async () => {
    const res = await get('/api/v1/test-guard/nurse', physician).expect(403);
    expect(problem(res).status).toBe(403);
    await get('/api/v1/test-guard/nurse', nurse).expect(200);
  });

  it('R12: un token de paciente en un endpoint de personal responde 403', async () => {
    const res = await get('/api/v1/test-guard/nurse', patient).expect(403);
    expect(problem(res).status).toBe(403);
  });

  it('R13: un token de personal en un endpoint exclusivo de paciente responde 403', async () => {
    const res = await get('/api/v1/test-guard/patient', nurse).expect(403);
    expect(problem(res).status).toBe(403);
    const ok = await get('/api/v1/test-guard/patient', patient).expect(200);
    expect(ok.body).toMatchObject({ kind: 'PATIENT', tenantId: TENANT });
  });

  it('R15: el tenant sale solo del claim tid e ignora cabeceras, query y cuerpo', async () => {
    for (const token of [nurse, patient]) {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/test-guard/tenant?tenantId=${OTHER_TENANT}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-Id', OTHER_TENANT)
        .send({ tenantId: OTHER_TENANT, tid: OTHER_TENANT })
        .expect(201);
      expect(res.body).toEqual({ tenantId: TENANT });
    }
  });
});
