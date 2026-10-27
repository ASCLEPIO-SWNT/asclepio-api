import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { createApp, problem } from './e2e-app.js';

// Sin base: el cuerpo vacío no supera la validación (400) y el servicio nunca se llama; el límite cuenta igual.
describe('F-02: límite de peticiones de los endpoints de escritura del paciente (e2e, sin base)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeEach(async () => {
    app = await createApp();
    token = (
      await app.get(TokenService).issuePatient({
        id: '33333333-3333-4333-8333-333333333333',
        tenantId: '22222222-2222-4222-8222-222222222222',
        patientId: '44444444-4444-4444-8444-444444444444',
      })
    ).accessToken;
  });
  afterEach(() => app.close());

  it.each([
    ['post', '/api/v1/patient/pre-registrations'],
    ['patch', '/api/v1/patient/profile'],
  ] as const)(
    'R14: %s %s admite 10 peticiones por IP en 60 s y la 11ª recibe 429 problem+json con Retry-After, sin procesarla',
    async (method, path) => {
      const call = () =>
        request(app.getHttpServer())
          [method](path)
          .set('Authorization', `Bearer ${token}`)
          .send({});
      for (let i = 0; i < 10; i++) expect((await call()).status).toBe(400);
      const res = await call().expect(429);
      expect(problem(res).status).toBe(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    },
  );

  it('R14: los endpoints de lectura del paciente no tienen límite', async () => {
    // GET sin base fallaría al consultar: se comprueba en el contrato que no documentan 429.
    const { buildOpenApiDocument } = await import('../src/app.setup.js');
    const doc = buildOpenApiDocument(app);
    expect(
      doc.paths['/api/v1/patient/profile'].get?.responses['429'],
    ).toBeUndefined();
    expect(
      doc.paths['/api/v1/patient/profile'].patch?.responses['429'],
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/patient/pre-registrations'].post?.responses['429'],
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/patient/pre-registrations'].get?.responses['429'],
    ).toBeUndefined();
  });
});
