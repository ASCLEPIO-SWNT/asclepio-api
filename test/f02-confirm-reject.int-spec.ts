import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { createApp, problem } from './e2e-app.js';
import { FailingAuditService } from './int/failing-audit.js';
import { COMPLAINT, F02Fixtures, type Staff } from './int/f02-fixtures.js';

const NOW = new Date('2026-10-26T15:00:00.000Z');
const SIX_HOURS = 6 * 60 * 60 * 1000;
const LATER = new Date(NOW.getTime() + 25 * 60_000); // recepción confirma 25 min después

describe('Confirmación y rechazo de pre-registros por recepción (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  const clock = new FixedClock(NOW);
  let t: { id: string; siteId: string; siteName: string };
  let other: { id: string; siteId: string };
  let rec: Staff;

  beforeAll(async () => {
    app = await createApp({ overrides: [{ provide: Clock, useValue: clock }] });
    fx = new F02Fixtures(app);
    t = await fx.tenant('f02-confirm');
    other = await fx.tenant('f02-confirm-other');
    rec = await fx.staff(t.id);
  });
  beforeEach(() => clock.set(NOW));
  afterAll(() => app.close());

  const confirm = (
    id: string,
    body: unknown = { identityVerified: true },
    token = rec.token,
  ) =>
    fx
      .http('post', `/pre-registrations/${id}/confirm`, token)
      .send(body as object);
  const reject = (id: string, body: unknown, token = rec.token) =>
    fx
      .http('post', `/pre-registrations/${id}/reject`, token)
      .send(body as object);
  const preRow = (id: string) =>
    fx.prisma.preRegistration.findUniqueOrThrow({ where: { id } });
  const encountersOf = (patientId: string) =>
    fx.prisma.encounter.findMany({ where: { patientId } });

  /** Paciente con un pre-registro creado a NOW y el reloj movido a LATER. */
  async function pending(opts: { identityVerified?: boolean } = {}) {
    clock.set(NOW);
    const p = await fx.patientUser(t.id, opts);
    const pre = await fx.preRegister(p, t.siteId);
    clock.set(LATER);
    return { p, pre };
  }

  // ---------------------------------------------------------------- T12: confirmación

  it('R17: en una transacción pasa el pre-registro a CONFIRMED y crea la atención PRE_REGISTRATION en WAITING_TRIAGE con arrival_at del servidor; responde 201 con preRegisteredAt distinto de arrivalAt', async () => {
    const { p, pre } = await pending();
    const res = await confirm(pre.id).expect(201);
    const enc = res.body as Record<string, unknown> & { id: string };
    expect(enc).toMatchObject({
      siteId: t.siteId,
      siteName: t.siteName,
      status: 'WAITING_TRIAGE',
      origin: 'PRE_REGISTRATION',
      arrivalAt: LATER.toISOString(),
      preRegistrationId: pre.id,
      preRegisteredAt: NOW.toISOString(),
      chiefComplaintText: COMPLAINT,
      complaintSource: 'TYPED',
      cancellationReason: null,
      registeredBy: { id: rec.id, fullName: rec.fullName },
      patient: { id: p.patientId, isNN: false },
    });
    expect(enc.preRegisteredAt).not.toBe(enc.arrivalAt);
    expect(await preRow(pre.id)).toMatchObject({
      status: 'CONFIRMED',
      resolvedAt: LATER,
      resolvedBy: rec.id,
      encounterId: enc.id,
    });
    const row = await fx.prisma.encounter.findUniqueOrThrow({
      where: { id: enc.id },
    });
    expect(row).toMatchObject({
      tenantId: t.id,
      patientId: p.patientId,
      siteId: t.siteId,
      arrivalAt: LATER,
      registeredBy: rec.id,
      status: 'WAITING_TRIAGE',
    });
    const audits = await fx.audits({
      entityId: pre.id,
      action: 'PRE_REGISTRATION_CONFIRMED',
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: 'STAFF',
      actorId: rec.id,
      metadata: { encounterId: enc.id },
    });
  });

  it('R37: la atención confirmada tiene ENCOUNTER_CREATED (→ REGISTERED, origin y preRegistrationId) y STATUS_CHANGED (REGISTERED → WAITING_TRIAGE), de STAFF y con occurred_at = arrival_at', async () => {
    const { pre } = await pending();
    const enc = (await confirm(pre.id).expect(201)).body as { id: string };
    const events = await fx.prisma.encounterEvent.findMany({
      where: { encounterId: enc.id },
      orderBy: { id: 'asc' },
    });
    expect(events.map((e) => ({ ...e, id: undefined }))).toEqual([
      expect.objectContaining({
        type: 'ENCOUNTER_CREATED',
        fromStatus: null,
        toStatus: 'REGISTERED',
        payload: { origin: 'PRE_REGISTRATION', preRegistrationId: pre.id },
        actorType: 'STAFF',
        actorId: rec.id,
        occurredAt: LATER,
        tenantId: t.id,
      }),
      expect.objectContaining({
        type: 'STATUS_CHANGED',
        fromStatus: 'REGISTERED',
        toStatus: 'WAITING_TRIAGE',
        payload: {},
        actorType: 'STAFF',
        actorId: rec.id,
        occurredAt: LATER,
      }),
    ]);
  });

  it('R39: crear la atención audita ENCOUNTER_CREATED (STAFF, entity encounter, metadata.origin) en la misma transacción', async () => {
    const { pre } = await pending();
    const enc = (await confirm(pre.id).expect(201)).body as { id: string };
    const audits = await fx.audits({
      entityId: enc.id,
      action: 'ENCOUNTER_CREATED',
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: 'STAFF',
      actorId: rec.id,
      tenantId: t.id,
      entity: 'encounter',
      metadata: { origin: 'PRE_REGISTRATION' },
      occurredAt: LATER,
    });
  });

  it('R18: si la cuenta no estaba verificada, la verifica, fija identity_verified_at del paciente y audita PATIENT_IDENTITY_VERIFIED (STAFF); si ya lo estaba, no la modifica ni audita', async () => {
    const { p, pre } = await pending();
    await confirm(pre.id).expect(201);
    const account = await fx.prisma.patientAccount.findUniqueOrThrow({
      where: { id: p.accountId },
    });
    expect(account.identityVerified).toBe(true);
    const patient = await fx.prisma.patient.findUniqueOrThrow({
      where: { id: p.patientId },
    });
    expect(patient.identityVerifiedAt).toEqual(LATER);
    const audits = await fx.audits({
      entityId: p.accountId,
      action: 'PATIENT_IDENTITY_VERIFIED',
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: 'STAFF',
      actorId: rec.id,
      tenantId: t.id,
    });

    const v = await pending({ identityVerified: true });
    const before = await fx.prisma.patientAccount.findUniqueOrThrow({
      where: { id: v.p.accountId },
    });
    await confirm(v.pre.id).expect(201);
    expect(
      await fx.prisma.patientAccount.findUniqueOrThrow({
        where: { id: v.p.accountId },
      }),
    ).toEqual(before);
    expect(
      await fx.audits({
        entityId: v.p.accountId,
        action: 'PATIENT_IDENTITY_VERIFIED',
      }),
    ).toHaveLength(0);
  });

  it.each([
    ['sin identityVerified', {}],
    ['identityVerified false', { identityVerified: false }],
    ['identityVerified "true"', { identityVerified: 'true' }],
  ])('R19: %s responde 422 sin modificar filas', async (_l, body) => {
    const { p, pre } = await pending();
    const before = await preRow(pre.id);
    const res = await confirm(pre.id, body).expect(422);
    expect(problem(res).status).toBe(422);
    expect(await preRow(pre.id)).toEqual(before);
    expect(await encountersOf(p.patientId)).toHaveLength(0);
  });

  it('R20: confirmar un pre-registro CONFIRMED, REJECTED o EXPIRED (calculado) responde 409 sin crear ni modificar filas', async () => {
    const a = await pending();
    await confirm(a.pre.id).expect(201);
    const before = await preRow(a.pre.id);
    expect(problem(await confirm(a.pre.id).expect(409)).status).toBe(409);
    expect(await preRow(a.pre.id)).toEqual(before);
    expect(await encountersOf(a.p.patientId)).toHaveLength(1);

    const b = await pending();
    await reject(b.pre.id, { reason: 'DEV-test' }).expect(200);
    await confirm(b.pre.id).expect(409);
    expect(await encountersOf(b.p.patientId)).toHaveLength(0);

    const c = await pending();
    clock.set(new Date(NOW.getTime() + SIX_HOURS));
    await confirm(c.pre.id).expect(409);
    expect((await preRow(c.pre.id)).status).toBe('PENDING');
    expect(await encountersOf(c.p.patientId)).toHaveLength(0);
  });

  it('R20: dos confirmaciones simultáneas del mismo pre-registro: exactamente una obtiene 201 y existe una sola atención', async () => {
    const { p, pre } = await pending();
    const statuses = (
      await Promise.all([confirm(pre.id), confirm(pre.id)])
    ).map((r) => r.status);
    expect(statuses.sort()).toEqual([201, 409]);
    expect(await encountersOf(p.patientId)).toHaveLength(1);
  });

  it('R21: un pre-registro inexistente, de otro tenant o con id mal formado responde 404 con la misma respuesta de error', async () => {
    const o = await fx.patientUser(other.id);
    const foreign = await fx.preRegister(o, other.siteId);
    const bodies = new Set<string>();
    for (const id of [
      foreign.id,
      '00000000-0000-4000-8000-000000000000',
      'x',
    ]) {
      const { status, title, detail } = problem(await confirm(id).expect(404));
      bodies.add(JSON.stringify({ status, title, detail }));
    }
    expect(bodies.size).toBe(1);
    expect((await preRow(foreign.id)).status).toBe('PENDING');
  });

  it('R22: si el paciente ya tiene una atención activa responde 409 sin crear ni modificar filas', async () => {
    // Pre-registro creado antes de la atención directa (riesgo aceptado en design.md): se inserta por la base.
    const p = await fx.patientUser(t.id);
    const enc = await fx
      .http('post', '/encounters', rec.token)
      .send({
        patientId: p.patientId,
        siteId: t.siteId,
        chiefComplaintText: COMPLAINT,
        complaintSource: 'TYPED',
      })
      .expect(201);
    const pre = await fx.prisma.preRegistration.create({
      data: {
        tenantId: t.id,
        patientId: p.patientId,
        siteId: t.siteId,
        chiefComplaintText: COMPLAINT,
        complaintSource: 'TYPED',
        preRegisteredAt: NOW,
        expiresAt: new Date(NOW.getTime() + SIX_HOURS),
      },
    });
    const before = await preRow(pre.id);
    expect(problem(await confirm(pre.id).expect(409)).status).toBe(409);
    expect(await preRow(pre.id)).toEqual(before);
    expect((await encountersOf(p.patientId)).map((e) => e.id)).toEqual([
      (enc.body as { id: string }).id,
    ]);
  });

  it('R39: si falla la auditoría de la atención se revierte toda la transacción y responde 500 problem+json', async () => {
    const failing = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: AuditService, useClass: FailingAuditService },
      ],
    });
    FailingAuditService.failOn.add('ENCOUNTER_CREATED');
    try {
      const { p, pre } = await pending();
      const before = await preRow(pre.id);
      const res = await request(failing.getHttpServer())
        .post(`/api/v1/pre-registrations/${pre.id}/confirm`)
        .set('Authorization', `Bearer ${rec.token}`)
        .send({ identityVerified: true })
        .expect(500);
      expect(problem(res)).toMatchObject({
        status: 500,
        detail: 'Error interno.',
      });
      expect(await preRow(pre.id)).toEqual(before);
      expect(await encountersOf(p.patientId)).toHaveLength(0);
      const account = await fx.prisma.patientAccount.findUniqueOrThrow({
        where: { id: p.accountId },
      });
      expect(account.identityVerified).toBe(false);
      expect(
        await fx.audits({
          entityId: pre.id,
          action: 'PRE_REGISTRATION_CONFIRMED',
        }),
      ).toHaveLength(0);
    } finally {
      FailingAuditService.failOn.delete('ENCOUNTER_CREATED');
      await failing.close();
    }
  });

  // ---------------------------------------------------------------- T13: rechazo

  it('R23: rechaza un pre-registro vigente (REJECTED, resolved_at, resolved_by, rejection_reason sin espacios extremos), audita sin el texto y responde 200', async () => {
    const { pre } = await pending();
    const res = await reject(pre.id, {
      reason: '  DEV-test documento ilegible  ',
    }).expect(200);
    expect(res.body).toEqual({
      id: pre.id,
      status: 'REJECTED',
      resolvedAt: LATER.toISOString(),
    });
    expect(await preRow(pre.id)).toMatchObject({
      status: 'REJECTED',
      resolvedAt: LATER,
      resolvedBy: rec.id,
      rejectionReason: 'DEV-test documento ilegible',
      encounterId: null,
    });
    const audits = await fx.audits({
      entityId: pre.id,
      action: 'PRE_REGISTRATION_REJECTED',
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: 'STAFF',
      actorId: rec.id,
      metadata: { reasonProvided: true },
    });
    expect(JSON.stringify(audits.map((x) => x.metadata))).not.toContain(
      'ilegible',
    );
  });

  it('R23: no vigente → 409; inexistente u otro tenant → 404; motivo ausente, vacío o de más de 500 → 400; sin modificar filas', async () => {
    const a = await pending();
    await reject(a.pre.id, { reason: 'DEV-test' }).expect(200);
    await reject(a.pre.id, { reason: 'DEV-test' }).expect(409);

    const exp = await pending();
    clock.set(new Date(NOW.getTime() + SIX_HOURS));
    await reject(exp.pre.id, { reason: 'DEV-test' }).expect(409);
    expect((await preRow(exp.pre.id)).status).toBe('PENDING');
    clock.set(LATER);

    const o = await fx.patientUser(other.id);
    const foreign = await fx.preRegister(o, other.siteId);
    await reject(foreign.id, { reason: 'DEV-test' }).expect(404);
    await reject('00000000-0000-4000-8000-000000000000', {
      reason: 'DEV-test',
    }).expect(404);
    expect((await preRow(foreign.id)).status).toBe('PENDING');

    const b = await pending();
    const before = await preRow(b.pre.id);
    for (const body of [
      {},
      { reason: '' },
      { reason: '    ' },
      { reason: 'a'.repeat(501) },
      { reason: 5 },
    ]) {
      const res = await reject(b.pre.id, body).expect(400);
      expect(problem(res).errors?.map((e) => e.field)).toContain('reason');
    }
    expect(await preRow(b.pre.id)).toEqual(before);
    await reject(b.pre.id, { reason: ` ${'a'.repeat(500)} ` }).expect(200);
  });
});
