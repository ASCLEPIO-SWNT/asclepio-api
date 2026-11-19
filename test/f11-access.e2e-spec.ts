import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { STAFF_ROLES } from '../src/common/auth/principal.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { PatientsService } from '../src/modules/patients/patients.service.js';
import { createApp, problem } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';

const TENANT = '22222222-2222-4222-8222-222222222222';
const PATH = '/api/v1/patient/symptom-interview/next-question';
/** Cuerpo que activa las reglas (RED_FLAG): no llama al LLM ni a PatientsService. */
const ALARM = { chiefComplaintText: 'DEV me desmayé', turns: [] };
const ECHO = 'DEV-ECO-c41d';

/** F-11-api (T9): límite por paciente (R16) y matriz de errores en problem+json (R17), sin base. */
describe('F-11: next-question, límite y errores (e2e, sin base)', () => {
  let app: INestApplication<App>;
  const groq = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  const openRouter = new FakeLlmClient('OPENROUTER', 'x', { fail: 'NETWORK' });
  const patients = {
    findById: () =>
      Promise.resolve({ fullName: 'DEV Persona', documentNumber: '123' }),
  };

  beforeEach(async () => {
    app = await createApp({
      overrides: [
        { provide: GROQ_CLIENT, useValue: groq },
        { provide: OPENROUTER_CLIENT, useValue: openRouter },
        { provide: PatientsService, useValue: patients },
      ],
    });
    groq.script();
    openRouter.script();
  });
  afterEach(() => app.close());

  const patientToken = async (patientId = randomUUID()) =>
    (
      await app.get(TokenService).issuePatient({
        id: randomUUID(),
        tenantId: TENANT,
        patientId,
      })
    ).accessToken;
  const post = (token: string | null, body: object) => {
    const req = request(app.getHttpServer()).post(PATH);
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(
      body,
    );
  };
  const llmCalls = () => groq.requests.length + openRouter.requests.length;

  it('R16: un paciente puede hacer 30 peticiones en 10 min; la 31ª recibe 429 problem+json con Retry-After, y otro paciente no está limitado', async () => {
    const me = await patientToken();
    for (let i = 0; i < 30; i++) {
      expect((await post(me, ALARM)).status).toBe(200);
    }
    const res = await post(me, ALARM).expect(429);
    expect(problem(res).status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(600);
    // El límite es por paciente (patientId del token), no por IP: misma IP, otro paciente.
    expect((await post(await patientToken(), ALARM)).status).toBe(200);
  });

  it('R16: el límite cuenta por paciente aunque cambie la cuenta o el token', async () => {
    const patientId = randomUUID();
    for (let i = 0; i < 30; i++) {
      expect((await post(await patientToken(patientId), ALARM)).status).toBe(
        200,
      );
    }
    expect((await post(await patientToken(patientId), ALARM)).status).toBe(429);
  });

  it('R17: un token de personal (cualquier rol) recibe 403 problem+json sin llamar al LLM', async () => {
    const tokens = app.get(TokenService);
    for (const role of STAFF_ROLES) {
      const { accessToken } = await tokens.issueStaff({
        id: randomUUID(),
        tenantId: TENANT,
        role,
      });
      const res = await post(accessToken, {
        chiefComplaintText: 'DEV dolor de cabeza',
        turns: [],
      });
      expect([role, res.status]).toEqual([role, 403]);
      expect(problem(res).status).toBe(403);
    }
    expect(llmCalls()).toBe(0);
  });

  it('R17: sin token o con un token inválido → 401 problem+json', async () => {
    for (const token of [null, 'no-es-un-jwt']) {
      const res = await post(token, ALARM);
      expect(res.status).toBe(401);
      expect(problem(res).status).toBe(401);
    }
  });

  it.each([
    ['sin chiefComplaintText', { turns: [] }],
    ['chiefComplaintText vacío', { chiefComplaintText: '  ', turns: [] }],
    [
      'chiefComplaintText de más de 2000',
      { chiefComplaintText: `${ECHO}${'x'.repeat(2000)}`, turns: [] },
    ],
    ['sin turns', { chiefComplaintText: 'DEV dolor' }],
    [
      'más de 5 turnos',
      {
        chiefComplaintText: 'DEV dolor',
        turns: Array.from({ length: 6 }, () => ({
          dimension: 'ONSET',
          question: '¿A?',
          answer: ECHO,
        })),
      },
    ],
    [
      'dimension desconocida',
      {
        chiefComplaintText: 'DEV dolor',
        turns: [{ dimension: ECHO, question: '¿A?', answer: null }],
      },
    ],
    [
      'answer de más de 500',
      {
        chiefComplaintText: 'DEV dolor',
        turns: [
          {
            dimension: 'ONSET',
            question: '¿A?',
            answer: `${ECHO}${'a'.repeat(500)}`,
          },
        ],
      },
    ],
    ['campo extra', { chiefComplaintText: 'DEV dolor', turns: [], x: ECHO }],
  ])(
    'R17: cuerpo inválido (%s) → 400 problem+json sin repetir el valor y sin llamar al LLM',
    async (_label, body) => {
      const res = await post(await patientToken(), body);
      expect(res.status).toBe(400);
      expect(problem(res).status).toBe(400);
      expect(res.text).not.toContain(ECHO);
      expect(llmCalls()).toBe(0);
    },
  );

  it('R17: si fallan ambos proveedores del LLM → 503 problem+json, sin el contenido de la petición', async () => {
    groq.script({ fail: 'HTTP', http: 500 });
    openRouter.script({ fail: 'NETWORK' });
    const res = await post(await patientToken(), {
      chiefComplaintText: `${ECHO} dolor de cabeza`,
      turns: [],
    });
    expect(res.status).toBe(503);
    expect(problem(res).status).toBe(503);
    expect(res.text).not.toContain(ECHO);
    expect(llmCalls()).toBe(2);
  });
});
