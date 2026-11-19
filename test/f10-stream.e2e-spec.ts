import type { INestApplication } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../src/common/auth/principal.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import type { EncounterStatus } from '../src/modules/encounters/encounter-state-machine.js';
import {
  type ActiveEncounterForQueue,
  type EncounterChange,
  EncountersService,
} from '../src/modules/encounters/encounters.service.js';
import {
  PATIENT_QUEUE_TIMING,
  type StreamTiming,
} from '../src/modules/patient-queue/position-stream.js';
import { createApp } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { isPosition, openSse } from './sse-client.js';

const T = new Date('2026-11-18T15:00:00.000Z');
const TENANT = '22222222-2222-4222-8222-222222222222';
const SITE = '66666666-6666-4666-8666-666666666666';
const OTHER_SITE = '77777777-7777-4777-8777-777777777777';
const MINE = '55555555-5555-4555-8555-555555555555';
const AHEAD = '88888888-8888-4888-8888-888888888888';
const PATIENT = '44444444-4444-4444-8444-444444444444';

function row(
  id: string,
  arrivalMinAgo: number,
  status: EncounterStatus = 'WAITING_TRIAGE',
): ActiveEncounterForQueue {
  return {
    id,
    siteId: SITE,
    siteName: 'DEV-Sede',
    status,
    finalLevel: status === 'WAITING_TRIAGE' ? null : 3,
    arrivalAt: new Date(T.getTime() - arrivalMinAgo * 60_000),
    triagedAt: status === 'WAITING_TRIAGE' ? null : T,
    patient: {
      fullName: 'DEV Persona',
      birthDate: '1980-01-01',
      estimatedAgeYears: null,
      sex: 'F',
    },
  };
}

/** EncountersService falso (sin base): la prueba fija la atención activa, la cola y emite los cambios. */
class FakeEncounters {
  readonly changes = new Subject<EncounterChange>();
  readonly changes$ = this.changes.asObservable();
  active: { id: string; siteId: string; status: EncounterStatus } | null = null;
  rows: ActiveEncounterForQueue[] = [];
  findActiveForPatient = () => Promise.resolve(this.active);
  listActiveForQueue = () => Promise.resolve(this.rows);
  countPhaseExits = () => Promise.resolve(0);

  reset() {
    this.active = { id: MINE, siteId: SITE, status: 'WAITING_TRIAGE' };
    this.rows = [row(AHEAD, 30), row(MINE, 10)];
  }
}

/**
 * F-10-api (T5): GET /patient/queue-position/stream por HTTP real (app.listen), sin base. Los tiempos son los de
 * producción (debounce 1 s); el latido se acorta solo en la prueba de R9.
 */
describe('F-10: stream SSE de la posición (e2e, sin base)', () => {
  let app: INestApplication<App>;
  const clock = new FixedClock(T);
  const fake = new FakeEncounters();
  const llm = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  const timing: StreamTiming = { debounceMs: 1000, heartbeatMs: 60_000 };
  let token: string;

  const patientToken = async () =>
    (
      await app.get(TokenService).issuePatient({
        id: '33333333-3333-4333-8333-333333333333',
        tenantId: TENANT,
        patientId: PATIENT,
      })
    ).accessToken;

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: EncountersService, useValue: fake },
        { provide: PATIENT_QUEUE_TIMING, useValue: timing },
        { provide: GROQ_CLIENT, useValue: llm },
        { provide: OPENROUTER_CLIENT, useValue: llm },
      ],
    });
    await app.listen(0, '127.0.0.1');
    token = await patientToken();
  });
  beforeEach(() => {
    clock.set(T);
    fake.reset();
    timing.heartbeatMs = 60_000;
  });
  afterAll(() => app.close());

  it('R7: responde 200 text/event-stream y emite de inmediato un evento position con la instantánea', async () => {
    const sse = await openSse(app, '/patient/queue-position/stream', token);
    try {
      expect(sse.status).toBe(200);
      expect(sse.headers.get('content-type')).toMatch(/^text\/event-stream/);
      const [first] = await sse.waitFor(isPosition, 1, 1000);
      expect(first.at).toBeLessThan(1000);
      expect(first.data).toEqual({
        phase: 'WAITING_TRIAGE',
        position: 2,
        aheadCount: 1,
        estimate: null,
        estimateBasis: 'INSUFFICIENT_DATA',
        serverNow: T.toISOString(),
      });
    } finally {
      sse.close();
    }
  });

  it('R8: tras un cambio en la sede del paciente emite la nueva instantánea en ≤ 2 s; un cambio de otra sede no emite', async () => {
    const sse = await openSse(app, '/patient/queue-position/stream', token);
    try {
      await sse.waitFor(isPosition, 1, 1000);
      // El de delante pasa a atención (otra sección): el paciente queda primero.
      fake.rows = [row(AHEAD, 30, 'IN_CARE'), row(MINE, 10)];
      fake.changes.next({ tenantId: TENANT, siteId: OTHER_SITE });
      fake.changes.next({
        tenantId: '99999999-9999-4999-8999-999999999999',
        siteId: SITE,
      });
      await new Promise((r) => setTimeout(r, 1500));
      expect(sse.messages.filter(isPosition)).toHaveLength(1);

      const changedAt = Date.now();
      fake.changes.next({ tenantId: TENANT, siteId: SITE });
      const [, second] = await sse.waitFor(isPosition, 2, 2500);
      expect(Date.now() - changedAt).toBeLessThanOrEqual(2000);
      expect(second.data).toMatchObject({ position: 1, aheadCount: 0 });
    } finally {
      sse.close();
    }
  });

  it('R9: sin cambios, cada recálculo periódico envía un comentario de latido y no repite la instantánea', async () => {
    timing.heartbeatMs = 300;
    const sse = await openSse(app, '/patient/queue-position/stream', token);
    try {
      await sse.waitFor((m) => m.comment === 'ping', 2, 2000);
      expect(sse.messages.filter(isPosition)).toHaveLength(1);
      // Si en un recálculo periódico cambió, envía la instantánea en lugar del latido.
      fake.rows = [row(MINE, 10)];
      const [, second] = await sse.waitFor(isPosition, 2, 2000);
      expect(second.data).toMatchObject({ position: 1 });
    } finally {
      sse.close();
    }
  });

  it('R10: cuando la atención termina emite position con phase = DONE y cierra el stream', async () => {
    const sse = await openSse(app, '/patient/queue-position/stream', token);
    await sse.waitFor(isPosition, 1, 1000);
    fake.active = null;
    fake.rows = [row(AHEAD, 30)];
    fake.changes.next({ tenantId: TENANT, siteId: SITE });
    const [, done] = await sse.waitFor(isPosition, 2, 2500);
    expect(done.data).toEqual({
      phase: 'DONE',
      position: null,
      aheadCount: null,
      estimate: null,
      estimateBasis: null,
      serverNow: T.toISOString(),
    });
    await expect(sse.closed).resolves.toBeLessThan(3000);
  });

  it('R10: una nueva atención del paciente tras la que abrió el stream también es DONE', async () => {
    const sse = await openSse(app, '/patient/queue-position/stream', token);
    await sse.waitFor(isPosition, 1, 1000);
    fake.active = {
      id: '12121212-1212-4212-8212-121212121212',
      siteId: SITE,
      status: 'WAITING_TRIAGE',
    };
    fake.changes.next({ tenantId: TENANT, siteId: SITE });
    const [, done] = await sse.waitFor(isPosition, 2, 2500);
    expect(done.data).toMatchObject({ phase: 'DONE' });
    await sse.closed;
  });

  it('R11: cierra el stream cuando vence el token con el que se abrió', async () => {
    // Token emitido en T: vence en T + 8 h. Se abre 1,2 s antes de vencer.
    clock.set(new Date(T.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000 - 1200));
    const sse = await openSse(app, '/patient/queue-position/stream', token);
    expect(sse.status).toBe(200);
    await sse.waitFor(isPosition, 1, 1000);
    const closedAt = await sse.closed;
    expect(closedAt).toBeGreaterThanOrEqual(1000);
    expect(closedAt).toBeLessThan(3000);
    expect(sse.messages.filter((m) => m.event === 'error')).toEqual([]);
  });

  it('R13: un parámetro de consulta en el stream → 400 problem+json antes de abrirlo', async () => {
    for (const q of [`?patientId=${PATIENT}`, '?lastEventId=1']) {
      const sse = await openSse(
        app,
        `/patient/queue-position/stream${q}`,
        token,
      );
      expect([q, sse.status]).toEqual([q, 400]);
      expect(sse.headers.get('content-type')).toMatch(
        /^application\/problem\+json/,
      );
      await sse.closed;
      expect(sse.messages).toEqual([]);
    }
  });

  it('R7: sin atención activa el stream emite NO_ACTIVE y sigue abierto', async () => {
    fake.active = null;
    const sse = await openSse(app, '/patient/queue-position/stream', token);
    try {
      const [first] = await sse.waitFor(isPosition, 1, 1000);
      expect(first.data).toMatchObject({ phase: 'NO_ACTIVE', position: null });
    } finally {
      sse.close();
    }
  });
});
