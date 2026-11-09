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
const SID = '66666666-6666-4666-8666-666666666666';
type Method = 'get' | 'post';

/** Matriz de roles (R22): NURSE decide; NURSE y PHYSICIAN leen. */
const MATRIX: [Method, StaffRole[]][] = [
  ['post', ['NURSE']],
  ['get', ['NURSE', 'PHYSICIAN']],
];
const PATH = `/encounters/${ID}/triage-decision`;
const BODY = { action: 'VALIDATE', suggestionId: SID };

describe('F-05: autorización y forma del cuerpo de la decisión (e2e, sin base)', () => {
  let app: INestApplication<App>;
  const staff = new Map<StaffRole, string>();
  let patient: string;
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

  it('R22: RECEPTION, ADMIN (y PHYSICIAN en el POST) y el paciente reciben 403; sin token o con token inválido, 401', async () => {
    for (const [method, allowed] of MATRIX) {
      const body = method === 'post' ? BODY : undefined;
      for (const role of STAFF_ROLES.filter((r) => !allowed.includes(r))) {
        const res = await call(method, PATH, staff.get(role), body);
        expect([method, role, res.status]).toEqual([method, role, 403]);
        expect(problem(res).status).toBe(403);
      }
      const p = await call(method, PATH, patient, body);
      expect([method, 'PATIENT', p.status]).toEqual([method, 'PATIENT', 403]);
      expect(problem(p).status).toBe(403);
      for (const token of [undefined, 'no-es-un-jwt']) {
        const res = await call(method, PATH, token, body);
        expect([method, res.status]).toEqual([method, 401]);
        expect(problem(res).status).toBe(401);
      }
    }
    expect(groq.requests.length + openRouter.requests.length).toBe(0);
  });

  it('R4: un cuerpo mal formado responde 400 problem+json con el campo en errors[], antes de tocar la base', async () => {
    const cases: [object, string][] = [
      [{}, 'action'],
      [{ action: 'APROBAR', suggestionId: SID }, 'action'],
      [{ action: 'VALIDATE' }, 'suggestionId'],
      [{ action: 'VALIDATE', suggestionId: 'zz-eco' }, 'suggestionId'],
      [{ action: 'VALIDATE', suggestionId: SID, level: 2 }, 'level'],
      [{ action: 'VALIDATE', suggestionId: SID, reason: 'zz-eco' }, 'reason'],
      [{ action: 'MANUAL', level: 2, suggestionId: SID }, 'suggestionId'],
      [{ action: 'MANUAL', level: 2, reason: 'zz-eco' }, 'reason'],
      [{ action: 'MANUAL', level: 2.5 }, 'level'],
      [{ action: 'MANUAL', level: '2' }, 'level'],
      [{ action: 'MANUAL' }, 'level'],
      [{ action: 'MANUAL', level: 2, tenantId: TENANT }, 'tenantId'],
      [{ action: 'MANUAL', level: 2, id: ID }, 'id'],
      [{ action: 'MANUAL', level: 2, finalLevel: 2 }, 'finalLevel'],
    ];
    for (const [body, field] of cases) {
      const res = await call('post', PATH, staff.get('NURSE'), body);
      expect([body, res.status]).toEqual([body, 400]);
      const p = problem(res);
      expect(p.errors?.map((e) => e.field)).toContain(field);
      expect(JSON.stringify([p.detail, p.errors])).not.toContain('zz-eco');
    }
  });

  it('R20: la hora o el responsable enviados por el cliente responden 400', async () => {
    for (const field of ['decidedAt', 'decidedBy', 'triagedAt', 'triagedBy']) {
      const res = await call('post', PATH, staff.get('NURSE'), {
        ...BODY,
        [field]: '2026-11-09T17:00:00Z',
      });
      expect([field, res.status]).toEqual([field, 400]);
      expect(problem(res).errors?.map((e) => e.field)).toEqual([field]);
    }
  });

  it('R5: level fuera de rango o motivo inválido responden 422 sin tocar la base (antes del 404 de una atención que no existe)', async () => {
    for (const [body, field] of [
      [{ action: 'MANUAL', level: 9 }, 'level'],
      [
        { action: 'CORRECT', suggestionId: SID, level: 2, reason: ' ' },
        'reason',
      ],
    ] as [object, string][]) {
      const res = await call('post', PATH, staff.get('NURSE'), body);
      expect(res.status).toBe(422);
      expect(problem(res).errors?.map((e) => e.field)).toEqual([field]);
    }
  });

  it('R14: un id mal formado responde 404 en el POST y en el GET', async () => {
    for (const [method, allowed] of MATRIX) {
      const res = await call(
        method,
        '/encounters/zz-mal-formado/triage-decision',
        staff.get(allowed[0]),
        method === 'post' ? BODY : undefined,
      );
      expect([method, res.status]).toEqual([method, 404]);
      expect(problem(res).detail).toBe('El recurso no existe.');
    }
  });
});
