import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { createApp, problem } from './e2e-app.js';
import { FailingAuditService } from './int/failing-audit.js';
import { Fixtures, PASSWORD, randomDoc } from './int/fixtures.js';

// 15:00 UTC = 10:00 en Bogotá: "hoy" es 2026-10-26 en ambas zonas.
const NOW = new Date('2026-10-26T15:00:00.000Z');

describe('POST /api/v1/auth/patient/accounts (integración)', () => {
  let app: INestApplication<App>;
  let fx: Fixtures;
  let tenantId: string;
  const clock = new FixedClock(NOW);

  beforeAll(async () => {
    app = await createApp({ overrides: [{ provide: Clock, useValue: clock }] });
    fx = new Fixtures(app);
    tenantId = (await fx.tenant('accounts')).id;
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  const body = (over: Record<string, unknown> = {}) => ({
    tenantId,
    documentType: 'CC',
    documentNumber: randomDoc(),
    fullName: 'DEV-test Paciente Nuevo',
    birthDate: '1990-05-17',
    sex: 'M',
    password: PASSWORD,
    consentAccepted: true,
    consentVersion: '2026-10-v1',
    ...over,
  });
  const post = (b: object) =>
    request(app.getHttpServer()).post('/api/v1/auth/patient/accounts').send(b);
  const rowsFor = async (documentNumber: unknown) => ({
    patients: await fx.prisma.patient.count({
      where: { documentNumber: String(documentNumber) },
    }),
    accounts: await fx.prisma.patientAccount.count({
      where: { patient: { documentNumber: String(documentNumber) } },
    }),
  });

  it('R20: crea en una transacción el paciente y su cuenta, con consent_at del servidor, la versión aceptada e identity_verified = false, y responde 201 sin token', async () => {
    const b = body();
    const res = await post(b).expect(201);
    expect(Object.keys(res.body as object).sort()).toEqual(['id', 'patientId']);
    const { id, patientId } = res.body as { id: string; patientId: string };
    const account = await fx.prisma.patientAccount.findUniqueOrThrow({
      where: { id },
      include: { patient: true },
    });
    expect(account).toMatchObject({
      tenantId,
      patientId,
      consentAt: NOW,
      consentVersion: '2026-10-v1',
      identityVerified: false,
      active: true,
    });
    expect(account.patient).toMatchObject({
      tenantId,
      documentType: 'CC',
      documentNumber: b.documentNumber,
      fullName: 'DEV-test Paciente Nuevo',
      birthDate: new Date('1990-05-17T00:00:00Z'),
      sex: 'M',
    });
  });

  it.each([
    ['falta', { consentAccepted: undefined }],
    ['es false', { consentAccepted: false }],
    ['es el texto "true"', { consentAccepted: 'true' }],
  ])(
    'R21: si consentAccepted %s responde 422 sin crear filas',
    async (_l, over) => {
      const b = body(over);
      const res = await post(b).expect(422);
      expect(problem(res).status).toBe(422);
      expect(await rowsFor(b.documentNumber)).toEqual({
        patients: 0,
        accounts: 0,
      });
    },
  );

  it.each([
    ['falta', { consentVersion: undefined }],
    ['no es la vigente', { consentVersion: '2025-01-v0' }],
  ])(
    'R22: si consentVersion %s responde 422 sin crear filas',
    async (_l, over) => {
      const b = body(over);
      const res = await post(b).expect(422);
      expect(problem(res).detail).not.toContain('2025-01-v0');
      expect(await rowsFor(b.documentNumber)).toEqual({
        patients: 0,
        accounts: 0,
      });
    },
  );

  it.each([
    ['menos de 10', 'a'.repeat(9)],
    ['más de 128', 'a'.repeat(129)],
  ])(
    'R23: una contraseña con %s caracteres responde 400 con errors[].field = password',
    async (_l, password) => {
      const b = body({ password });
      const res = await post(b).expect(400);
      const p = problem(res);
      expect(p.errors?.map((e) => e.field)).toContain('password');
      expect(res.text).not.toContain(password);
      expect(await rowsFor(b.documentNumber)).toEqual({
        patients: 0,
        accounts: 0,
      });
    },
  );

  it('R23: 10 y 128 caracteres son válidos', async () => {
    await post(body({ password: 'a'.repeat(10) })).expect(201);
    await post(body({ password: 'a'.repeat(128) })).expect(201);
  });

  it.each([
    ['cumple 18 mañana', '2008-10-27'],
    ['fecha futura', '2027-01-01'],
  ])(
    'R24: menor de edad en Bogotá (%s) responde 422 sin crear filas',
    async (_l, birthDate) => {
      const b = body({ birthDate });
      const res = await post(b).expect(422);
      expect(problem(res).detail).not.toContain(birthDate);
      expect(await rowsFor(b.documentNumber)).toEqual({
        patients: 0,
        accounts: 0,
      });
    },
  );

  it('R24: quien cumple 18 hoy en Bogotá sí puede crear la cuenta, aunque en UTC ya sea mañana', async () => {
    clock.set(new Date('2026-10-27T03:00:00Z')); // 22:00 del 26 en Bogotá.
    await post(body({ birthDate: '2008-10-27' })).expect(422);
    await post(body({ birthDate: '2008-10-26' })).expect(201);
    clock.set(NOW);
  });

  it('R25: si el documento ya tiene cuenta en la IPS responde 409 sin crear ni modificar filas', async () => {
    const b = body();
    const first = await post(b).expect(201);
    const before = await fx.prisma.patientAccount.findUniqueOrThrow({
      where: { id: (first.body as { id: string }).id },
      include: { patient: true },
    });
    const res = await post({
      ...b,
      fullName: 'DEV-test Otro Nombre',
      password: 'otra-clave-1234',
    }).expect(409);
    expect(problem(res).status).toBe(409);
    expect(res.text).not.toContain(b.documentNumber);
    expect(await rowsFor(b.documentNumber)).toEqual({
      patients: 1,
      accounts: 1,
    });
    const after = await fx.prisma.patientAccount.findUniqueOrThrow({
      where: { id: before.id },
      include: { patient: true },
    });
    expect(after).toEqual(before);
  });

  it('R25: el mismo documento puede tener cuenta en otra IPS', async () => {
    const other = await fx.tenant('accounts-other');
    const b = body();
    await post(b).expect(201);
    await post({ ...b, tenantId: other.id }).expect(201);
  });

  it.each([
    ['consentAt', { consentAt: '2020-01-01T00:00:00Z' }],
    ['identityVerified', { identityVerified: true }],
    ['un campo no declarado', { role: 'ADMIN' }],
  ])(
    'R26: si la petición incluye %s responde 400 sin crear filas',
    async (_l, extra) => {
      const b = body(extra);
      const res = await post(b).expect(400);
      expect(problem(res).errors?.map((e) => e.field)).toContain(
        Object.keys(extra)[0],
      );
      expect(await rowsFor(b.documentNumber)).toEqual({
        patients: 0,
        accounts: 0,
      });
    },
  );

  it('R27: la cuenta guarda solo un hash scrypt y la respuesta no lo devuelve', async () => {
    const res = await post(body()).expect(201);
    const account = await fx.prisma.patientAccount.findUniqueOrThrow({
      where: { id: (res.body as { id: string }).id },
    });
    expect(account.passwordHash).toMatch(/^scrypt\$131072\$8\$1\$/);
    expect(account.passwordHash).not.toContain(PASSWORD);
    expect(res.text).not.toContain('scrypt');
    expect(res.text).not.toContain(PASSWORD);
  });

  it('R31: inserta PATIENT_ACCOUNT_CREATED con actor PATIENT, entidad patient_account, tenant, consentVersion y linkedExistingPatient = false', async () => {
    const res = await post(body()).expect(201);
    const { id } = res.body as { id: string };
    const rows = await fx.audits({
      entityId: id,
      action: 'PATIENT_ACCOUNT_CREATED',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: 'PATIENT',
      actorId: id,
      entity: 'patient_account',
      entityId: id,
      tenantId,
      metadata: { consentVersion: '2026-10-v1', linkedExistingPatient: false },
      occurredAt: NOW,
    });
  });

  it('R32: la auditoría del alta no guarda documento, nombre, fecha de nacimiento, sexo ni contraseña', async () => {
    const b = body();
    const res = await post(b).expect(201);
    const rows = await fx.audits({ entityId: (res.body as { id: string }).id });
    expect(Object.keys(rows[0].metadata as object).sort()).toEqual([
      'consentVersion',
      'linkedExistingPatient',
    ]);
    const dump = JSON.stringify(rows, (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    for (const pii of [b.documentNumber, b.fullName, b.birthDate, PASSWORD]) {
      expect(dump).not.toContain(pii);
    }
  });

  it('R44: si existe un paciente con ese documento y sin cuenta, vincula la cuenta sin modificar sus datos', async () => {
    const existing = await fx.patient(tenantId);
    const res = await post(
      body({
        documentNumber: existing.documentNumber,
        fullName: 'DEV-test Nombre Distinto',
        birthDate: '1985-03-03',
        sex: 'X',
      }),
    ).expect(201);
    const { id, patientId } = res.body as { id: string; patientId: string };
    expect(patientId).toBe(existing.id);
    const patient = await fx.prisma.patient.findUniqueOrThrow({
      where: { id: existing.id },
    });
    expect(patient).toEqual(existing);
    const account = await fx.prisma.patientAccount.findUniqueOrThrow({
      where: { id },
    });
    expect(account).toMatchObject({
      consentAt: NOW,
      consentVersion: '2026-10-v1',
      identityVerified: false,
    });
    const rows = await fx.audits({
      entityId: id,
      action: 'PATIENT_ACCOUNT_CREATED',
    });
    expect(rows[0].metadata).toEqual({
      consentVersion: '2026-10-v1',
      linkedExistingPatient: true,
    });
  });

  it('R45: toda cuenta nace con identity_verified = false y la API no ofrece endpoint para cambiarlo', async () => {
    const res = await post(body()).expect(201);
    const account = await fx.prisma.patientAccount.findUniqueOrThrow({
      where: { id: (res.body as { id: string }).id },
    });
    expect(account.identityVerified).toBe(false);
    for (const [method, path] of [
      ['patch', '/api/v1/auth/patient/accounts'],
      ['put', '/api/v1/auth/patient/accounts'],
      ['patch', `/api/v1/auth/patient/accounts/${account.id}`],
      ['patch', '/api/v1/me'],
    ] as const) {
      const r = await request(app.getHttpServer())
        [method](path)
        .send({ identityVerified: true });
      expect(r.status).toBe(404);
    }
  });

  it.each([
    ['tenantId', { tenantId: undefined }],
    ['documentType', { documentType: undefined }],
    ['documentNumber', { documentNumber: undefined }],
    ['fullName', { fullName: undefined }],
    ['birthDate', { birthDate: undefined }],
    ['sex', { sex: undefined }],
    ['documentType', { documentType: 'TI' }],
    ['documentType', { documentType: 'RC' }],
    ['birthDate', { birthDate: '2026-02-30' }],
    ['birthDate', { birthDate: '17/05/1990' }],
    ['sex', { sex: 'Q' }],
    ['tenantId', { tenantId: 'no-es-uuid' }],
  ])(
    'R46: un %s ausente o inválido responde 400 con el campo en errors[] sin crear filas',
    async (field, over) => {
      const b = body(over);
      const res = await post(b).expect(400);
      expect(problem(res).errors?.map((e) => e.field)).toContain(field);
      expect(await rowsFor(b.documentNumber)).toEqual({
        patients: 0,
        accounts: 0,
      });
    },
  );

  it('R47: si la IPS está inactiva o no existe responde 422 sin crear filas', async () => {
    const off = await fx.tenant('accounts-off', false);
    for (const t of [off.id, '00000000-0000-4000-8000-000000000000']) {
      const b = body({ tenantId: t });
      const res = await post(b).expect(422);
      expect(problem(res).detail).not.toContain(t);
      expect(await rowsFor(b.documentNumber)).toEqual({
        patients: 0,
        accounts: 0,
      });
    }
  });

  describe('si falla la auditoría del alta', () => {
    let failing: INestApplication<App>;
    beforeAll(async () => {
      failing = await createApp({
        overrides: [{ provide: AuditService, useClass: FailingAuditService }],
      });
    });
    afterAll(() => failing.close());

    it('R33: revierte la transacción, no crea paciente ni cuenta y responde 500 problem+json', async () => {
      const b = body();
      const res = await request(failing.getHttpServer())
        .post('/api/v1/auth/patient/accounts')
        .send(b)
        .expect(500);
      expect(problem(res)).toMatchObject({
        status: 500,
        detail: 'Error interno.',
      });
      expect(await rowsFor(b.documentNumber)).toEqual({
        patients: 0,
        accounts: 0,
      });
    });
  });
});
