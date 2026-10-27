import { Injectable, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import type { PrismaTx } from '../src/common/prisma/prisma.service.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import {
  EncounterEventsService,
  type NewEncounterEvent,
} from '../src/modules/encounters/encounter-events.service.js';
import { VITAL_SIGN_DEFINITIONS } from '../src/modules/encounters/vital-signs.rules.js';
import { createApp, problem } from './e2e-app.js';
import { appClient } from './int/db.js';
import { FailingAuditService } from './int/failing-audit.js';
import { F02Fixtures, type Staff } from './int/f02-fixtures.js';
import {
  F03Fixtures,
  NOTHING,
  REQUIRED_VITALS,
  VITALS,
} from './int/f03-fixtures.js';

const NOW = new Date('2026-10-27T12:42:00.000Z');

/** EncounterEventsService de prueba que falla al insertar los eventos de F-03 (R16). */
@Injectable()
class FailingEventsService extends EncounterEventsService {
  async append(e: NewEncounterEvent, tx: PrismaTx): Promise<void> {
    if (
      e.type === 'VITAL_SIGNS_RECORDED' ||
      e.type === 'SYMPTOM_FINDINGS_RECORDED'
    ) {
      throw new Error('encounter_events no disponible (simulado)');
    }
    return super.append(e, tx);
  }
}

describe('F-03: toma de signos vitales (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  const clock = new FixedClock(NOW);
  let t: { id: string; siteId: string };
  let other: { id: string; siteId: string };
  let rec: Staff;
  let nurse: Staff;
  let otherRec: Staff;

  beforeAll(async () => {
    app = await createApp({ overrides: [{ provide: Clock, useValue: clock }] });
    fx = new F02Fixtures(app);
    f3 = new F03Fixtures(fx);
    t = await fx.tenant('f03-vs');
    other = await fx.tenant('f03-vs-other');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
    otherRec = await fx.staff(other.id);
  });
  beforeEach(() => clock.set(NOW));
  afterAll(() => app.close());

  const post = (id: string, body: object, token = nurse.token) =>
    fx.http('post', `/encounters/${id}/vital-signs`, token).send(body);

  it('R1: inserta una fila con tenant del token, recorded_at del servidor y recorded_by del token, y responde 201 con la toma', async () => {
    const id = await f3.encounter(t, rec);
    const res = await post(id, VITALS).expect(201);
    const body = res.body as { id: string };
    expect(res.body).toEqual({
      id: body.id,
      encounterId: id,
      ...VITALS,
      recordedAt: NOW.toISOString(),
      recordedBy: { id: nurse.id, fullName: nurse.fullName },
    });
    const row = await fx.prisma.vitalSign.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(row).toMatchObject({
      tenantId: t.id,
      encounterId: id,
      recordedAt: NOW,
      recordedBy: nurse.id,
      heartRate: VITALS.heartRate,
      consciousness: 'A',
      supplementalOxygen: false,
    });
    expect(row.temperatureC?.toString()).toBe('37.4');
  });

  it('R1: los signos opcionales no enviados (o null) quedan NULL y la respuesta los devuelve null', async () => {
    const id = await f3.encounter(t, rec);
    const res = await post(id, {
      ...REQUIRED_VITALS,
      glucoseMgDl: null,
    }).expect(201);
    expect(res.body).toMatchObject({ diastolicBp: null, glucoseMgDl: null });
    const row = await fx.prisma.vitalSign.findUniqueOrThrow({
      where: { id: (res.body as { id: string }).id },
    });
    expect(row).toMatchObject({ diastolicBp: null, glucoseMgDl: null });
  });

  it('R2: N tomas secuenciales y simultáneas sobre la misma atención dejan N filas con sus valores originales', async () => {
    const id = await f3.encounter(t, rec);
    const first = await post(id, VITALS).expect(201);
    clock.advance(60_000);
    await post(id, { ...VITALS, heartRate: 98 }).expect(201);
    const parallel = await Promise.all(
      [101, 102, 103].map((hr) => post(id, { ...VITALS, heartRate: hr })),
    );
    expect(parallel.map((r) => r.status)).toEqual([201, 201, 201]);
    const rows = await fx.prisma.vitalSign.findMany({
      where: { encounterId: id },
    });
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.heartRate).sort()).toEqual([
      101, 102, 103, 112, 98,
    ]);
    const original = rows.find(
      (r) => r.id === (first.body as { id: string }).id,
    );
    expect(original).toMatchObject({ heartRate: 112, recordedAt: NOW });
  });

  it('R4: una toma a la que le faltan obligatorios responde 422 con un error por cada uno, sin filas, eventos ni auditoría', async () => {
    const id = await f3.encounter(t, rec);
    const partial: Record<string, unknown> = { ...VITALS };
    delete partial.heartRate;
    delete partial.consciousness;
    const res = await post(id, partial).expect(422);
    expect(
      problem(res)
        .errors?.map((e) => e.field)
        .sort(),
    ).toEqual(['consciousness', 'heartRate']);
    const empty = await post(id, {}).expect(422);
    expect(problem(empty).errors).toHaveLength(
      VITAL_SIGN_DEFINITIONS.filter((d) => d.required).length,
    );
    expect(await f3.counts(id)).toEqual(NOTHING);
  });

  it('R5: un único signo fuera de rango con el resto válido rechaza la toma entera (422 con field y rango, sin el valor), sin filas, eventos ni auditoría', async () => {
    const id = await f3.encounter(t, rec);
    const res = await post(id, { ...VITALS, oxygenSaturation: 49 }).expect(422);
    const p = problem(res);
    expect(p.errors?.map((e) => e.field)).toEqual(['oxygenSaturation']);
    expect(p.errors?.[0].message).toContain('50–100');
    expect(JSON.stringify([p.detail, p.errors])).not.toContain('49');
    const many = await post(id, {
      ...VITALS,
      heartRate: 301,
      temperatureC: 45.1,
    }).expect(422);
    expect(
      problem(many)
        .errors?.map((e) => e.field)
        .sort(),
    ).toEqual(['heartRate', 'temperatureC']);
    expect(await f3.counts(id)).toEqual(NOTHING);
  });

  it('R6: sistólica igual o menor que la diastólica responde 422 con systolicBp y diastolicBp, sin filas', async () => {
    const id = await f3.encounter(t, rec);
    for (const [s, d] of [
      [100, 100],
      [90, 100],
    ]) {
      const res = await post(id, {
        ...VITALS,
        systolicBp: s,
        diastolicBp: d,
      }).expect(422);
      expect(problem(res).errors?.map((e) => e.field)).toEqual([
        'systolicBp',
        'diastolicBp',
      ]);
    }
    expect(await f3.counts(id)).toEqual(NOTHING);
  });

  it('R11: en REGISTERED, TRIAGED, IN_CARE, CLOSED y CANCELLED responde 409 sin filas, eventos ni auditoría', async () => {
    for (const status of [
      'REGISTERED',
      'TRIAGED',
      'IN_CARE',
      'CLOSED',
      'CANCELLED',
    ] as const) {
      const id = await f3.encounter(t, rec);
      await f3.setStatus(id, status);
      const res = await post(id, VITALS);
      expect([status, res.status]).toEqual([status, 409]);
      expect(problem(res).status).toBe(409);
      expect(await f3.counts(id)).toEqual(NOTHING);
    }
  });

  it('R11: si una cancelación de la misma atención se confirma antes que la captura (también mientras la captura espera el bloqueo), la captura responde 409', async () => {
    const id = await f3.encounter(t, rec);
    await fx
      .http('post', `/encounters/${id}/cancel`, nurse.token)
      .send({ reason: 'DEV-test se retiró' })
      .expect(200);
    await post(id, VITALS).expect(409);

    // Carrera: la cancelación tiene la fila bloqueada; la captura espera y, al confirmarse la cancelación, responde 409.
    const id2 = await f3.encounter(t, rec);
    const db = await appClient();
    try {
      await db.query('BEGIN');
      await db.query(
        `UPDATE asclepio.encounters SET status = 'CANCELLED', cancellation_reason = 'DEV-test' WHERE id = $1`,
        [id2],
      );
      const pending = post(id2, VITALS).then((r) => r.status);
      await new Promise((r) => setTimeout(r, 300));
      await db.query('COMMIT');
      expect(await pending).toBe(409);
    } finally {
      await db.end();
    }
    expect(await f3.counts(id2)).toEqual(NOTHING);
  });

  it('R12: atención de otro tenant, inexistente o id mal formado → el mismo 404, sin filas', async () => {
    const foreign = await f3.encounter(other, otherRec);
    const bodies = [];
    for (const id of [
      foreign,
      '00000000-0000-4000-8000-000000000000',
      'no-es-un-uuid',
    ]) {
      const res = await post(id, VITALS).expect(404);
      const p = problem(res);
      bodies.push([p.title, p.detail, p.status]);
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(await f3.counts(foreign)).toEqual(NOTHING);
  });

  it('R14: inserta en la misma transacción VITAL_SIGNS_RECORDED (sin from/to, payload { vitalSignsId }) y la auditoría', async () => {
    const id = await f3.encounter(t, rec);
    const vsId = ((await post(id, VITALS).expect(201)).body as { id: string })
      .id;
    const events = await fx.prisma.encounterEvent.findMany({
      where: { encounterId: id, type: 'VITAL_SIGNS_RECORDED' },
    });
    expect(events).toEqual([
      expect.objectContaining({
        tenantId: t.id,
        fromStatus: null,
        toStatus: null,
        payload: { vitalSignsId: vsId },
        actorType: 'STAFF',
        actorId: nurse.id,
        occurredAt: NOW,
      }),
    ]);
    const audits = await fx.audits({
      entityId: vsId,
      action: 'VITAL_SIGNS_RECORDED',
    });
    expect(audits).toEqual([
      expect.objectContaining({
        actorType: 'STAFF',
        actorId: nurse.id,
        tenantId: t.id,
        entity: 'vital_signs',
        entityId: vsId,
        metadata: { encounterId: id },
        occurredAt: NOW,
      }),
    ]);
    // El bloqueo (D5) actualiza updated_at con la hora del servidor; el motivo y el estado no cambian.
    expect(
      await fx.prisma.encounter.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ status: 'WAITING_TRIAGE', updatedAt: NOW });
  });

  it('R16: si falla la auditoría o el evento se revierte todo (sin filas en vital_signs) y responde 500 problem+json', async () => {
    for (const override of [
      { provide: AuditService, useClass: FailingAuditService },
      { provide: EncounterEventsService, useClass: FailingEventsService },
    ]) {
      const failing = await createApp({
        overrides: [{ provide: Clock, useValue: clock }, override],
      });
      FailingAuditService.failOn.add('VITAL_SIGNS_RECORDED');
      try {
        const id = await f3.encounter(t, rec);
        const res = await request(failing.getHttpServer())
          .post(`/api/v1/encounters/${id}/vital-signs`)
          .set('Authorization', `Bearer ${nurse.token}`)
          .send(VITALS)
          .expect(500);
        expect(problem(res).detail).toBe('Error interno.');
        expect(await f3.counts(id)).toEqual(NOTHING);
        expect(
          (await fx.prisma.encounter.findUniqueOrThrow({ where: { id } }))
            .updatedAt,
        ).not.toEqual(NOW);
      } finally {
        FailingAuditService.failOn.delete('VITAL_SIGNS_RECORDED');
        await failing.close();
      }
    }
  });
});
