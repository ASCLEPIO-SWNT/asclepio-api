import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import { createApp, problem } from './e2e-app.js';
import { COMPLAINT, F02Fixtures, type Staff } from './int/f02-fixtures.js';
import { F03Fixtures, REQUIRED_VITALS, VITALS } from './int/f03-fixtures.js';

const T0 = new Date('2026-10-27T12:40:00.000Z');

describe('F-03: consulta de la captura y línea de tiempo (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  const clock = new FixedClock(T0);
  let t: { id: string; siteId: string };
  let other: { id: string; siteId: string };
  let rec: Staff;
  let nurse: Staff;
  let nurse2: Staff;
  let physician: Staff;
  let otherRec: Staff;

  beforeAll(async () => {
    app = await createApp({ overrides: [{ provide: Clock, useValue: clock }] });
    fx = new F02Fixtures(app);
    f3 = new F03Fixtures(fx);
    t = await fx.tenant('f03-cc');
    other = await fx.tenant('f03-cc-other');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
    nurse2 = await fx.staff(t.id, 'NURSE');
    physician = await fx.staff(t.id, 'PHYSICIAN');
    otherRec = await fx.staff(other.id);
  });
  beforeEach(() => clock.set(T0));
  afterAll(() => app.close());

  const capture = (id: string, token = nurse.token) =>
    fx.http('get', `/encounters/${id}/clinical-capture`, token);

  /** Atención con dos tomas y dos capturas de hallazgos de dos enfermeras, en horas distintas. */
  async function scenario(): Promise<string> {
    const id = await f3.encounter(t, rec);
    clock.set(new Date(T0.getTime() + 60_000));
    await fx
      .http('post', `/encounters/${id}/vital-signs`, nurse.token)
      .send(VITALS)
      .expect(201);
    clock.set(new Date(T0.getTime() + 120_000));
    await fx
      .http('post', `/encounters/${id}/symptom-findings`, nurse.token)
      .send({
        items: [
          { kind: 'SYMPTOM', description: 'DEV-test dolor' },
          { kind: 'COMPLAINT_NOTE', description: 'DEV-test desde ayer' },
        ],
      })
      .expect(201);
    clock.set(new Date(T0.getTime() + 180_000));
    await fx
      .http('post', `/encounters/${id}/vital-signs`, nurse2.token)
      .send({ ...REQUIRED_VITALS, heartRate: 96 })
      .expect(201);
    await fx
      .http('post', `/encounters/${id}/symptom-findings`, nurse2.token)
      .send({ items: [{ kind: 'FINDING', description: 'DEV-test palidez' }] })
      .expect(201);
    return id;
  }

  it('R20: NURSE y PHYSICIAN obtienen el motivo original, el estado y todas las tomas y hallazgos ordenados por recordedAt e id, con recordedBy.fullName', async () => {
    const id = await scenario();
    for (const token of [nurse.token, physician.token]) {
      const res = await capture(id, token).expect(200);
      const body = res.body as {
        vitalSigns: { recordedAt: string; heartRate: number }[];
        symptomFindings: {
          id: string;
          recordedAt: string;
          kind: string;
          description: string;
          recordedBy: { fullName: string };
        }[];
      };
      expect(res.body).toMatchObject({
        encounterId: id,
        status: 'WAITING_TRIAGE',
        chiefComplaintText: COMPLAINT,
        complaintSource: 'TYPED',
      });
      expect(body.vitalSigns).toEqual([
        {
          id: expect.any(String) as string,
          encounterId: id,
          ...VITALS,
          recordedAt: new Date(T0.getTime() + 60_000).toISOString(),
          recordedBy: { id: nurse.id, fullName: nurse.fullName },
        },
        {
          id: expect.any(String) as string,
          encounterId: id,
          ...REQUIRED_VITALS,
          heartRate: 96,
          diastolicBp: null,
          glucoseMgDl: null,
          recordedAt: new Date(T0.getTime() + 180_000).toISOString(),
          recordedBy: { id: nurse2.id, fullName: nurse2.fullName },
        },
      ]);
      const f = body.symptomFindings;
      expect(f).toHaveLength(3);
      expect([f[2].kind, f[2].description, f[2].recordedBy.fullName]).toEqual([
        'FINDING',
        'DEV-test palidez',
        nurse2.fullName,
      ]);
      expect(f.slice(0, 2).map((x) => x.recordedBy.fullName)).toEqual([
        nurse.fullName,
        nurse.fullName,
      ]);
      // Los dos primeros comparten recordedAt: el desempate es el id ascendente.
      expect(f[0].recordedAt).toBe(f[1].recordedAt);
      expect(f[0].id < f[1].id).toBe(true);
      expect(
        f
          .slice(0, 2)
          .map((x) => x.kind)
          .sort(),
      ).toEqual(['COMPLAINT_NOTE', 'SYMPTOM']);
      expect(f.map((x) => x.recordedAt)).toEqual(
        [...f.map((x) => x.recordedAt)].sort(),
      );
    }
  });

  it('R20: la captura se lee en cualquier estado, también CANCELLED, y una atención sin captura devuelve listas vacías', async () => {
    const id = await scenario();
    await fx
      .http('post', `/encounters/${id}/cancel`, nurse.token)
      .send({ reason: 'DEV-test se retiró' })
      .expect(200);
    const res = await capture(id, physician.token).expect(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED' });
    const body = res.body as {
      vitalSigns: unknown[];
      symptomFindings: unknown[];
    };
    expect(body.vitalSigns).toHaveLength(2);
    expect(body.symptomFindings).toHaveLength(3);

    const empty = await f3.encounter(t, rec);
    expect((await capture(empty).expect(200)).body).toMatchObject({
      vitalSigns: [],
      symptomFindings: [],
    });
  });

  it('R12: GET /clinical-capture de otro tenant, inexistente o mal formado → el mismo 404', async () => {
    const foreign = await f3.encounter(other, otherRec);
    const seen = new Set<string>();
    for (const id of [
      foreign,
      '00000000-0000-4000-8000-000000000000',
      'zz-mal-formado',
    ]) {
      const p = problem(await capture(id).expect(404));
      seen.add(JSON.stringify([p.title, p.detail, p.status]));
    }
    expect(seen.size).toBe(1);
  });

  it('R17: GET /encounters/{id} incluye VITAL_SIGNS_RECORDED y SYMPTOM_FINDINGS_RECORDED con payload, actor y occurredAt, en orden', async () => {
    const id = await scenario();
    const res = await fx
      .http('get', `/encounters/${id}`, nurse.token)
      .expect(200);
    const events = (
      res.body as {
        events: {
          type: string;
          payload: Record<string, unknown>;
          actor: { type: string; id: string; fullName: string };
          occurredAt: string;
        }[];
      }
    ).events;
    expect(events.map((e) => e.type)).toEqual([
      'ENCOUNTER_CREATED',
      'STATUS_CHANGED',
      'VITAL_SIGNS_RECORDED',
      'SYMPTOM_FINDINGS_RECORDED',
      'VITAL_SIGNS_RECORDED',
      'SYMPTOM_FINDINGS_RECORDED',
    ]);
    expect(events[2]).toEqual({
      id: expect.any(String) as string,
      type: 'VITAL_SIGNS_RECORDED',
      fromStatus: null,
      toStatus: null,
      payload: { vitalSignsId: expect.any(String) as string },
      actor: { type: 'STAFF', id: nurse.id, fullName: nurse.fullName },
      occurredAt: new Date(T0.getTime() + 60_000).toISOString(),
    });
    expect(events[3]).toMatchObject({
      payload: { findingIds: expect.any(Array) as unknown[], count: 2 },
      actor: { id: nurse.id, fullName: nurse.fullName },
      occurredAt: new Date(T0.getTime() + 120_000).toISOString(),
    });
    expect(events[5]).toMatchObject({
      payload: { count: 1 },
      actor: { id: nurse2.id, fullName: nurse2.fullName },
    });
  });
});
