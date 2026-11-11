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
});
