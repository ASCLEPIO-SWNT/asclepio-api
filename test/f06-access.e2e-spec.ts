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

/** Matriz de roles (R14): la cola la leen PHYSICIAN, NURSE y ADMIN; las transiciones, solo PHYSICIAN. */
const MATRIX: [Method, string, StaffRole[]][] = [
  ['get', '/queue', ['PHYSICIAN', 'NURSE', 'ADMIN']],
  ['post', `/encounters/${ID}/start-care`, ['PHYSICIAN']],
  ['post', `/encounters/${ID}/close`, ['PHYSICIAN']],
];

describe('F-06: autorización y forma de las peticiones (e2e, sin base)', () => {
  let app: INestApplication<App>;
  const staff = new Map<StaffRole, string>();
  let patient: string;
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: GROQ_CLIENT, useValue: fake },
        { provide: OPENROUTER_CLIENT, useValue: fake },
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

  const call = (method: Method, path: string, token?: string) => {
    const req = request(app.getHttpServer())[method](`/api/v1${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('R14: los roles no permitidos y el paciente reciben 403; sin token o con token inválido, 401 (problem+json)', async () => {
    for (const [method, path, allowed] of MATRIX) {
      for (const role of STAFF_ROLES.filter((r) => !allowed.includes(r))) {
        const res = await call(method, path, staff.get(role));
        expect([path, role, res.status]).toEqual([path, role, 403]);
        expect(problem(res).status).toBe(403);
      }
      const p = await call(method, path, patient);
      expect([path, 'PATIENT', p.status]).toEqual([path, 'PATIENT', 403]);
      expect(problem(p).status).toBe(403);
      for (const token of [undefined, 'no-es-un-jwt']) {
        const res = await call(method, path, token);
        expect([path, res.status]).toEqual([path, 401]);
        expect(problem(res).status).toBe(401);
      }
    }
    // RECEPTION en la cola; NURSE, RECEPTION y ADMIN en las transiciones (los casos que pide la spec).
    expect((await call('get', '/queue', staff.get('RECEPTION'))).status).toBe(
      403,
    );
    for (const role of ['NURSE', 'RECEPTION', 'ADMIN'] as StaffRole[]) {
      expect(
        (await call('post', `/encounters/${ID}/start-care`, staff.get(role)))
          .status,
      ).toBe(403);
    }
  });

  it('R6: siteId mal formado o un parámetro desconocido → 400 problem+json, antes de tocar la base', async () => {
    for (const query of [
      '?siteId=zz-no-uuid',
      '?siteId=',
      `?siteId=${ID}&status=TRIAGED`,
      '?serverNow=2026-01-01T00:00:00Z',
    ]) {
      const res = await call('get', `/queue${query}`, staff.get('PHYSICIAN'));
      expect([query, res.status]).toEqual([query, 400]);
      const p = problem(res);
      expect(p.errors?.length).toBeGreaterThan(0);
      expect(JSON.stringify(p)).not.toContain('zz-no-uuid');
    }
  });

  it('R12: un id mal formado → 404 y un cuerpo con campos → 400, antes de tocar la base', async () => {
    for (const action of ['start-care', 'close']) {
      const bad = await call(
        'post',
        `/encounters/zz-mal-formado/${action}`,
        staff.get('PHYSICIAN'),
      );
      expect([action, bad.status]).toEqual([action, 404]);
      expect(problem(bad).detail).toBe('El recurso no existe.');
      for (const body of [{ status: 'CLOSED' }, { closedAt: 'x' }]) {
        const res = await call(
          'post',
          `/encounters/${ID}/${action}`,
          staff.get('PHYSICIAN'),
        ).send(body);
        expect([action, body, res.status]).toEqual([action, body, 400]);
        expect(problem(res).errors?.map((e) => e.field)).toEqual(
          Object.keys(body),
        );
      }
    }
  });
});
