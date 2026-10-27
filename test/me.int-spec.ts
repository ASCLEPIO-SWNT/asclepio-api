import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { createApp, problem } from './e2e-app.js';
import { Fixtures, PASSWORD } from './int/fixtures.js';

describe('GET /api/v1/me (integración)', () => {
  let app: INestApplication<App>;
  let fx: Fixtures;
  let tokens: TokenService;

  beforeAll(async () => {
    app = await createApp();
    fx = new Fixtures(app);
    tokens = app.get(TokenService);
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  const me = (token: string) =>
    request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token}`);

  it('R17: con token de personal responde kind STAFF con id, tenantId, email, fullName y role, sin hash ni contadores', async () => {
    const t = await fx.tenant('me-staff');
    const user = await fx.user(t.id, { role: 'RECEPTION' });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const res = await me(
      (login.body as { accessToken: string }).accessToken,
    ).expect(200);
    expect(res.body).toEqual({
      kind: 'STAFF',
      id: user.id,
      tenantId: t.id,
      email: user.email,
      fullName: user.fullName,
      role: 'RECEPTION',
    });
    expect(res.text).not.toMatch(/password|failed|locked|scrypt/i);
  });

  it('R18: con token de paciente responde kind PATIENT con los datos de la cuenta del token, ignorando parámetros', async () => {
    const t = await fx.tenant('me-patient');
    const { account, patient } = await fx.patientAccount(t.id);
    const { patient: other } = await fx.patientAccount(t.id);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/patient/login')
      .send({
        tenantId: t.id,
        documentType: 'CC',
        documentNumber: patient.documentNumber,
        password: PASSWORD,
      })
      .expect(200);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/me?id=${other.id}&patientId=${other.id}`)
      .set(
        'Authorization',
        `Bearer ${(login.body as { accessToken: string }).accessToken}`,
      )
      .set('X-Patient-Id', other.id)
      .expect(200);
    expect(res.body).toEqual({
      kind: 'PATIENT',
      id: account.id,
      tenantId: t.id,
      patientId: patient.id,
      consentVersion: '2026-10-v1',
      identityVerified: false,
    });
  });

  it('R45: GET /me de paciente expone identityVerified = false para una cuenta recién creada', async () => {
    const t = await fx.tenant('me-identity');
    const { account, patient } = await fx.patientAccount(t.id);
    const token = (
      await tokens.issuePatient({
        id: account.id,
        tenantId: t.id,
        patientId: patient.id,
      })
    ).accessToken;
    const res = await me(token).expect(200);
    expect((res.body as { identityVerified: boolean }).identityVerified).toBe(
      false,
    );
  });

  it('R19: si la cuenta del token ya no existe o está inactiva responde 401 problem+json', async () => {
    const t = await fx.tenant('me-gone');
    const inactiveUser = await fx.user(t.id, { active: false });
    const { account, patient } = await fx.patientAccount(t.id, {
      active: false,
    });
    const cases = [
      await tokens.issueStaff({
        id: inactiveUser.id,
        tenantId: t.id,
        role: 'NURSE',
      }),
      await tokens.issueStaff({
        id: '00000000-0000-4000-8000-000000000001',
        tenantId: t.id,
        role: 'NURSE',
      }),
      await tokens.issuePatient({
        id: account.id,
        tenantId: t.id,
        patientId: patient.id,
      }),
      await tokens.issuePatient({
        id: '00000000-0000-4000-8000-000000000002',
        tenantId: t.id,
        patientId: patient.id,
      }),
    ];
    for (const { accessToken } of cases) {
      const res = await me(accessToken).expect(401);
      expect(problem(res).status).toBe(401);
    }
  });
});
