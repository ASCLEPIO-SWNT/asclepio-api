import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { STAFF_ROLES, type StaffRole } from '../src/common/auth/principal.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { createApp, problem } from './e2e-app.js';

const TENANT = '22222222-2222-4222-8222-222222222222';
const ID = '55555555-5555-4555-8555-555555555555';
type Method = 'get' | 'post';

const VITALS = {
  respiratoryRate: 22,
  oxygenSaturation: 94,
  supplementalOxygen: false,
  systolicBp: 150,
  heartRate: 112,
  consciousness: 'A',
  temperatureC: 37.4,
};
const FINDINGS = {
  items: [{ kind: 'SYMPTOM', description: 'DEV-test dolor' }],
};

/** Matriz de roles de D11: NURSE captura; NURSE y PHYSICIAN leen. */
const MATRIX: [Method, string, StaffRole[], object | undefined][] = [
  ['post', `/encounters/${ID}/vital-signs`, ['NURSE'], VITALS],
  ['post', `/encounters/${ID}/symptom-findings`, ['NURSE'], FINDINGS],
  [
    'get',
    `/encounters/${ID}/clinical-capture`,
    ['NURSE', 'PHYSICIAN'],
    undefined,
  ],
];

describe('F-03: autorización, cuerpos prohibidos y errores (e2e, sin base)', () => {
  let app: INestApplication<App>;
  const staff = new Map<StaffRole, string>();
  let patient: string;

  beforeAll(async () => {
    app = await createApp();
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

  it('R21: los roles no permitidos (RECEPTION, ADMIN y PHYSICIAN en los POST) y el paciente reciben 403; sin token o con token inválido, 401', async () => {
    for (const [method, path, allowed, body] of MATRIX) {
      for (const role of STAFF_ROLES.filter((r) => !allowed.includes(r))) {
        const res = await call(method, path, staff.get(role), body);
        expect([path, role, res.status]).toEqual([path, role, 403]);
        expect(problem(res).status).toBe(403);
      }
      const p = await call(method, path, patient, body);
      expect([path, 'PATIENT', p.status]).toEqual([path, 'PATIENT', 403]);
      for (const token of [undefined, 'no-es-un-jwt']) {
        const res = await call(method, path, token, body);
        expect([path, res.status]).toEqual([path, 401]);
        expect(problem(res).status).toBe(401);
      }
    }
  });

  it('R13: recordedAt, recordedBy, tenantId, encounterId, id, createdAt o un campo no declarado en el cuerpo de una captura → 400 problem+json', async () => {
    const nurse = staff.get('NURSE')!;
    for (const [method, path, , body] of MATRIX) {
      if (method !== 'post') continue;
      for (const field of [
        'recordedAt',
        'recordedBy',
        'tenantId',
        'encounterId',
        'id',
        'createdAt',
        'zzNoDeclarado',
      ]) {
        const res = await call(method, path, nurse, { ...body, [field]: ID });
        expect([path, field, res.status]).toEqual([path, field, 400]);
        expect(problem(res).errors?.map((e) => e.field)).toContain(field);
      }
    }
  });

  it('R3: un signo con forma inválida responde 400 antes de cualquier regla de negocio', async () => {
    const res = await call(
      'post',
      `/encounters/${ID}/vital-signs`,
      staff.get('NURSE'),
      { ...VITALS, temperatureC: 37.45, consciousness: 'X' },
    );
    expect(res.status).toBe(400);
    expect(
      problem(res)
        .errors?.map((e) => e.field)
        .sort(),
    ).toEqual(['consciousness', 'temperatureC']);
  });

  it('R4: faltas de obligatorios responden 422 (antes de consultar la atención) con un error por campo', async () => {
    const res = await call(
      'post',
      `/encounters/${ID}/vital-signs`,
      staff.get('NURSE'),
      { heartRate: 80 },
    );
    expect(res.status).toBe(422);
    expect(problem(res).errors).toHaveLength(6);
  });

  it('R12: un id mal formado responde 404 en los tres endpoints', async () => {
    for (const [method, path, allowed, body] of MATRIX) {
      const res = await call(
        method,
        path.replace(ID, 'zz-mal-formado'),
        staff.get(allowed[0]),
        body,
      );
      expect([path, res.status]).toEqual([path, 404]);
      expect(problem(res).detail).toBe('El recurso no existe.');
    }
  });

  it('R22: los errores 400 y 422 de F-03 son problem+json y no repiten los valores enviados', async () => {
    const nurse = staff.get('NURSE')!;
    const cases: [string, object, number][] = [
      [
        `/encounters/${ID}/vital-signs`,
        { ...VITALS, heartRate: 'zz-eco-1', consciousness: 'zz-eco-2' },
        400,
      ],
      [`/encounters/${ID}/vital-signs`, { ...VITALS, heartRate: 9876 }, 422],
      [
        `/encounters/${ID}/vital-signs`,
        { ...VITALS, systolicBp: 61, diastolicBp: 187 },
        422,
      ],
      [
        `/encounters/${ID}/symptom-findings`,
        {
          items: [
            { kind: 'zz-eco-3', description: `zz-eco-4 ${'x'.repeat(600)}` },
          ],
        },
        400,
      ],
      [`/encounters/${ID}/symptom-findings`, { zzEco5: 'zz-eco-6' }, 400],
      [`/encounters/${ID}/vital-signs`, '{"heartRate": zz-eco-7' as never, 400],
    ];
    for (const [path, body, status] of cases) {
      const req = call('post', path, nurse);
      const res = await (typeof body === 'string'
        ? req.set('Content-Type', 'application/json').send(body)
        : req.send(body));
      expect([path, res.status]).toEqual([path, status]);
      const p = problem(res);
      const text = JSON.stringify([p.detail, p.errors]);
      for (const echo of ['zz-eco', '9876', '187', '61']) {
        expect([path, echo, text.includes(echo)]).toEqual([path, echo, false]);
      }
    }
  });
});
