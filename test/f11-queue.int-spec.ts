import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import { EncountersService } from '../src/modules/encounters/encounters.service.js';
import { createApp } from './e2e-app.js';
import {
  F02Fixtures,
  type PatientUser,
  type Staff,
} from './int/f02-fixtures.js';

const T = new Date('2026-11-18T15:00:00.000Z');
const MIN = 60_000;
const BENIGN = 'DEV-test dolor de cabeza desde ayer';

interface QueueItem {
  encounterId: string;
  hasRedFlags: boolean;
}

/** F-11-api (T6): hasRedFlags en listActiveForQueue y GET /queue, orden de waitingTriage y herencia en F-10. */
describe('F-11: señales de alarma en la cola (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  const clock = new FixedClock(T);
  let t: { id: string; siteId: string };
  let rec: Staff;
  let nurse: Staff;

  beforeAll(async () => {
    app = await createApp({ overrides: [{ provide: Clock, useValue: clock }] });
    fx = new F02Fixtures(app);
    t = await fx.tenant('f11-queue');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
  });
  afterAll(() => app.close());

  /** Pre-registro y confirmación (llegada) `minAgo` minutos antes de T. */
  async function arrive(
    p: PatientUser,
    minAgo: number,
    body: Record<string, unknown> = {},
  ): Promise<string> {
    clock.set(new Date(T.getTime() - minAgo * MIN));
    const pre = await fx
      .http('post', '/patient/pre-registrations', p.token)
      .send({
        siteId: t.siteId,
        chiefComplaintText: BENIGN,
        complaintSource: 'TYPED',
        ...body,
      })
      .expect(201);
    const enc = await fx
      .http(
        'post',
        `/pre-registrations/${(pre.body as { id: string }).id}/confirm`,
        rec.token,
      )
      .send({ identityVerified: true })
      .expect(201);
    return (enc.body as { id: string }).id;
  }

  it('R8: waitingTriage pone primero las atenciones con señales, cada elemento lleva hasRedFlags y F-10 hereda la posición', async () => {
    const mine = await fx.patientUser(t.id);
    const mineId = await arrive(mine, 40);
    const flaggedId = await arrive(await fx.patientUser(t.id), 2, {
      interview: {
        engine: 'ON_DEVICE',
        modelId: 'gemma-4-e2b-it',
        turns: [],
        redFlags: ['BREATHING_DIFFICULTY'],
        endedBy: 'RED_FLAG',
      },
    });
    clock.set(T);

    const rows = await app.get(EncountersService).listActiveForQueue(t.id);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.hasRedFlags]))).toEqual({
      [mineId]: false,
      [flaggedId]: true,
    });

    const queue = (await fx.http('get', '/queue', nurse.token).expect(200))
      .body as { waitingTriage: QueueItem[] };
    expect(
      queue.waitingTriage.map((i) => [i.encounterId, i.hasRedFlags]),
    ).toEqual([
      [flaggedId, true],
      [mineId, false],
    ]);

    const position = await fx
      .http('get', '/patient/queue-position', mine.token)
      .expect(200);
    expect(position.body).toMatchObject({
      phase: 'WAITING_TRIAGE',
      position: 2,
      aheadCount: 1,
    });
  });
});
