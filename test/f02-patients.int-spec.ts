import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import { createApp, problem } from './e2e-app.js';
import { F02Fixtures, type Staff } from './int/f02-fixtures.js';
import { randomDoc } from './int/fixtures.js';

// 15:00 UTC = 10:00 en Bogotá: "hoy" es 2026-10-26.
const NOW = new Date('2026-10-26T15:00:00.000Z');

describe('GET/POST /api/v1/patients (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let t: { id: string };
  let other: { id: string };
  let rec: Staff;

  beforeAll(async () => {
    app = await createApp({
      overrides: [{ provide: Clock, useValue: new FixedClock(NOW) }],
    });
    fx = new F02Fixtures(app);
    t = await fx.tenant('f02-patients');
    other = await fx.tenant('f02-patients-other');
    rec = await fx.staff(t.id);
  });
  afterAll(() => app.close());

  const search = (q: Record<string, string>) =>
    fx.http('get', `/patients?${new URLSearchParams(q).toString()}`, rec.token);
  const create = (body: Record<string, unknown>, token = rec.token) =>
    fx.http('post', '/patients', token).send(body);
  const documented = (over: Record<string, unknown> = {}) => ({
    documentType: 'CC',
    documentNumber: randomDoc(),
    fullName: 'DEV-test Paciente Alta',
    birthDate: '1990-05-17',
    sex: 'F',
    ...over,
  });
  const countByDoc = (documentNumber: string) =>
    fx.prisma.patient.count({ where: { tenantId: t.id, documentNumber } });

  it('R24: busca por tipo y número exactos dentro del tenant y devuelve una lista de 0 o 1 paciente con la vista de personal', async () => {
    const b = documented();
    const created = await create(b).expect(201);
    const id = (created.body as { id: string }).id;
    const found = await search({
      documentType: 'CC',
      documentNumber: b.documentNumber,
    }).expect(200);
    expect(found.body).toEqual([
      {
        id,
        documentType: 'CC',
        documentNumber: b.documentNumber,
        fullName: 'DEV-test Paciente Alta',
        birthDate: '1990-05-17',
        estimatedAgeYears: null,
        sex: 'F',
        isNN: false,
      },
    ]);
    // Exacto: otro tipo, un prefijo o el mismo documento en otro tenant no aparecen.
    await search({ documentType: 'CE', documentNumber: b.documentNumber })
      .expect(200)
      .expect([]);
    await search({
      documentType: 'CC',
      documentNumber: b.documentNumber.slice(0, 5),
    })
      .expect(200)
      .expect([]);
    const otherRec = await fx.staff(other.id);
    await fx
      .http(
        'get',
        `/patients?documentType=CC&documentNumber=${b.documentNumber}`,
        otherRec.token,
      )
      .expect(200)
      .expect([]);
  });

  it.each([
    ['sin documentType', { documentNumber: '123' }],
    ['sin documentNumber', { documentType: 'CC' }],
    ['documentType no admitido', { documentType: 'XX', documentNumber: '1' }],
    ['documentNumber vacío', { documentType: 'CC', documentNumber: '' }],
  ])('R25: GET /patients %s responde 400 problem+json', async (_l, q) => {
    const res = await search(q as Record<string, string>).expect(400);
    expect(problem(res).errors?.length).toBeGreaterThan(0);
  });

  it('R26: crea un paciente con documento (TI y RC incluidos), con identity_verified_at del servidor y auditoría PATIENT_CREATED de STAFF con isNN = false', async () => {
    for (const documentType of ['CC', 'TI', 'CE', 'PA', 'RC']) {
      const b = documented({
        documentType,
        birthDate: documentType === 'RC' ? '2024-02-29' : '2012-01-01',
      });
      const res = await create(b).expect(201);
      const body = res.body as { id: string };
      expect(res.body).toMatchObject({
        documentType,
        documentNumber: b.documentNumber,
        isNN: false,
        estimatedAgeYears: null,
      });
      const row = await fx.prisma.patient.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(row).toMatchObject({ tenantId: t.id, identityVerifiedAt: NOW });
      const audits = await fx.audits({
        entityId: body.id,
        action: 'PATIENT_CREATED',
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actorType: 'STAFF',
        actorId: rec.id,
        tenantId: t.id,
        entity: 'patient',
        metadata: { isNN: false },
        occurredAt: NOW,
      });
    }
  });

  it('R27: crea pacientes NN (sin documento) con edad estimada o fecha de nacimiento, sin identity_verified_at, varios en el mismo tenant y auditados con isNN = true', async () => {
    const ids: string[] = [];
    for (const b of [
      { sex: 'M', estimatedAgeYears: 45 },
      { sex: 'M', estimatedAgeYears: 45 },
      { sex: 'X', birthDate: '2001-01-01', fullName: 'DEV-test NN con nombre' },
    ]) {
      const res = await create(b).expect(201);
      const body = res.body as { id: string; isNN: boolean };
      expect(body).toMatchObject({
        documentType: null,
        documentNumber: null,
        isNN: true,
      });
      ids.push(body.id);
      const row = await fx.prisma.patient.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(row.identityVerifiedAt).toBeNull();
      const [audit] = await fx.audits({
        entityId: body.id,
        action: 'PATIENT_CREATED',
      });
      expect(audit.metadata).toEqual({ isNN: true });
    }
    expect(new Set(ids).size).toBe(3);
  });

  it('R28: un documento repetido en el tenant responde 409 sin crear filas (también en dos altas simultáneas); en otro tenant se admite', async () => {
    const b = documented();
    await create(b).expect(201);
    const dup = await create(b).expect(409);
    expect(problem(dup).status).toBe(409);
    expect(await countByDoc(b.documentNumber)).toBe(1);

    const race = documented();
    const statuses = (await Promise.all([create(race), create(race)])).map(
      (r) => r.status,
    );
    expect(statuses.sort()).toEqual([201, 409]);
    expect(await countByDoc(race.documentNumber)).toBe(1);

    const otherRec = await fx.staff(other.id);
    await create(b, otherRec.token).expect(201);
  });

  it.each([
    [
      'solo documentType',
      { documentType: 'CC', sex: 'M', birthDate: '1990-01-01', fullName: 'x' },
      'documentNumber',
    ],
    [
      'solo documentNumber',
      { documentNumber: '1', sex: 'M', birthDate: '1990-01-01', fullName: 'x' },
      'documentType',
    ],
    [
      'documentType no admitido',
      {
        documentType: 'NIT',
        documentNumber: '1',
        sex: 'M',
        birthDate: '1990-01-01',
        fullName: 'x',
      },
      'documentType',
    ],
    [
      'con documento y sin fullName',
      {
        documentType: 'CC',
        documentNumber: '1',
        sex: 'M',
        birthDate: '1990-01-01',
      },
      'fullName',
    ],
    [
      'con documento y sin birthDate',
      { documentType: 'CC', documentNumber: '1', sex: 'M', fullName: 'x' },
      'birthDate',
    ],
    [
      'birthDate y estimatedAgeYears a la vez',
      { sex: 'M', birthDate: '1990-01-01', estimatedAgeYears: 30 },
      'estimatedAgeYears',
    ],
    [
      'estimatedAgeYears con documento',
      {
        documentType: 'CC',
        documentNumber: '1',
        sex: 'M',
        birthDate: '1990-01-01',
        fullName: 'x',
        estimatedAgeYears: 30,
      },
      'estimatedAgeYears',
    ],
    [
      'estimatedAgeYears fuera de 0–120',
      { sex: 'M', estimatedAgeYears: 121 },
      'estimatedAgeYears',
    ],
    [
      'estimatedAgeYears negativa',
      { sex: 'M', estimatedAgeYears: -1 },
      'estimatedAgeYears',
    ],
    ['NN sin fecha ni edad', { sex: 'M' }, 'birthDate'],
    ['sin sex', { estimatedAgeYears: 30 }, 'sex'],
    ['sex no admitido', { estimatedAgeYears: 30, sex: 'Z' }, 'sex'],
    ['birthDate inválida', { sex: 'M', birthDate: '2026-02-30' }, 'birthDate'],
    [
      'campo no declarado',
      { sex: 'M', estimatedAgeYears: 30, notes: 'x' },
      'notes',
    ],
  ])(
    'R29: POST /patients %s responde 400 con el campo en errors[] sin crear filas',
    async (_l, body, field) => {
      const before = await fx.prisma.patient.count({
        where: { tenantId: t.id },
      });
      const res = await create(body).expect(400);
      expect(problem(res).errors?.map((e) => e.field)).toContain(field);
      expect(await fx.prisma.patient.count({ where: { tenantId: t.id } })).toBe(
        before,
      );
    },
  );

  it('R29: una fecha de nacimiento posterior a hoy en Bogotá responde 422 sin crear filas; la de hoy se admite', async () => {
    const before = await fx.prisma.patient.count({ where: { tenantId: t.id } });
    const res = await create(documented({ birthDate: '2026-10-27' })).expect(
      422,
    );
    expect(problem(res).status).toBe(422);
    await create({ sex: 'M', birthDate: '2026-10-27' }).expect(422);
    expect(await fx.prisma.patient.count({ where: { tenantId: t.id } })).toBe(
      before,
    );
    await create(documented({ birthDate: '2026-10-26' })).expect(201);
  });
});
