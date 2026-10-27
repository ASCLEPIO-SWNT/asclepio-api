import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { STAFF_ROLES, type StaffRole } from '../src/common/auth/principal.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { createApp, problem } from './e2e-app.js';

const TENANT = '22222222-2222-4222-8222-222222222222';
const ID = '55555555-5555-4555-8555-555555555555';
type Method = 'get' | 'post' | 'patch';

/** Matriz de roles de design.md (D24). null = solo token de paciente. */
const MATRIX: [Method, string, StaffRole[] | null][] = [
  ['get', '/patient/profile', null],
  ['patch', '/patient/profile', null],
  ['post', '/patient/pre-registrations', null],
  ['get', '/patient/pre-registrations', null],
  ['get', `/patient/pre-registrations/${ID}`, null],
  ['get', '/patients?documentType=CC&documentNumber=1', ['RECEPTION']],
  ['post', '/patients', ['RECEPTION']],
  ['get', '/pre-registrations', ['RECEPTION']],
  ['post', `/pre-registrations/${ID}/confirm`, ['RECEPTION']],
  ['post', `/pre-registrations/${ID}/reject`, ['RECEPTION']],
  ['post', '/encounters', ['RECEPTION']],
  ['get', '/encounters', ['RECEPTION', 'NURSE', 'PHYSICIAN', 'ADMIN']],
  ['get', `/encounters/${ID}`, ['RECEPTION', 'NURSE', 'PHYSICIAN', 'ADMIN']],
  ['post', `/encounters/${ID}/cancel`, ['RECEPTION', 'NURSE']],
];

describe('F-02: autorización, campos prohibidos y horas del cliente (e2e, sin base)', () => {
  let app: INestApplication<App>;
  const staff = new Map<StaffRole, string>();
  let patient: string;

  // Una app por prueba: el límite de R14 (10 / 60 s por IP) no debe acumularse entre pruebas.
  beforeEach(async () => {
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
  afterEach(() => app.close());

  const call = (
    method: Method,
    path: string,
    token?: string,
    body: object = {},
  ) => {
    const req = request(app.getHttpServer())[method](`/api/v1${path}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return method === 'get' ? req : req.send(body);
  };

  it('R45: los 14 endpoints de F-02 responden 401 problem+json sin token válido', async () => {
    expect(MATRIX).toHaveLength(14);
    for (const [method, path] of MATRIX) {
      const res = await call(method, path);
      expect([method, path, res.status]).toEqual([method, path, 401]);
      expect(problem(res).status).toBe(401);
      expect((await call(method, path, 'no-es-un-jwt')).status).toBe(401);
    }
  });

  it('R45: un rol de personal fuera de la matriz, un paciente en rutas de personal y el personal en rutas /patient/… responden 403 problem+json', async () => {
    for (const [method, path, roles] of MATRIX) {
      const denied = STAFF_ROLES.filter((r) => !(roles ?? []).includes(r));
      for (const role of denied) {
        const res = await call(method, path, staff.get(role));
        expect([method, path, role, res.status]).toEqual([
          method,
          path,
          role,
          403,
        ]);
        expect(problem(res).status).toBe(403);
      }
      if (roles) {
        const res = await call(method, path, patient);
        expect([method, path, 'PATIENT', res.status]).toEqual([
          method,
          path,
          'PATIENT',
          403,
        ]);
      }
    }
  });

  // Cuerpos válidos de cada endpoint de escritura (sin base, la petición nunca llega al service si es 400).
  const writes: [Method, string, () => string, object][] = [
    ['patch', '/patient/profile', () => patient, { fullName: 'DEV-test' }],
    [
      'post',
      '/patient/pre-registrations',
      () => patient,
      { siteId: ID, chiefComplaintText: 'DEV-test', complaintSource: 'TYPED' },
    ],
    [
      'post',
      '/patients',
      () => staff.get('RECEPTION')!,
      { sex: 'M', estimatedAgeYears: 30 },
    ],
    [
      'post',
      `/pre-registrations/${ID}/confirm`,
      () => staff.get('RECEPTION')!,
      { identityVerified: true },
    ],
    [
      'post',
      `/pre-registrations/${ID}/reject`,
      () => staff.get('RECEPTION')!,
      { reason: 'DEV-test' },
    ],
    [
      'post',
      '/encounters',
      () => staff.get('RECEPTION')!,
      {
        patientId: ID,
        siteId: ID,
        chiefComplaintText: 'DEV-test',
        complaintSource: 'TYPED',
      },
    ],
    [
      'post',
      `/encounters/${ID}/cancel`,
      () => staff.get('NURSE')!,
      { reason: 'DEV-test' },
    ],
  ];

  it('R46: tenantId, patientId (en los del paciente), status, origin, registeredBy, resolvedBy, identityVerifiedAt o un campo no declarado en el cuerpo responden 400 problem+json', async () => {
    const forbidden = [
      'tenantId',
      'status',
      'origin',
      'registeredBy',
      'resolvedBy',
      'identityVerifiedAt',
      'zzNoDeclarado',
    ];
    for (const [method, path, token, body] of writes) {
      const fields = path.startsWith('/patient/')
        ? [...forbidden, 'patientId']
        : forbidden;
      for (const field of fields) {
        const res = await call(method, path, token(), { ...body, [field]: ID });
        expect([path, field, res.status]).toEqual([path, field, 400]);
        const p = problem(res);
        expect(p.errors?.map((e) => e.field)).toContain(field);
        expect(JSON.stringify([p.detail, p.errors])).not.toContain(
          ID.slice(0, 8),
        );
      }
    }
  });

  it('R47: cualquier hora enviada por el cliente (arrivalAt, preRegisteredAt, expiresAt, resolvedAt, occurredAt, createdAt, updatedAt) responde 400', async () => {
    const times = [
      'arrivalAt',
      'preRegisteredAt',
      'expiresAt',
      'resolvedAt',
      'occurredAt',
      'createdAt',
      'updatedAt',
    ];
    for (const [method, path, token, body] of writes) {
      for (const field of times) {
        const res = await call(method, path, token(), {
          ...body,
          [field]: '2020-01-01T00:00:00Z',
        });
        expect([path, field, res.status]).toEqual([path, field, 400]);
        expect(problem(res).errors?.map((e) => e.field)).toContain(field);
      }
    }
  });
});
