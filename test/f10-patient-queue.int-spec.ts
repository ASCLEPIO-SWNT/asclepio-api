import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { createApp, problem } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import {
  COMPLAINT,
  F02Fixtures,
  type PatientUser,
  type Staff,
} from './int/f02-fixtures.js';

const T = new Date('2026-11-18T15:00:00.000Z');
const MIN = 60_000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const KEYS = [
  'aheadCount',
  'estimate',
  'estimateBasis',
  'phase',
  'position',
  'serverNow',
];

/** Todas las claves y los valores de texto de un JSON, a cualquier profundidad (búsqueda profunda de R6). */
function walk(v: unknown, keys: string[] = [], strings: string[] = []) {
  if (typeof v === 'string') strings.push(v);
  else if (Array.isArray(v)) v.forEach((x) => walk(x, keys, strings));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      keys.push(k);
      walk(x, keys, strings);
    }
  }
  return { keys, strings };
}

/** F-10-api (T4): GET /patient/queue-position contra la base local. */
describe('F-10: instantánea de la posición del paciente (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  const clock = new FixedClock(T);
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  let t: { id: string; siteId: string; siteName: string };
  let rec: Staff;
  let nurse: Staff;

  const at = (ms: number) => new Date(T.getTime() + ms);

  /** Atención en `siteId` registrada en T + ms; para un paciente con cuenta si se indica. */
  async function arrive(ms: number, p?: PatientUser, siteId = t.siteId) {
    clock.set(at(ms));
    const patientId = p?.patientId ?? (await fx.patient(t.id)).id;
    const res = await fx
      .http('post', '/encounters', rec.token)
      .send({
        patientId,
        siteId,
        chiefComplaintText: COMPLAINT,
        complaintSource: 'TYPED',
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function triage(id: string, level: number, ms: number) {
    clock.set(at(ms));
    await fx
      .http('post', `/encounters/${id}/triage-decision`, nurse.token)
      .send({ action: 'MANUAL', level })
      .expect(201);
  }

  function position(p: PatientUser, ms = 0, query = '') {
    clock.set(at(ms));
    return fx.http('get', `/patient/queue-position${query}`, p.token);
  }

  /** Tenant y sede nuevos por prueba: las posiciones no dependen de las demás. */
  beforeEach(async () => {
    clock.set(T);
    t = await fx.tenant('f10-position');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
  });

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: GROQ_CLIENT, useValue: fake },
        { provide: OPENROUTER_CLIENT, useValue: fake },
      ],
    });
    fx = new F02Fixtures(app);
  });
  afterAll(() => app.close());

  it('R1: responde 200 con la instantánea de la atención activa (WAITING_TRIAGE, posición por la llegada, sin datos suficientes)', async () => {
    const p = await fx.patientUser(t.id);
    await arrive(-30 * MIN); // llegó antes: delante
    await arrive(-10 * MIN, p);
    await arrive(-5 * MIN); // llegó después: detrás
    const res = await position(p).expect(200);
    expect(res.body).toEqual({
      phase: 'WAITING_TRIAGE',
      position: 2,
      aheadCount: 1,
      estimate: null,
      estimateBasis: 'INSUFFICIENT_DATA',
      serverNow: T.toISOString(),
    });
  });

  it('R3: con 5 clasificaciones en las últimas 4 h de la sede, estima el rango (1 delante → 240/5 = 48 → [20, 75])', async () => {
    for (const ms of [-200, -150, -100, -60, -20]) {
      const id = await arrive((ms - 5) * MIN);
      await triage(id, 4, ms * MIN);
    }
    const p = await fx.patientUser(t.id);
    await arrive(-15 * MIN);
    await arrive(-10 * MIN, p);
    const res = await position(p).expect(200);
    expect(res.body).toMatchObject({
      phase: 'WAITING_TRIAGE',
      position: 2,
      aheadCount: 1,
      estimate: { minMinutes: 20, maxMinutes: 75 },
      estimateBasis: 'RECENT_THROUGHPUT',
    });
  });

  it('R2: dos pacientes TRIAGED de nivel III y uno nuevo de nivel II → la posición del III pasa de 1 a 2', async () => {
    const p = await fx.patientUser(t.id);
    const mine = await arrive(-60 * MIN, p);
    await triage(mine, 3, -50 * MIN);
    const other = await arrive(-55 * MIN);
    await triage(other, 3, -40 * MIN);
    const before = (await position(p).expect(200)).body as {
      phase: string;
      position: number;
    };
    expect([before.phase, before.position]).toEqual(['WAITING_CARE', 1]);

    const urgent = await arrive(-5 * MIN);
    await triage(urgent, 2, -1 * MIN);
    const after = (await position(p).expect(200)).body as {
      phase: string;
      position: number;
      aheadCount: number;
    };
    expect([after.phase, after.position, after.aheadCount]).toEqual([
      'WAITING_CARE',
      2,
      1,
    ]);
  });

  it('R2: la posición se calcula solo con las atenciones de la sede de la atención del paciente', async () => {
    const south = await fx.site(t.id, 'DEV-test Sede Sur');
    const p = await fx.patientUser(t.id);
    await arrive(-90 * MIN, undefined, south.id); // otra sede: no cuenta
    await arrive(-10 * MIN, p);
    const res = await position(p).expect(200);
    expect(res.body).toMatchObject({ position: 1, aheadCount: 0 });
  });

  it('R5: sin atención activa (también con un pre-registro pendiente) → 200 NO_ACTIVE con todo en null', async () => {
    const p = await fx.patientUser(t.id);
    const expected = {
      phase: 'NO_ACTIVE',
      position: null,
      aheadCount: null,
      estimate: null,
      estimateBasis: null,
      serverNow: T.toISOString(),
    };
    expect((await position(p).expect(200)).body).toEqual(expected);
    await fx.preRegister(p, t.siteId);
    expect((await position(p).expect(200)).body).toEqual(expected);
  });

  it('R5: en atención (IN_CARE) la fase es CALLED, sin posición ni estimación', async () => {
    const p = await fx.patientUser(t.id);
    const id = await arrive(-30 * MIN, p);
    await triage(id, 3, -20 * MIN);
    clock.set(at(-10 * MIN));
    const doc = await fx.staff(t.id, 'PHYSICIAN');
    await fx
      .http('post', `/encounters/${id}/start-care`, doc.token)
      .expect(200);
    expect((await position(p).expect(200)).body).toMatchObject({
      phase: 'CALLED',
      position: null,
      aheadCount: null,
      estimate: null,
      estimateBasis: null,
    });
  });

  it('R6: búsqueda profunda: la respuesta no tiene ids (de atención, sede, paciente ni otros), niveles ni nombres', async () => {
    const a = await fx.patientUser(t.id, { fullName: 'DEV-test Ana Rivera' });
    const b = await fx.patientUser(t.id, { fullName: 'DEV-test Beto Suárez' });
    const ea = await arrive(-40 * MIN, a);
    const eb = await arrive(-30 * MIN, b);
    await triage(ea, 2, -20 * MIN);
    await triage(eb, 1, -10 * MIN);
    for (const [p, own, other] of [
      [a, ea, eb],
      [b, eb, ea],
    ] as const) {
      const res = await position(p).expect(200);
      const text = res.text;
      const { keys, strings } = walk(res.body);
      expect(Object.keys(res.body as object).sort()).toEqual(KEYS);
      expect(
        keys.filter((k) => /level|id$|Id$|name|site|patient/i.test(k)),
      ).toEqual([]);
      expect(strings.filter((s) => UUID.test(s))).toEqual([]);
      for (const secret of [
        own,
        other,
        t.id,
        t.siteId,
        t.siteName,
        a.patientId,
        b.patientId,
        a.documentNumber,
        b.documentNumber,
        'Ana',
        'Beto',
      ]) {
        expect([secret, text.includes(secret)]).toEqual([secret, false]);
      }
    }
    // B (nivel I) va delante de A (nivel II) aunque se clasificó después; A no ve el nivel de nadie.
    expect((await position(a).expect(200)).body).toMatchObject({
      position: 2,
    });
  });

  it('R13: un parámetro de consulta → 400 problem+json, también uno que intente elegir el paciente', async () => {
    const p = await fx.patientUser(t.id);
    const other = await fx.patientUser(t.id);
    await arrive(-10 * MIN, other);
    for (const q of [
      `?patientId=${other.patientId}`,
      '?encounterId=x',
      '?now=2026-01-01T00:00:00Z',
    ]) {
      const res = await position(p, 0, q);
      expect([q, res.status]).toEqual([q, 400]);
      expect(problem(res).errors?.length).toBeGreaterThan(0);
    }
  });
});
