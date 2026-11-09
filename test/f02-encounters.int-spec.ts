import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import { PrismaService } from '../src/common/prisma/prisma.service.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { EncountersService } from '../src/modules/encounters/encounters.service.js';
import { createApp, problem } from './e2e-app.js';
import { FailingAuditService } from './int/failing-audit.js';
import {
  COMPLAINT,
  F02Fixtures,
  forcedTriage,
  type Staff,
} from './int/f02-fixtures.js';

const NOW = new Date('2026-10-26T15:00:00.000Z');

describe('Registro directo, máquina de estados, cancelación y consulta de atenciones (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  const clock = new FixedClock(NOW);
  let t: { id: string; siteId: string; siteName: string };
  let other: { id: string; siteId: string };
  let rec: Staff;
  let nurse: Staff;

  beforeAll(async () => {
    app = await createApp({ overrides: [{ provide: Clock, useValue: clock }] });
    fx = new F02Fixtures(app);
    t = await fx.tenant('f02-enc');
    other = await fx.tenant('f02-enc-other');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
  });
  beforeEach(() => clock.set(NOW));
  afterAll(() => app.close());

  const body = (patientId: string, over: Record<string, unknown> = {}) => ({
    patientId,
    siteId: t.siteId,
    chiefComplaintText: COMPLAINT,
    complaintSource: 'TYPED',
    ...over,
  });
  const direct = (b: Record<string, unknown>, token = rec.token) =>
    fx.http('post', '/encounters', token).send(b);
  const cancel = (id: string, b: unknown, token = rec.token) =>
    fx.http('post', `/encounters/${id}/cancel`, token).send(b as object);
  const countFor = (patientId: string) =>
    fx.prisma.encounter.count({ where: { patientId } });
  async function newEncounter(): Promise<{ id: string; patientId: string }> {
    const p = await fx.patient(t.id);
    const res = await direct(body(p.id)).expect(201);
    return { id: (res.body as { id: string }).id, patientId: p.id };
  }
  const svc = () => app.get(EncountersService);
  const prisma = () => app.get(PrismaService);
  const staffActor = () => ({ type: 'STAFF' as const, id: nurse.id });

  // ---------------------------------------------------------------- T14: registro directo

  it('R30: crea la atención DIRECT en WAITING_TRIAGE con arrival_at del servidor y registered_by del token, y responde 201 con preRegisteredAt null', async () => {
    const p = await fx.patient(t.id);
    const res = await direct(
      body(p.id, { complaintSource: 'VOICE_ON_DEVICE' }),
    ).expect(201);
    const enc = res.body as { id: string };
    expect(res.body).toMatchObject({
      status: 'WAITING_TRIAGE',
      origin: 'DIRECT',
      arrivalAt: NOW.toISOString(),
      preRegistrationId: null,
      preRegisteredAt: null,
      complaintSource: 'VOICE_ON_DEVICE',
      registeredBy: { id: rec.id, fullName: rec.fullName },
      patient: { id: p.id },
    });
    const row = await fx.prisma.encounter.findUniqueOrThrow({
      where: { id: enc.id },
    });
    expect(row).toMatchObject({
      arrivalAt: NOW,
      registeredBy: rec.id,
      tenantId: t.id,
      origin: 'DIRECT',
    });
  });

  it('R30: admite pacientes NN y menores', async () => {
    const nn = await fx.patient(t.id, {
      documentType: null,
      documentNumber: null,
      fullName: null,
      birthDate: null,
      estimatedAgeYears: 30,
    });
    const minor = await fx.patient(t.id, {
      documentType: 'RC',
      birthDate: new Date('2024-01-01T00:00:00Z'),
    });
    const a = await direct(body(nn.id)).expect(201);
    expect(a.body).toMatchObject({
      patient: { isNN: true, estimatedAgeYears: 30 },
    });
    const b = await direct(body(minor.id)).expect(201);
    expect(b.body).toMatchObject({
      patient: { documentType: 'RC', birthDate: '2024-01-01' },
    });
  });

  it('R37: el registro directo inserta ENCOUNTER_CREATED (origin DIRECT, sin preRegistrationId) y STATUS_CHANGED con occurred_at = arrival_at', async () => {
    const { id } = await newEncounter();
    const events = await fx.prisma.encounterEvent.findMany({
      where: { encounterId: id },
      orderBy: { id: 'asc' },
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: 'ENCOUNTER_CREATED',
        toStatus: 'REGISTERED',
        payload: { origin: 'DIRECT' },
        actorType: 'STAFF',
        actorId: rec.id,
        occurredAt: NOW,
      }),
      expect.objectContaining({
        type: 'STATUS_CHANGED',
        fromStatus: 'REGISTERED',
        toStatus: 'WAITING_TRIAGE',
        occurredAt: NOW,
      }),
    ]);
    const [audit] = await fx.audits({
      entityId: id,
      action: 'ENCOUNTER_CREATED',
    });
    expect(audit).toMatchObject({
      actorType: 'STAFF',
      actorId: rec.id,
      entity: 'encounter',
      metadata: { origin: 'DIRECT' },
    });
  });

  it('R31: un patientId o siteId de otro tenant (o inexistente) responde 422 sin crear filas; un campo inválido responde 400', async () => {
    const p = await fx.patient(t.id);
    const foreignPatient = await fx.patient(other.id);
    for (const b of [
      body(foreignPatient.id),
      body(p.id, { siteId: other.siteId }),
      body('00000000-0000-4000-8000-000000000000'),
    ]) {
      expect(problem(await direct(b).expect(422)).status).toBe(422);
    }
    for (const [over, field] of [
      [{ patientId: undefined }, 'patientId'],
      [{ siteId: 'x' }, 'siteId'],
      [{ chiefComplaintText: '  ' }, 'chiefComplaintText'],
      [{ chiefComplaintText: 'a'.repeat(2001) }, 'chiefComplaintText'],
      [{ complaintSource: 'AUDIO' }, 'complaintSource'],
    ] as const) {
      const res = await direct(body(p.id, over)).expect(400);
      expect(problem(res).errors?.map((e) => e.field)).toContain(field);
    }
    expect(await countFor(p.id)).toBe(0);
    expect(await countFor(foreignPatient.id)).toBe(0);
  });

  it('R32: con una atención activa o un pre-registro vigente responde 409 sin crear filas, también ante dos registros simultáneos', async () => {
    const { patientId } = await newEncounter();
    expect(problem(await direct(body(patientId)).expect(409)).status).toBe(409);
    expect(await countFor(patientId)).toBe(1);

    const app2 = await fx.patientUser(t.id);
    await fx.preRegister(app2, t.siteId);
    await direct(body(app2.patientId)).expect(409);
    expect(await countFor(app2.patientId)).toBe(0);

    const q = await fx.patient(t.id);
    const statuses = (
      await Promise.all([direct(body(q.id)), direct(body(q.id))])
    ).map((r) => r.status);
    expect(statuses.sort()).toEqual([201, 409]);
    expect(await countFor(q.id)).toBe(1);
  });

  it('R39: si falla la auditoría del registro directo se revierte todo (sin atención ni eventos) y responde 500', async () => {
    const failing = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: AuditService, useClass: FailingAuditService },
      ],
    });
    FailingAuditService.failOn.add('ENCOUNTER_CREATED');
    try {
      const p = await fx.patient(t.id);
      const res = await request(failing.getHttpServer())
        .post('/api/v1/encounters')
        .set('Authorization', `Bearer ${rec.token}`)
        .send(body(p.id))
        .expect(500);
      expect(problem(res).detail).toBe('Error interno.');
      expect(await countFor(p.id)).toBe(0);
      expect(
        await fx.prisma.encounterEvent.count({
          where: { encounter: { patientId: p.id } },
        }),
      ).toBe(0);
    } finally {
      FailingAuditService.failOn.delete('ENCOUNTER_CREATED');
      await failing.close();
    }
  });

  // ---------------------------------------------------------------- T15: máquina de estados y cancelación

  it('R33: la transición del service sigue la máquina: WAITING_TRIAGE → IN_CARE es 409; TRIAGED → IN_CARE → CLOSED se admite; desde CLOSED todo es 409 sin eventos nuevos', async () => {
    const { id } = await newEncounter();
    await expect(
      prisma().$transaction((tx) =>
        svc().transition(t.id, id, 'IN_CARE', staffActor(), tx),
      ),
    ).rejects.toMatchObject({ status: 409 });
    // TRIAGED solo llegará por F-05 (triage_decisions): la prueba lo prepara directamente en la base.
    await fx.prisma.encounter.update({
      where: { id },
      data: { status: 'TRIAGED', ...forcedTriage('TRIAGED', nurse.id) },
    });
    await prisma().$transaction((tx) =>
      svc().transition(t.id, id, 'IN_CARE', staffActor(), tx),
    );
    await prisma().$transaction((tx) =>
      svc().transition(t.id, id, 'CLOSED', staffActor(), tx),
    );
    const events = () =>
      fx.prisma.encounterEvent.count({ where: { encounterId: id } });
    const n = await events();
    for (const to of [
      'CANCELLED',
      'IN_CARE',
      'WAITING_TRIAGE',
      'CLOSED',
    ] as const) {
      await expect(
        prisma().$transaction((tx) =>
          svc().transition(t.id, id, to, staffActor(), tx),
        ),
      ).rejects.toMatchObject({ status: 409 });
    }
    expect(await events()).toBe(n);
    expect(
      (await fx.prisma.encounter.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('CLOSED');
  });

  it('R33: dos cambios concurrentes sobre el mismo estado: uno se aplica y el otro responde 409 sin evento', async () => {
    const { id } = await newEncounter();
    const results = await Promise.allSettled([
      prisma().$transaction((tx) =>
        svc().transition(t.id, id, 'CANCELLED', staffActor(), tx, {
          cancellationReason: 'a',
        }),
      ),
      prisma().$transaction((tx) =>
        svc().transition(t.id, id, 'CANCELLED', staffActor(), tx, {
          cancellationReason: 'b',
        }),
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const rejected = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    expect(
      await fx.prisma.encounterEvent.count({
        where: { encounterId: id, toStatus: 'CANCELLED' },
      }),
    ).toBe(1);
  });

  it('R34: la transición genérica rechaza TRIAGED como destino (409) sin modificar la atención', async () => {
    const { id } = await newEncounter();
    await expect(
      prisma().$transaction((tx) =>
        svc().transition(t.id, id, 'TRIAGED', staffActor(), tx),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await fx.prisma.encounter.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('WAITING_TRIAGE');
  });

  it('R35: RECEPTION y NURSE cancelan desde cada estado no terminal; guarda cancellation_reason y responde 200 con la atención', async () => {
    for (const [status, token] of [
      ['REGISTERED', rec.token],
      ['WAITING_TRIAGE', nurse.token],
      ['TRIAGED', rec.token],
      ['IN_CARE', nurse.token],
    ] as const) {
      const { id } = await newEncounter();
      await fx.prisma.encounter.update({
        where: { id },
        data: { status, ...forcedTriage(status, nurse.id) },
      });
      clock.set(new Date(NOW.getTime() + 60_000));
      const res = await cancel(
        id,
        { reason: '  DEV-test se retiró sin ser atendido  ' },
        token,
      ).expect(200);
      expect(res.body).toMatchObject({
        id,
        status: 'CANCELLED',
        cancellationReason: 'DEV-test se retiró sin ser atendido',
      });
      clock.set(NOW);
    }
  });

  it('R38: cancelar inserta STATUS_CHANGED con from/to, actor y occurred_at del servidor; el motivo no aparece en eventos ni auditoría', async () => {
    const { id } = await newEncounter();
    const at = new Date(NOW.getTime() + 5 * 60_000);
    clock.set(at);
    await cancel(
      id,
      { reason: 'DEV-test motivo privado de cancelación' },
      nurse.token,
    ).expect(200);
    const last = await fx.prisma.encounterEvent.findFirstOrThrow({
      where: { encounterId: id },
      orderBy: { id: 'desc' },
    });
    expect(last).toMatchObject({
      type: 'STATUS_CHANGED',
      fromStatus: 'WAITING_TRIAGE',
      toStatus: 'CANCELLED',
      actorType: 'STAFF',
      actorId: nurse.id,
      occurredAt: at,
      payload: {},
    });
    const audits = await fx.audits({
      entityId: id,
      action: 'ENCOUNTER_STATUS_CHANGED',
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: 'STAFF',
      actorId: nurse.id,
      tenantId: t.id,
      entity: 'encounter',
      metadata: {
        fromStatus: 'WAITING_TRIAGE',
        toStatus: 'CANCELLED',
        reasonProvided: true,
      },
      occurredAt: at,
    });
    const events = await fx.prisma.encounterEvent.findMany({
      where: { encounterId: id },
    });
    expect(JSON.stringify(events.map((e) => e.payload))).not.toContain(
      'privado',
    );
    expect(JSON.stringify(audits.map((a) => a.metadata))).not.toContain(
      'privado',
    );
  });

  it('R39: si falla la auditoría del cambio de estado se revierte (sigue WAITING_TRIAGE, sin evento) y responde 500', async () => {
    const { id } = await newEncounter();
    const failing = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: AuditService, useClass: FailingAuditService },
      ],
    });
    FailingAuditService.failOn.add('ENCOUNTER_STATUS_CHANGED');
    try {
      await request(failing.getHttpServer())
        .post(`/api/v1/encounters/${id}/cancel`)
        .set('Authorization', `Bearer ${rec.token}`)
        .send({ reason: 'DEV-test' })
        .expect(500);
      const row = await fx.prisma.encounter.findUniqueOrThrow({
        where: { id },
      });
      expect(row).toMatchObject({
        status: 'WAITING_TRIAGE',
        cancellationReason: null,
      });
      expect(
        await fx.prisma.encounterEvent.count({ where: { encounterId: id } }),
      ).toBe(2);
    } finally {
      FailingAuditService.failOn.delete('ENCOUNTER_STATUS_CHANGED');
      await failing.close();
    }
  });

  it('R36: cancelar una atención CLOSED o CANCELLED → 409; inexistente u otro tenant → 404; motivo inválido → 400; sin modificar filas', async () => {
    const a = await newEncounter();
    await cancel(a.id, { reason: 'DEV-test' }).expect(200);
    expect(
      problem(await cancel(a.id, { reason: 'DEV-test' }).expect(409)).status,
    ).toBe(409);
    const b = await newEncounter();
    await fx.prisma.encounter.update({
      where: { id: b.id },
      data: { status: 'CLOSED', ...forcedTriage('CLOSED', nurse.id) },
    });
    await cancel(b.id, { reason: 'DEV-test' }).expect(409);
    expect(
      (await fx.prisma.encounter.findUniqueOrThrow({ where: { id: b.id } }))
        .cancellationReason,
    ).toBeNull();

    const c = await newEncounter();
    const before = await fx.prisma.encounter.findUniqueOrThrow({
      where: { id: c.id },
    });
    for (const r of [
      {},
      { reason: '' },
      { reason: '   ' },
      { reason: 'a'.repeat(501) },
    ]) {
      const res = await cancel(c.id, r).expect(400);
      expect(problem(res).errors?.map((e) => e.field)).toContain('reason');
    }
    expect(
      await fx.prisma.encounter.findUniqueOrThrow({ where: { id: c.id } }),
    ).toEqual(before);
  });

  it('R44: GET /encounters/{id} y POST /encounters/{id}/cancel responden 404 con la misma respuesta de error para otro tenant e inexistente', async () => {
    const recOther = await fx.staff(other.id);
    const po = await fx.patient(other.id);
    const foreign = await fx
      .http('post', '/encounters', recOther.token)
      .send({
        patientId: po.id,
        siteId: other.siteId,
        chiefComplaintText: COMPLAINT,
        complaintSource: 'TYPED',
      })
      .expect(201);
    const foreignId = (foreign.body as { id: string }).id;
    const bodies = new Set<string>();
    for (const id of [
      foreignId,
      '00000000-0000-4000-8000-000000000000',
      'nope',
    ]) {
      for (const res of [
        await fx.http('get', `/encounters/${id}`, rec.token).expect(404),
        await cancel(id, { reason: 'DEV-test' }).expect(404),
      ]) {
        const { status, title, detail } = problem(res);
        bodies.add(JSON.stringify({ status, title, detail }));
      }
    }
    expect(bodies.size).toBe(1);
    expect(
      (
        await fx.prisma.encounter.findUniqueOrThrow({
          where: { id: foreignId },
        })
      ).status,
    ).toBe('WAITING_TRIAGE');
  });

  // ---------------------------------------------------------------- T16: consulta

  it('R42: GET /encounters/{id} devuelve la atención con paciente, preRegisteredAt, registeredBy y la línea de tiempo ordenada por occurred_at e id con el nombre del actor', async () => {
    const p = await fx.patientUser(t.id);
    const pre = await fx.preRegister(p, t.siteId);
    clock.set(new Date(NOW.getTime() + 10 * 60_000));
    const confirmed = await fx
      .http('post', `/pre-registrations/${pre.id}/confirm`, rec.token)
      .send({ identityVerified: true })
      .expect(201);
    const id = (confirmed.body as { id: string }).id;
    clock.set(new Date(NOW.getTime() + 20 * 60_000));
    await cancel(id, { reason: 'DEV-test' }, nurse.token).expect(200);
    // Un evento del sistema (actor sin id) para comprobar el actor SYSTEM.
    await fx.prisma.encounterEvent.create({
      data: {
        tenantId: t.id,
        encounterId: id,
        type: 'DEV_TEST',
        actorType: 'SYSTEM',
        actorId: null,
        occurredAt: new Date(NOW.getTime() + 15 * 60_000),
      },
    });

    for (const role of ['RECEPTION', 'NURSE', 'PHYSICIAN', 'ADMIN'] as const) {
      const viewer = role === 'RECEPTION' ? rec : await fx.staff(t.id, role);
      const res = await fx
        .http('get', `/encounters/${id}`, viewer.token)
        .expect(200);
      const enc = res.body as Record<string, unknown> & {
        events: Record<string, unknown>[];
      };
      expect(Object.keys(enc).sort()).toEqual([
        'arrivalAt',
        'cancellationReason',
        'chiefComplaintText',
        'complaintSource',
        'events',
        // F-05-api (R17): nivel final, hora y responsable del triage (null hasta la decisión).
        'finalLevel',
        'id',
        'origin',
        'patient',
        'preRegisteredAt',
        'preRegistrationId',
        'registeredBy',
        'siteId',
        'siteName',
        'status',
        'triagedAt',
        'triagedBy',
      ]);
      expect(enc).toMatchObject({
        status: 'CANCELLED',
        origin: 'PRE_REGISTRATION',
        preRegistrationId: pre.id,
        preRegisteredAt: NOW.toISOString(),
        arrivalAt: new Date(NOW.getTime() + 10 * 60_000).toISOString(),
        cancellationReason: 'DEV-test',
        registeredBy: { id: rec.id, fullName: rec.fullName },
        patient: { id: p.patientId, documentNumber: p.documentNumber },
      });
      expect(
        enc.events.map((e) => [e.type, e.fromStatus, e.toStatus, e.actor]),
      ).toEqual([
        [
          'ENCOUNTER_CREATED',
          null,
          'REGISTERED',
          { type: 'STAFF', id: rec.id, fullName: rec.fullName },
        ],
        [
          'STATUS_CHANGED',
          'REGISTERED',
          'WAITING_TRIAGE',
          { type: 'STAFF', id: rec.id, fullName: rec.fullName },
        ],
        ['DEV_TEST', null, null, { type: 'SYSTEM', id: null, fullName: null }],
        [
          'STATUS_CHANGED',
          'WAITING_TRIAGE',
          'CANCELLED',
          { type: 'STAFF', id: nurse.id, fullName: nurse.fullName },
        ],
      ]);
      expect(typeof enc.events[0].id).toBe('string');
      expect(Number(enc.events[0].id)).toBeLessThan(Number(enc.events[1].id));
      expect(enc.events[0].occurredAt).toBe(enc.arrivalAt);
    }
  });

  it('R43: GET /encounters lista las atenciones del tenant sin events, por arrival_at e id descendentes, con filtros status/siteId/patientId y limit/offset', async () => {
    const tl = await fx.tenant('f02-enc-list');
    const r = await fx.staff(tl.id);
    const site2 = await fx.site(tl.id, 'DEV-test Sede Sur');
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      clock.set(new Date(NOW.getTime() + i * 60_000));
      const p = await fx.patient(tl.id);
      const res = await fx
        .http('post', '/encounters', r.token)
        .send({
          patientId: p.id,
          siteId: i % 2 ? site2.id : tl.siteId,
          chiefComplaintText: COMPLAINT,
          complaintSource: 'TYPED',
        })
        .expect(201);
      ids.push((res.body as { id: string }).id);
    }
    await fx
      .http('post', `/encounters/${ids[0]}/cancel`, r.token)
      .send({ reason: 'DEV-test' })
      .expect(200);
    const list = async (q = '') =>
      (
        (await fx.http('get', `/encounters${q}`, r.token).expect(200)).body as {
          items: Record<string, unknown>[];
        }
      ).items;

    const all = await list();
    expect(all.map((e) => e.id)).toEqual([...ids].reverse());
    expect(all[0]).not.toHaveProperty('events');
    expect(all[0]).toMatchObject({
      registeredBy: { id: r.id },
      siteName: 'DEV-test Sede Sur',
    });
    expect((await list('?status=CANCELLED')).map((e) => e.id)).toEqual([
      ids[0],
    ]);
    expect((await list(`?siteId=${site2.id}`)).map((e) => e.id)).toEqual([
      ids[3],
      ids[1],
    ]);
    const one = await fx.prisma.encounter.findUniqueOrThrow({
      where: { id: ids[2] },
    });
    expect(
      (await list(`?patientId=${one.patientId}`)).map((e) => e.id),
    ).toEqual([ids[2]]);
    expect((await list('?limit=2')).map((e) => e.id)).toEqual([ids[3], ids[2]]);
    expect((await list('?limit=2&offset=2')).map((e) => e.id)).toEqual([
      ids[1],
      ids[0],
    ]);
    // Otro tenant no ve nada de este.
    const otherRec = await fx.staff(other.id);
    const foreign = (
      await fx.http('get', `/encounters?limit=100`, otherRec.token).expect(200)
    ).body as { items: { id: string }[] };
    expect(foreign.items.map((e) => e.id)).not.toContain(ids[0]);

    for (const q of [
      '?status=OPEN',
      '?siteId=x',
      '?patientId=1',
      '?limit=0',
      '?limit=101',
      '?limit=abc',
      '?offset=-1',
      '?foo=1',
    ]) {
      const res = await fx.http('get', `/encounters${q}`, r.token).expect(400);
      expect(problem(res).status).toBe(400);
    }
  });
});
