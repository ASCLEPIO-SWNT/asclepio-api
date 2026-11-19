import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import { createApp } from './e2e-app.js';
import {
  F02Fixtures,
  type PatientUser,
  type Staff,
} from './int/f02-fixtures.js';

const NOW = new Date('2026-11-18T15:00:00.000Z');
const MIN = 60_000;
const BENIGN = 'DEV-test dolor de cabeza desde ayer';

const interview = (over: Record<string, unknown> = {}) => ({
  engine: 'SERVER',
  modelId: 'openai/gpt-oss-120b',
  turns: [
    {
      dimension: 'ONSET',
      question: '¿Cuándo empezaron tus síntomas?',
      answer: 'DEV-test ayer',
    },
  ],
  redFlags: [],
  endedBy: 'PATIENT',
  ...over,
});

interface PendingItem {
  id: string;
  symptomInterview: unknown;
  redFlags: string[];
}

/** F-11-api (T5): symptomInterview y redFlags en las vistas del personal y orden de la bandeja. */
describe('F-11: vistas del personal y orden de la bandeja (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  const clock = new FixedClock(NOW);
  let rec: Staff;

  beforeAll(async () => {
    app = await createApp({ overrides: [{ provide: Clock, useValue: clock }] });
    fx = new F02Fixtures(app);
  });
  beforeEach(() => clock.set(NOW));
  afterAll(() => app.close());

  async function preRegister(
    siteId: string,
    p: PatientUser,
    body: Record<string, unknown>,
    atMs = 0,
  ): Promise<string> {
    clock.set(new Date(NOW.getTime() + atMs));
    const res = await fx
      .http('post', '/patient/pre-registrations', p.token)
      .send({
        siteId,
        chiefComplaintText: BENIGN,
        complaintSource: 'TYPED',
        ...body,
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  const pending = async (token: string) =>
    (await fx.http('get', '/pre-registrations', token).expect(200))
      .body as PendingItem[];

  it('R6: cada elemento de la bandeja lleva symptomInterview (o null) y redFlags', async () => {
    const t = await fx.tenant('f11-views-tray');
    rec = await fx.staff(t.id);
    const sent = interview({ redFlags: ['SEIZURE'] });
    const withIt = await preRegister(t.siteId, await fx.patientUser(t.id), {
      interview: sent,
    });
    const without = await preRegister(
      t.siteId,
      await fx.patientUser(t.id),
      {},
      MIN,
    );
    const items = await pending(rec.token);
    expect(items.find((i) => i.id === withIt)).toMatchObject({
      symptomInterview: sent,
      redFlags: ['SEIZURE'],
    });
    expect(items.find((i) => i.id === without)).toMatchObject({
      symptomInterview: null,
      redFlags: [],
    });
  });

  it('R6: GET /encounters/{id} lleva symptomInterview y redFlags (null y [] en una atención DIRECT)', async () => {
    const t = await fx.tenant('f11-views-enc');
    rec = await fx.staff(t.id);
    const nurse = await fx.staff(t.id, 'NURSE');
    const sent = interview({ redFlags: ['CHEST_PAIN'] });
    const preId = await preRegister(t.siteId, await fx.patientUser(t.id), {
      interview: sent,
    });
    const confirmed = await fx
      .http('post', `/pre-registrations/${preId}/confirm`, rec.token)
      .send({ identityVerified: true })
      .expect(201);
    expect(confirmed.body).toMatchObject({
      symptomInterview: sent,
      redFlags: ['CHEST_PAIN'],
    });
    const encId = (confirmed.body as { id: string }).id;
    const got = await fx
      .http('get', `/encounters/${encId}`, nurse.token)
      .expect(200);
    expect(got.body).toMatchObject({
      symptomInterview: sent,
      redFlags: ['CHEST_PAIN'],
    });

    const other = await fx.patient(t.id);
    const direct = await fx
      .http('post', '/encounters', rec.token)
      .send({
        patientId: other.id,
        siteId: t.siteId,
        chiefComplaintText: BENIGN,
        complaintSource: 'TYPED',
      })
      .expect(201);
    expect(direct.body).toMatchObject({ symptomInterview: null, redFlags: [] });
  });

  it('R7: la bandeja pone primero los pre-registros con redFlags y después el orden actual (pre_registered_at ascendente)', async () => {
    const t = await fx.tenant('f11-views-order');
    rec = await fx.staff(t.id);
    const a = await preRegister(t.siteId, await fx.patientUser(t.id), {}, 0);
    const b = await preRegister(
      t.siteId,
      await fx.patientUser(t.id),
      { interview: interview({ redFlags: ['STROKE_SIGNS'] }) },
      MIN,
    );
    const c = await preRegister(
      t.siteId,
      await fx.patientUser(t.id),
      {},
      2 * MIN,
    );
    // Sin entrevista, pero el motivo activa las reglas del servidor (R4).
    const d = await preRegister(
      t.siteId,
      await fx.patientUser(t.id),
      { chiefComplaintText: 'DEV-test me desmayé en el trabajo' },
      3 * MIN,
    );
    clock.set(new Date(NOW.getTime() + 4 * MIN));
    expect((await pending(rec.token)).map((i) => i.id)).toEqual([b, d, a, c]);
  });
});
