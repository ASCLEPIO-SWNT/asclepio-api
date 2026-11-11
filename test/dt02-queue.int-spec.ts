import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { EncountersService } from '../src/modules/encounters/encounters.service.js';
import { createApp } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { F02Fixtures, type Staff } from './int/f02-fixtures.js';
import { F03Fixtures } from './int/f03-fixtures.js';

/** Hora de referencia de la spec (`T` en design.md, "Riesgos y pruebas"). */
const T = new Date('2026-11-11T15:00:00.000Z');
const MIN = 60_000;

interface QueueItemBody {
  encounterId: string;
  status: string;
  finalLevel: number | null;
  waitMinutes: number | null;
  minutesSinceTriage: number | null;
  maxWaitMinutes: number | null;
  overdue: boolean;
}
interface QueueBody {
  serverNow: string;
  waitingTriage: QueueItemBody[];
  triaged: QueueItemBody[];
  inCare: QueueItemBody[];
}

const ids = (items: QueueItemBody[]) => items.map((i) => i.encounterId);

/**
 * DT-02-api: la alerta y el orden de `triaged` se cuentan desde `triaged_at` (Res. 256 de 2016). Las atenciones se
 * clasifican con POST /triage-decision con el reloj fijo en la hora deseada (nunca con setStatus, que usa now() de la
 * base; design.md, riesgo 3).
 */
describe('DT-02: cola desde la clasificación (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  let encounters: EncountersService;
  const clock = new FixedClock(T);
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  let t: { id: string; siteId: string; siteName: string };
  let rec: Staff;
  let nurse: Staff;
  const e: Record<string, string> = {};

  const at = (msFromT: number) => new Date(T.getTime() + msFromT);

  /** Atención registrada en `T + msFromT` (arrival_at = reloj del servidor). */
  async function arriveAt(msFromT: number): Promise<string> {
    clock.set(at(msFromT));
    return f3.encounter(t, rec);
  }

  /** Decisión MANUAL con el reloj en `T + msFromT` (triaged_at = esa hora). */
  async function triageAt(id: string, level: number, msFromT: number) {
    clock.set(at(msFromT));
    await fx
      .http('post', `/encounters/${id}/triage-decision`, nurse.token)
      .send({ action: 'MANUAL', level })
      .expect(201);
  }

  /** GET /queue con el reloj en `T + msFromT` y un token emitido a esa hora (el de beforeAll podría caducar). */
  async function queueAt(
    msFromT: number,
    headers: Record<string, string> = {},
  ): Promise<QueueBody> {
    clock.set(at(msFromT));
    const doc = await fx.staff(t.id, 'PHYSICIAN');
    let req = fx.http('get', '/queue', doc.token);
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    const q = (await req.expect(200)).body as QueueBody;
    expect(q.serverNow).toBe(at(msFromT).toISOString());
    return q;
  }

  const item = (q: QueueBody, id: string) =>
    [...q.waitingTriage, ...q.triaged, ...q.inCare].find(
      (i) => i.encounterId === id,
    )!;

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: GROQ_CLIENT, useValue: fake },
        { provide: OPENROUTER_CLIENT, useValue: fake },
      ],
    });
    fx = new F02Fixtures(app);
    f3 = new F03Fixtures(fx);
    encounters = app.get(EncountersService);
    t = await fx.tenant('dt02-queue');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');

    // Nivel II: llega a T − 90 min y se clasifica a T − 30 min (R3).
    e.l2 = await arriveAt(-90 * MIN);
    await triageAt(e.l2, 2, -30 * MIN);
    // Ejemplo de R5 (nivel II): llega a −50 y se clasifica a −45; llega a −90 y se clasifica a −10.
    e.early = await arriveAt(-50 * MIN);
    await triageAt(e.early, 2, -45 * MIN);
    e.late = await arriveAt(-90 * MIN);
    await triageAt(e.late, 2, -10 * MIN);
    // Nivel I: llega a T − 5 min y se clasifica en T.
    e.l1 = await arriveAt(-5 * MIN);
    await triageAt(e.l1, 1, 0);
    clock.set(T);
  });
  beforeEach(() => clock.set(T));
  afterAll(() => app.close());

  it('R1: listActiveForQueue devuelve triagedAt (la hora de la decisión de triage; null sin clasificar)', async () => {
    const waiting = await arriveAt(-5 * MIN);
    clock.set(T);
    const rows = await encounters.listActiveForQueue(t.id);
    const l2 = rows.find((r) => r.id === e.l2)!;
    expect(l2.triagedAt).toEqual(at(-30 * MIN));
    expect(l2.arrivalAt).toEqual(at(-90 * MIN));
    expect(rows.find((r) => r.id === waiting)!.triagedAt).toBeNull();
    await fx
      .http('post', `/encounters/${waiting}/cancel`, nurse.token)
      .send({ reason: 'DEV-test fin de la prueba R1' })
      .expect(200);
  });

  it('R3: nivel II llegado a T − 90 y clasificado a T − 30: en T no vencida; en T + 1 ms y T + 1 s vencida, con 30 min desde la clasificación', async () => {
    const cases: [number, boolean][] = [
      [0, false],
      [1, true],
      [1000, true],
    ];
    for (const [ms, overdue] of cases) {
      const i = item(await queueAt(ms), e.l2);
      expect([ms, i.status, i.waitMinutes, i.minutesSinceTriage]).toEqual([
        ms,
        'TRIAGED',
        90,
        30,
      ]);
      expect([ms, i.maxWaitMinutes, i.overdue]).toEqual([ms, 30, overdue]);
    }
  });

  it('R3: nivel I clasificado en T: leído en T no vencido; en T + 1 s vencido, con 0 min desde la clasificación', async () => {
    const atT = item(await queueAt(0), e.l1);
    expect(atT).toMatchObject({
      waitMinutes: 5,
      minutesSinceTriage: 0,
      maxWaitMinutes: 0,
      overdue: false,
    });
    const at1s = item(await queueAt(1000), e.l1);
    expect(at1s).toMatchObject({
      waitMinutes: 5,
      minutesSinceTriage: 0,
      maxWaitMinutes: 0,
      overdue: true,
    });
  });

  it('R5: triaged por nivel y, en el nivel II, más tiempo desde la clasificación primero (no la llegada)', async () => {
    const q = await queueAt(0);
    expect(ids(q.triaged)).toEqual([e.l1, e.early, e.l2, e.late]);
    expect(q.triaged.map((i) => [i.waitMinutes, i.minutesSinceTriage])).toEqual(
      [
        [5, 0],
        [50, 45],
        [90, 30],
        [90, 10],
      ],
    );
  });

  it('R6: tras start-care la atención está en inCare sin alerta, sin minutos desde la clasificación ni espera', async () => {
    const id = await arriveAt(-100 * MIN);
    await triageAt(id, 2, -60 * MIN);
    expect(item(await queueAt(0), id)).toMatchObject({
      status: 'TRIAGED',
      minutesSinceTriage: 60,
      overdue: true,
    });
    clock.set(T);
    const doc = await fx.staff(t.id, 'PHYSICIAN');
    await fx
      .http('post', `/encounters/${id}/start-care`, doc.token)
      .expect(200);
    const q = await queueAt(1000);
    expect(ids(q.triaged)).not.toContain(id);
    expect(item(q, id)).toMatchObject({
      status: 'IN_CARE',
      finalLevel: 2,
      waitMinutes: null,
      minutesSinceTriage: null,
      maxWaitMinutes: 30,
      overdue: false,
    });
  });

  it('R9: waitMinutes, minutesSinceTriage y overdue salen del mismo serverNow; las horas del cliente se ignoran', async () => {
    const q = await queueAt(1, {
      Date: 'Mon, 01 Jan 2024 00:00:00 GMT',
      'X-Client-Time': '2026-11-11T14:00:00Z',
    });
    expect(item(q, e.l2)).toMatchObject({
      waitMinutes: 90,
      minutesSinceTriage: 30,
      overdue: true,
    });
    expect(item(q, e.l1)).toMatchObject({
      minutesSinceTriage: 0,
      overdue: true,
    });
    const doc = await fx.staff(t.id, 'PHYSICIAN');
    await fx
      .http('get', `/queue?now=${at(-60 * MIN).toISOString()}`, doc.token)
      .expect(400);
  });
});
