import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { TenancyService } from '../src/modules/tenancy/tenancy.service.js';
import { createApp, problem } from './e2e-app.js';

const tenancyStub = { listActiveWithSites: () => Promise.resolve([]) };

describe('Endpoints públicos (e2e, sin base)', () => {
  describe('GET /public/consent', () => {
    let app: INestApplication<App>;
    beforeAll(async () => {
      app = await createApp({
        overrides: [{ provide: TenancyService, useValue: tenancyStub }],
      });
    });
    afterAll(() => app.close());

    it('R38: responde 200 con la versión de PATIENT_CONSENT_VERSION y el texto del archivo configurado', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/public/consent')
        .expect(200);
      expect(Object.keys(res.body as object).sort()).toEqual([
        'text',
        'version',
      ]);
      expect(res.body).toMatchObject({ version: '2026-10-v1' });
      expect((res.body as { text: string }).text).toContain(
        'Texto pendiente de redacción por el equipo. No válido legalmente.',
      );
    });
  });

  describe('Límite de peticiones (valores por defecto: 10 / 60 s)', () => {
    let app: INestApplication<App>;
    beforeEach(async () => {
      app = await createApp({
        overrides: [{ provide: TenancyService, useValue: tenancyStub }],
      });
    });
    afterEach(() => app.close());

    const limited: [string, string, number][] = [
      ['post', '/api/v1/auth/login', 400],
      ['post', '/api/v1/auth/patient/login', 400],
      ['post', '/api/v1/auth/patient/accounts', 400],
      ['get', '/api/v1/public/tenants', 200],
      ['get', '/api/v1/public/consent', 200],
    ];
    const call = (method: string, path: string) =>
      method === 'get'
        ? request(app.getHttpServer()).get(path)
        : request(app.getHttpServer()).post(path).send({});

    it.each(limited)(
      'R39: %s %s admite 10 peticiones por IP y la 11ª recibe 429 problem+json con Retry-After',
      async (method, path, normal) => {
        for (let i = 0; i < 10; i++) {
          expect((await call(method, path)).status).toBe(normal);
        }
        const res = await call(method, path);
        expect(res.status).toBe(429);
        expect(problem(res)).toMatchObject({
          status: 429,
          title: 'Too Many Requests',
        });
        const retryAfter = Number(res.headers['retry-after']);
        expect(retryAfter).toBeGreaterThan(0);
        expect(retryAfter).toBeLessThanOrEqual(60);
      },
    );

    it('R39: el límite es por endpoint (otro endpoint limitado sigue respondiendo) y GET /health queda fuera', async () => {
      for (let i = 0; i < 11; i++) await call('get', '/api/v1/public/consent');
      expect((await call('get', '/api/v1/public/consent')).status).toBe(429);
      expect((await call('get', '/api/v1/public/tenants')).status).toBe(200);
      expect((await call('post', '/api/v1/auth/login')).status).toBe(400);
      for (let i = 0; i < 30; i++) {
        expect((await call('get', '/api/v1/health')).status).toBe(200);
      }
    });
  });
});
