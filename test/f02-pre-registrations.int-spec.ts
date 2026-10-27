import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import { createApp, problem } from './e2e-app.js';
import {
  COMPLAINT,
  F02Fixtures,
  type PatientUser,
  type Staff,
} from './int/f02-fixtures.js';

const NOW = new Date('2026-10-26T15:00:00.000Z');
const SIX_HOURS = 6 * 60 * 60 * 1000;

describe('Pre-registro del paciente y bandeja de recepción (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  const clock = new FixedClock(NOW);
  let t: { id: string; siteId: string; siteName: string };
  let other: { id: string; siteId: string; siteName: string };
  let rec: Staff;

  beforeAll(async () => {
    app = await createApp({ overrides: [{ provide: Clock, useValue: clock }] });
    fx = new F02Fixtures(app);
    t = await fx.tenant('f02-pre');
    other = await fx.tenant('f02-pre-other');
    rec = await fx.staff(t.id);
  });
  beforeEach(() => clock.set(NOW));
  afterAll(() => app.close());

  const post = (p: PatientUser, body: Record<string, unknown>) =>
    fx.http('post', '/patient/pre-registrations', p.token).send(body);
  const valid = (over: Record<string, unknown> = {}) => ({
    siteId: t.siteId,
    chiefComplaintText: COMPLAINT,
    complaintSource: 'TYPED',
    ...over,
  });
  const countFor = (patientId: string) =>
    fx.prisma.preRegistration.count({ where: { patientId } });

  // ---------------------------------------------------------------- T9: creación

  it('R5: crea el pre-registro con tenant y paciente del token, PENDING, pre_registered_at del servidor y expires_at + 6 h, audita PRE_REGISTRATION_CREATED (PATIENT) y responde 201 con la vista del paciente', async () => {
    const p = await fx.patientUser(t.id);
    const res = await post(
      p,
      valid({ complaintSource: 'VOICE_ON_DEVICE' }),
    ).expect(201);
    const body = res.body as { id: string };
    expect(res.body).toEqual({
      id: body.id,
      siteId: t.siteId,
      siteName: t.siteName,
      status: 'PENDING',
      preRegisteredAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + SIX_HOURS).toISOString(),
      encounter: null,
    });
    const row = await fx.prisma.preRegistration.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(row).toMatchObject({
      tenantId: t.id,
      patientId: p.patientId,
      siteId: t.siteId,
      status: 'PENDING',
      chiefComplaintText: COMPLAINT,
      complaintSource: 'VOICE_ON_DEVICE',
      preRegisteredAt: NOW,
      expiresAt: new Date(NOW.getTime() + SIX_HOURS),
      resolvedAt: null,
      encounterId: null,
    });
    const audits = await fx.audits({
      entityId: body.id,
      action: 'PRE_REGISTRATION_CREATED',
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: 'PATIENT',
      actorId: p.accountId,
      tenantId: t.id,
      entity: 'pre_registration',
      occurredAt: NOW,
    });
  });

  it('R6: un siteId de otro tenant o inexistente responde 422 sin crear filas', async () => {
    const p = await fx.patientUser(t.id);
    for (const siteId of [
      other.siteId,
      '00000000-0000-4000-8000-000000000000',
    ]) {
      const res = await post(p, valid({ siteId })).expect(422);
      expect(problem(res).status).toBe(422);
    }
    expect(await countFor(p.patientId)).toBe(0);
  });

  it.each([
    ['sin siteId', { siteId: undefined }, 'siteId'],
    [
      'sin chiefComplaintText',
      { chiefComplaintText: undefined },
      'chiefComplaintText',
    ],
    ['sin complaintSource', { complaintSource: undefined }, 'complaintSource'],
    ['siteId no UUID', { siteId: 'sede-1' }, 'siteId'],
    ['texto vacío', { chiefComplaintText: '' }, 'chiefComplaintText'],
    [
      'texto solo con espacios',
      { chiefComplaintText: '   \n ' },
      'chiefComplaintText',
    ],
    [
      'texto de más de 2 000',
      { chiefComplaintText: 'a'.repeat(2001) },
      'chiefComplaintText',
    ],
    [
      'complaintSource no admitido',
      { complaintSource: 'AUDIO' },
      'complaintSource',
    ],
  ])(
    'R7: %s responde 400 con el campo en errors[] sin crear filas',
    async (_l, over, field) => {
      const p = await fx.patientUser(t.id);
      const res = await post(p, valid(over)).expect(400);
      expect(problem(res).errors?.map((e) => e.field)).toContain(field);
      expect(await countFor(p.patientId)).toBe(0);
    },
  );

  it('R7: un texto de exactamente 2 000 caracteres se admite', async () => {
    const p = await fx.patientUser(t.id);
    await post(p, valid({ chiefComplaintText: 'a'.repeat(2000) })).expect(201);
  });

  it('R8: con un pre-registro vigente responde 409 sin crear filas; con dos envíos simultáneos exactamente uno obtiene 201', async () => {
    const p = await fx.patientUser(t.id);
    await post(p, valid()).expect(201);
    const res = await post(p, valid()).expect(409);
    expect(problem(res).status).toBe(409);
    expect(await countFor(p.patientId)).toBe(1);

    const q = await fx.patientUser(t.id);
    const statuses = (
      await Promise.all([post(q, valid()), post(q, valid())])
    ).map((r) => r.status);
    expect(statuses.sort()).toEqual([201, 409]);
    expect(await countFor(q.patientId)).toBe(1);
  });

  it('R9: con una atención activa responde 409 sin crear filas', async () => {
    const p = await fx.patientUser(t.id);
    await fx
      .http('post', '/encounters', rec.token)
      .send({
        patientId: p.patientId,
        siteId: t.siteId,
        chiefComplaintText: COMPLAINT,
        complaintSource: 'TYPED',
      })
      .expect(201);
    const res = await post(p, valid()).expect(409);
    expect(problem(res).status).toBe(409);
    expect(await countFor(p.patientId)).toBe(0);
  });

  it('R11: al crear, los PENDING vencidos del paciente pasan a EXPIRED con resolved_at = expires_at y una auditoría PRE_REGISTRATION_EXPIRED de SYSTEM, antes de aplicar R8', async () => {
    const p = await fx.patientUser(t.id);
    const first = await fx.preRegister(p, t.siteId);
    clock.advance(SIX_HOURS); // exactamente en expires_at: ya vencido
    const second = await post(p, valid()).expect(201);
    const old = await fx.prisma.preRegistration.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(old).toMatchObject({
      status: 'EXPIRED',
      resolvedAt: new Date(NOW.getTime() + SIX_HOURS),
    });
    const audits = await fx.audits({
      entityId: first.id,
      action: 'PRE_REGISTRATION_EXPIRED',
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: 'SYSTEM',
      actorId: null,
      tenantId: t.id,
    });
    expect((second.body as { status: string }).status).toBe('PENDING');
  });

  // ---------------------------------------------------------------- T10: vista del paciente

  it('R10: un PENDING vencido se presenta EXPIRED en las respuestas sin escribir nada en la base', async () => {
    const p = await fx.patientUser(t.id);
    const pre = await fx.preRegister(p, t.siteId);
    clock.advance(SIX_HOURS - 1);
    const before = await fx
      .http('get', `/patient/pre-registrations/${pre.id}`, p.token)
      .expect(200);
    expect((before.body as { status: string }).status).toBe('PENDING');
    clock.advance(1);
    const after = await fx
      .http('get', `/patient/pre-registrations/${pre.id}`, p.token)
      .expect(200);
    expect((after.body as { status: string }).status).toBe('EXPIRED');
    const list = await fx
      .http('get', '/patient/pre-registrations', p.token)
      .expect(200);
    expect((list.body as { status: string }[])[0].status).toBe('EXPIRED');
    const row = await fx.prisma.preRegistration.findUniqueOrThrow({
      where: { id: pre.id },
    });
    expect(row.status).toBe('PENDING');
  });

  it('R12: lista los 20 más recientes del paciente del token, por pre_registered_at descendente, solo con los campos de la vista (sin nivel ni motivo de rechazo) y con la atención tras confirmar', async () => {
    const p = await fx.patientUser(t.id);
    const ids: string[] = [];
    for (let i = 0; i < 22; i++) {
      const pre = await fx.preRegister(p, t.siteId);
      ids.push(pre.id);
      await fx
        .http('post', `/pre-registrations/${pre.id}/reject`, rec.token)
        .send({ reason: 'DEV-test motivo de rechazo privado' })
        .expect(200);
      clock.advance(60_000);
    }
    const last = await fx.preRegister(p, t.siteId);
    const confirmed = await fx
      .http('post', `/pre-registrations/${last.id}/confirm`, rec.token)
      .send({ identityVerified: true })
      .expect(201);
    const other = await fx.patientUser(t.id);
    await fx.preRegister(other, t.siteId);

    const res = await fx
      .http('get', '/patient/pre-registrations', p.token)
      .expect(200);
    const list = res.body as Record<string, unknown>[];
    expect(list).toHaveLength(20);
    expect(list.map((x) => x.id)).toEqual([
      last.id,
      ...ids.slice(-19).reverse(),
    ]);
    for (const item of list) {
      expect(Object.keys(item).sort()).toEqual([
        'encounter',
        'expiresAt',
        'id',
        'preRegisteredAt',
        'siteId',
        'siteName',
        'status',
      ]);
    }
    expect(list[0]).toMatchObject({
      status: 'CONFIRMED',
      encounter: {
        id: (confirmed.body as { id: string }).id,
        status: 'WAITING_TRIAGE',
      },
    });
    expect(list[1]).toMatchObject({ status: 'REJECTED', encounter: null });
    expect(JSON.stringify(list)).not.toContain('motivo de rechazo');
  });

  it('R13: GET /patient/pre-registrations/{id} responde 200 con la vista si es del paciente y 404 igual si es de otro paciente, de otro tenant, inexistente o mal formado', async () => {
    const p = await fx.patientUser(t.id);
    const mine = await fx.preRegister(p, t.siteId);
    const ok = await fx
      .http('get', `/patient/pre-registrations/${mine.id}`, p.token)
      .expect(200);
    expect(ok.body).toMatchObject({
      id: mine.id,
      status: 'PENDING',
      siteName: t.siteName,
    });

    const q = await fx.patientUser(t.id);
    const theirs = await fx.preRegister(q, t.siteId);
    const o = await fx.patientUser(other.id);
    const foreign = await fx.preRegister(o, other.siteId);
    const bodies: unknown[] = [];
    for (const id of [
      theirs.id,
      foreign.id,
      '00000000-0000-4000-8000-000000000000',
      'no-uuid',
    ]) {
      const res = await fx
        .http('get', `/patient/pre-registrations/${id}`, p.token)
        .expect(404);
      const { detail, status, title } = problem(res);
      bodies.push({ detail, status, title });
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });

  // ---------------------------------------------------------------- T11: bandeja

  it('R15: la bandeja devuelve solo los vigentes del tenant, por pre_registered_at ascendente, con datos del paciente e identityVerified, y filtra por siteId', async () => {
    const tb = await fx.tenant('f02-tray');
    const recB = await fx.staff(tb.id);
    const site2 = await fx.site(tb.id, 'DEV-test Sede Sur');
    const a = await fx.patientUser(tb.id, { fullName: 'DEV-test Bandeja A' });
    const b = await fx.patientUser(tb.id, { identityVerified: true });
    const preA = await fx.preRegister(a, tb.siteId);
    clock.advance(1000);
    const preB = await fx.preRegister(b, site2.id, {
      complaintSource: 'VOICE_ON_DEVICE',
    });
    const o = await fx.patientUser(other.id);
    await fx.preRegister(o, other.siteId);

    const res = await fx
      .http('get', '/pre-registrations', recB.token)
      .expect(200);
    expect(res.body).toEqual([
      {
        id: preA.id,
        siteId: tb.siteId,
        siteName: tb.siteName,
        preRegisteredAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + SIX_HOURS).toISOString(),
        chiefComplaintText: COMPLAINT,
        complaintSource: 'TYPED',
        identityVerified: false,
        patient: {
          id: a.patientId,
          documentType: 'CC',
          documentNumber: a.documentNumber,
          fullName: 'DEV-test Bandeja A',
          birthDate: '1985-03-04',
          estimatedAgeYears: null,
          sex: 'F',
          isNN: false,
        },
      },
      expect.objectContaining({
        id: preB.id,
        siteId: site2.id,
        siteName: 'DEV-test Sede Sur',
        identityVerified: true,
        complaintSource: 'VOICE_ON_DEVICE',
      }),
    ]);
    const filtered = await fx
      .http('get', `/pre-registrations?siteId=${site2.id}`, recB.token)
      .expect(200);
    expect((filtered.body as { id: string }[]).map((x) => x.id)).toEqual([
      preB.id,
    ]);
    await fx
      .http('get', '/pre-registrations?siteId=no-uuid', recB.token)
      .expect(400);
  });

  it('R10: la bandeja excluye los vencidos (FixedClock) y los ya resueltos', async () => {
    const tb = await fx.tenant('f02-tray-exp');
    const recB = await fx.staff(tb.id);
    const a = await fx.patientUser(tb.id);
    await fx.preRegister(a, tb.siteId);
    const b = await fx.patientUser(tb.id);
    const preB = await fx.preRegister(b, tb.siteId);
    await fx
      .http('post', `/pre-registrations/${preB.id}/reject`, recB.token)
      .send({ reason: 'DEV-test' })
      .expect(200);
    expect(
      (await fx.http('get', '/pre-registrations', recB.token).expect(200)).body,
    ).toHaveLength(1);
    clock.advance(SIX_HOURS);
    expect(
      (await fx.http('get', '/pre-registrations', recB.token).expect(200)).body,
    ).toEqual([]);
  });

  it('R16: un siteId de otra IPS devuelve una lista vacía sin datos de otro tenant', async () => {
    const o = await fx.patientUser(other.id);
    await fx.preRegister(o, other.siteId);
    const res = await fx
      .http('get', `/pre-registrations?siteId=${other.siteId}`, rec.token)
      .expect(200);
    expect(res.body).toEqual([]);
  });
});
