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
import { COMPLAINT, F02Fixtures, type Staff } from './int/f02-fixtures.js';

const T = new Date('2026-11-18T15:00:00.000Z');
const MIN = 60_000;
const WINDOW_START = new Date(T.getTime() - 240 * MIN);

/** F-10-api (T2): lecturas de EncountersService para la posición del paciente. */
describe('F-10: findActiveForPatient y countPhaseExits (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let encounters: EncountersService;
  const clock = new FixedClock(T);
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  let t: { id: string; siteId: string };
  let rec: Staff;
  let nurse: Staff;

  const at = (ms: number) => new Date(T.getTime() + ms);

  async function arrive(siteId: string, ms: number, patientId?: string) {
    clock.set(at(ms));
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
    return (res.body as { id: string }).id;
  }

  async function triage(id: string, ms: number, level = 3) {
    clock.set(at(ms));
    await fx
      .http('post', `/encounters/${id}/triage-decision`, nurse.token)
      .send({ action: 'MANUAL', level })
      .expect(201);
  }

  async function startCare(id: string, ms: number) {
    clock.set(at(ms));
    const doc = await fx.staff(t.id, 'PHYSICIAN');
    await fx
      .http('post', `/encounters/${id}/start-care`, doc.token)
      .expect(200);
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
    encounters = app.get(EncountersService);
    t = await fx.tenant('f10-source');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
  });
  beforeEach(() => clock.set(T));
  afterAll(() => app.close());

  it('R13: findActiveForPatient devuelve la atención activa del paciente solo con su tenant y patientId; nunca la de otro tenant', async () => {
    const p = await fx.patientUser(t.id);
    expect(await encounters.findActiveForPatient(t.id, p.patientId)).toBeNull();
    const id = await arrive(t.siteId, -10 * MIN, p.patientId);
    expect(await encounters.findActiveForPatient(t.id, p.patientId)).toEqual({
      id,
      siteId: t.siteId,
      status: 'WAITING_TRIAGE',
    });
    const other = await fx.tenant('f10-source-other');
    expect(
      await encounters.findActiveForPatient(other.id, p.patientId),
    ).toBeNull();
    await triage(id, -5 * MIN);
    expect(
      (await encounters.findActiveForPatient(t.id, p.patientId))?.status,
    ).toBe('TRIAGED');
    await startCare(id, -1 * MIN);
    expect(
      (await encounters.findActiveForPatient(t.id, p.patientId))?.status,
    ).toBe('IN_CARE');
  });

  it('R1: findActiveForPatient devuelve null cuando la atención terminó (CANCELLED) y con un patientId que no es UUID', async () => {
    const p = await fx.patientUser(t.id);
    const id = await arrive(t.siteId, -10 * MIN, p.patientId);
    clock.set(T);
    await fx
      .http('post', `/encounters/${id}/cancel`, nurse.token)
      .send({ reason: 'DEV-test fin de la prueba' })
      .expect(200);
    expect(await encounters.findActiveForPatient(t.id, p.patientId)).toBeNull();
    expect(await encounters.findActiveForPatient(t.id, 'no-uuid')).toBeNull();
  });

  it('R3: countPhaseExits cuenta, por sede y en [serverNow − 4 h, serverNow], las clasificaciones (WAITING_TRIAGE) y los pasos a IN_CARE (WAITING_CARE)', async () => {
    // Tenant propio: los recuentos no se mezclan con las otras pruebas.
    const local = { t, rec, nurse };
    const s = await fx.tenant('f10-source-count');
    t = { id: s.id, siteId: s.siteId };
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
    const otherSite = (await fx.site(t.id, 'DEV-test Sede Sur')).id;
    try {
      // Clasificadas dentro de la ventana (bordes incluidos), fuera y en otra sede.
      const inside = [
        await arrive(t.siteId, -300 * MIN),
        await arrive(t.siteId, -100 * MIN),
        await arrive(t.siteId, -10 * MIN),
      ];
      await triage(inside[0], -240 * MIN);
      await triage(inside[1], -60 * MIN);
      await triage(inside[2], 0);
      const old = await arrive(t.siteId, -300 * MIN);
      await triage(old, -240 * MIN - 1);
      const elsewhere = await arrive(otherSite, -30 * MIN);
      await triage(elsewhere, -20 * MIN);
      await arrive(t.siteId, -5 * MIN); // sin clasificar: no cuenta
      // Pasos a IN_CARE: dos en la ventana, uno antes y otro en la otra sede.
      await startCare(inside[0], -239 * MIN);
      await startCare(inside[1], -1);
      await startCare(old, -240 * MIN - 1);
      await startCare(elsewhere, -2 * MIN);

      const count = (
        siteId: string,
        phase: 'WAITING_TRIAGE' | 'WAITING_CARE',
      ) => encounters.countPhaseExits(t.id, siteId, phase, WINDOW_START, T);
      expect(await count(t.siteId, 'WAITING_TRIAGE')).toBe(3);
      expect(await count(t.siteId, 'WAITING_CARE')).toBe(2);
      expect(await count(otherSite, 'WAITING_TRIAGE')).toBe(1);
      expect(await count(otherSite, 'WAITING_CARE')).toBe(1);
      // Una sede de otro tenant no cuenta nada.
      expect(
        await encounters.countPhaseExits(
          local.t.id,
          t.siteId,
          'WAITING_TRIAGE',
          WINDOW_START,
          T,
        ),
      ).toBe(0);
      // Lo posterior a serverNow tampoco cuenta.
      expect(
        await encounters.countPhaseExits(
          t.id,
          t.siteId,
          'WAITING_TRIAGE',
          WINDOW_START,
          at(-1),
        ),
      ).toBe(2);
    } finally {
      ({ t, rec, nurse } = local);
    }
  });
});
