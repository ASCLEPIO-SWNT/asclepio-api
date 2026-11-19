import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { STAFF_ROLES } from '../src/common/auth/principal.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { createApp, problem } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';

const TENANT = '22222222-2222-4222-8222-222222222222';
const PATHS = ['/patient/queue-position', '/patient/queue-position/stream'];

/** F-10-api (T6): autorización de los dos endpoints del paciente, antes de tocar la base (R12). */
describe('F-10: autorización de la posición del paciente (e2e, sin base)', () => {
  let app: INestApplication<App>;
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: GROQ_CLIENT, useValue: fake },
        { provide: OPENROUTER_CLIENT, useValue: fake },
      ],
    });
  });
  afterAll(() => app.close());

  const get = (path: string, token?: string) => {
    const req = request(app.getHttpServer()).get(`/api/v1${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('R12: cualquier token de personal → 403; sin token o con uno inválido → 401; siempre problem+json y nunca text/event-stream', async () => {
    const tokens = app.get(TokenService);
    for (const path of PATHS) {
      for (const role of STAFF_ROLES) {
        const { accessToken } = await tokens.issueStaff({
          id: '11111111-1111-4111-8111-111111111111',
          tenantId: TENANT,
          role,
        });
        const res = await get(path, accessToken);
        expect([path, role, res.status]).toEqual([path, role, 403]);
        expect(problem(res).status).toBe(403);
      }
      for (const token of [undefined, 'no-es-un-jwt']) {
        const res = await get(path, token);
        expect([path, String(token), res.status]).toEqual([
          path,
          String(token),
          401,
        ]);
        expect(problem(res).status).toBe(401);
      }
    }
  });
});
