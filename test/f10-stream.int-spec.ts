import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { createApp } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { COMPLAINT, F02Fixtures, type Staff } from './int/f02-fixtures.js';
import { isPosition, openSse } from './sse-client.js';

const T = new Date('2026-11-18T15:00:00.000Z');
const MIN = 60_000;

/** F-10-api (T5): el stream con transiciones reales de la API sobre la base local (R8, R10). */
describe('F-10: stream SSE con transiciones reales (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  const clock = new FixedClock(T);
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  let t: { id: string; siteId: string };
  let south: string;
  let rec: Staff;
  let nurse: Staff;

  async function arrive(ms: number, siteId: string, patientId?: string) {
    clock.set(new Date(T.getTime() + ms));
    const pid = patientId ?? (await fx.patient(t.id)).id;
    const res = await fx
      .http('post', '/encounters', rec.token)
      .send({
        patientId: pid,
        siteId,
        chiefComplaintText: COMPLAINT,
        complaintSource: 'TYPED',
      })
      .expect(201);
    clock.set(T);
    return (res.body as { id: string }).id;
  }

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: GROQ_CLIENT, useValue: fake },
        { provide: OPENROUTER_CLIENT, useValue: fake },
      ],
    });
    await app.listen(0, '127.0.0.1');
    fx = new F02Fixtures(app);
    t = await fx.tenant('f10-stream');
    south = (await fx.site(t.id, 'DEV-test Sede Sur')).id;
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
  });
  afterAll(() => app.close());

  it('R8: clasificar al de delante emite la nueva posición en ≤ 2 s; un registro en otra sede no emite; R10: al cancelar, DONE y cierre', async () => {
    const p = await fx.patientUser(t.id);
    const ahead = await arrive(-30 * MIN, t.siteId);
    const mine = await arrive(-10 * MIN, t.siteId, p.patientId);
    const sse = await openSse(app, '/patient/queue-position/stream', p.token);
    try {
      expect(sse.status).toBe(200);
      const [first] = await sse.waitFor(isPosition, 1, 2000);
      expect(first.data).toMatchObject({
        phase: 'WAITING_TRIAGE',
        position: 2,
      });

      await arrive(-60 * MIN, south); // otra sede: no cambia la posición ni emite
      await new Promise((r) => setTimeout(r, 1500));
      expect(sse.messages.filter(isPosition)).toHaveLength(1);

      const changedAt = Date.now();
      await fx
        .http('post', `/encounters/${ahead}/triage-decision`, nurse.token)
        .send({ action: 'MANUAL', level: 2 })
        .expect(201);
      const [, second] = await sse.waitFor(isPosition, 2, 3000);
      expect(Date.now() - changedAt).toBeLessThanOrEqual(2000);
      expect(second.data).toMatchObject({
        phase: 'WAITING_TRIAGE',
        position: 1,
        aheadCount: 0,
      });

      await fx
        .http('post', `/encounters/${mine}/cancel`, nurse.token)
        .send({ reason: 'DEV-test fin de la prueba' })
        .expect(200);
      const [, , done] = await sse.waitFor(isPosition, 3, 3000);
      expect(done.data).toMatchObject({ phase: 'DONE', position: null });
      await sse.closed;
    } finally {
      sse.close();
    }
  });
});
