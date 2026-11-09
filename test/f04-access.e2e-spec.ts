import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { STAFF_ROLES, type StaffRole } from '../src/common/auth/principal.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { createApp, problem } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';

const TENANT = '22222222-2222-4222-8222-222222222222';
const ID = '55555555-5555-4555-8555-555555555555';
type Method = 'get' | 'post';

/** Matriz de roles: NURSE pide la sugerencia; NURSE y PHYSICIAN la leen. */
const MATRIX: [Method, StaffRole[]][] = [
  ['post', ['NURSE']],
  ['get', ['NURSE', 'PHYSICIAN']],
];
const PATH = `/encounters/${ID}/triage-suggestions`;

describe('F-04: autorización y cuerpo de la sugerencia (e2e, sin base)', () => {
  let app: INestApplication<App>;
  const staff = new Map<StaffRole, string>();
  let patient: string;
  // LlmClient falso: si una petición rechazada llegara al advisor, se vería aquí.
  const groq = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  const openRouter = new FakeLlmClient('OPENROUTER', 'x', { fail: 'NETWORK' });

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: GROQ_CLIENT, useValue: groq },
        { provide: OPENROUTER_CLIENT, useValue: openRouter },
      ],
    });
    const tokens = app.get(TokenService);
    for (const role of STAFF_ROLES) {
      staff.set(
        role,
        (
          await tokens.issueStaff({
            id: '11111111-1111-4111-8111-111111111111',
            tenantId: TENANT,
            role,
          })
        ).accessToken,
      );
    }
    patient = (
      await tokens.issuePatient({
        id: '33333333-3333-4333-8333-333333333333',
        tenantId: TENANT,
        patientId: '44444444-4444-4444-8444-444444444444',
      })
    ).accessToken;
  });
  afterAll(() => app.close());

  const call = (
    method: Method,
    path: string,
    token?: string,
    body?: object,
  ) => {
    let req = request(app.getHttpServer())[method](`/api/v1${path}`);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    return body ? req.send(body) : req;
  };

  it('R28: RECEPTION, ADMIN (y PHYSICIAN en el POST) y el paciente reciben 403; sin token o con token inválido, 401; sin llamar al LLM', async () => {
    for (const [method, allowed] of MATRIX) {
      for (const role of STAFF_ROLES.filter((r) => !allowed.includes(r))) {
        const res = await call(method, PATH, staff.get(role));
        expect([method, role, res.status]).toEqual([method, role, 403]);
        expect(problem(res).status).toBe(403);
      }
      const p = await call(method, PATH, patient);
      expect([method, 'PATIENT', p.status]).toEqual([method, 'PATIENT', 403]);
      for (const token of [undefined, 'no-es-un-jwt']) {
        const res = await call(method, PATH, token);
        expect([method, res.status]).toEqual([method, 401]);
        expect(problem(res).status).toBe(401);
      }
    }
    expect(groq.requests.length + openRouter.requests.length).toBe(0);
  });

  it('R5: un cuerpo con cualquier campo responde 400 problem+json antes de tocar la base o el LLM', async () => {
    for (const field of [
      'level',
      'provider',
      'model',
      'createdAt',
      'inputSnapshot',
      'zzNoDeclarado',
    ]) {
      const res = await call('post', PATH, staff.get('NURSE'), {
        [field]: 'zz-eco',
      });
      expect([field, res.status]).toEqual([field, 400]);
      const p = problem(res);
      expect(p.errors?.map((e) => e.field)).toContain(field);
      expect(JSON.stringify([p.detail, p.errors])).not.toContain('zz-eco');
    }
    expect(groq.requests.length + openRouter.requests.length).toBe(0);
  });

  it('R4: un id mal formado responde 404 en el POST y en el GET', async () => {
    for (const [method, allowed] of MATRIX) {
      const res = await call(
        method,
        '/encounters/zz-mal-formado/triage-suggestions',
        staff.get(allowed[0]),
      );
      expect([method, res.status]).toEqual([method, 404]);
      expect(problem(res).detail).toBe('El recurso no existe.');
    }
  });
});
