import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { createApp } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { COMPLAINT, F02Fixtures } from './int/f02-fixtures.js';
import { CapturingLogger } from './int/fixtures.js';
import { isPosition, openSse } from './sse-client.js';

const T = new Date('2026-11-18T15:00:00.000Z');
const FULL_NAME = 'DEV-test Gumersinda Quintero Ospina';

/** F-10-api (T6): los logs del flujo no llevan datos del paciente (R13, RNF-05, RNF-11). */
describe('F-10: logs sin datos del paciente (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  const clock = new FixedClock(T);
  const logger = new CapturingLogger();
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: GROQ_CLIENT, useValue: fake },
        { provide: OPENROUTER_CLIENT, useValue: fake },
      ],
      logger,
    });
    await app.listen(0, '127.0.0.1');
    fx = new F02Fixtures(app);
  });
  afterAll(() => app.close());

  it('R13: GET y stream registran solo el tenant y la fase: ni nombre, documento, ids del paciente o de la atención, ni sede', async () => {
    const t = await fx.tenant('f10-privacy');
    const rec = await fx.staff(t.id);
    const p = await fx.patientUser(t.id, { fullName: FULL_NAME });
    const encounterId = (
      (
        await fx
          .http('post', '/encounters', rec.token)
          .send({
            patientId: p.patientId,
            siteId: t.siteId,
            chiefComplaintText: COMPLAINT,
            complaintSource: 'TYPED',
          })
          .expect(201)
      ).body as { id: string }
    ).id;
    const start = logger.lines.length;

    await fx.http('get', '/patient/queue-position', p.token).expect(200);
    const sse = await openSse(app, '/patient/queue-position/stream', p.token);
    await sse.waitFor(isPosition, 1, 2000);
    sse.close();
    await new Promise((r) => setTimeout(r, 100));

    const text = logger.lines.slice(start).join('\n');
    expect(text).toContain('patient_queue_read');
    expect(text).toContain('patient_queue_stream_opened');
    for (const secret of [
      FULL_NAME,
      'Gumersinda',
      p.documentNumber,
      p.patientId,
      p.accountId,
      encounterId,
      t.siteId,
      COMPLAINT,
    ]) {
      expect([secret, text.includes(secret)]).toEqual([secret, false]);
    }
  });
});
