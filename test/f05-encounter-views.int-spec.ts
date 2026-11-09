import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { createApp } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { F02Fixtures, type Staff } from './int/f02-fixtures.js';
import { F03Fixtures } from './int/f03-fixtures.js';

const NOW = new Date('2026-11-09T21:00:00.000Z');

/** Claves de un objeto JSON a cualquier profundidad. */
function deepKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => deepKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      deepKeys(v, out);
    }
  }
  return out;
}

describe('F-05: la decisión en las vistas de la atención (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  const clock = new FixedClock(NOW);
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  let t: { id: string; siteId: string };
  let rec: Staff;
  let nurse: Staff;
  let physician: Staff;

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
    t = await fx.tenant('f05-views');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
    physician = await fx.staff(t.id, 'PHYSICIAN');
  });
  beforeEach(() => clock.set(NOW));
  afterAll(() => app.close());

  it('R17: GET /encounters y GET /encounters/{id} incluyen finalLevel, triagedAt y triagedBy (null antes de decidir) y el evento TRIAGE_DECIDED', async () => {
    const id = await f3.encounter(t, rec);
    const one = () =>
      fx.http('get', `/encounters/${id}`, physician.token).expect(200);
    const listed = async () =>
      (
        (
          await fx
            .http('get', '/encounters?status=TRIAGED&limit=100', rec.token)
            .expect(200)
        ).body as { items: { id: string }[] }
      ).items.find((e) => e.id === id);
    expect((await one()).body).toMatchObject({
      finalLevel: null,
      triagedAt: null,
      triagedBy: null,
    });
    const waiting = (
      (
        await fx
          .http('get', '/encounters?status=WAITING_TRIAGE&limit=100', rec.token)
          .expect(200)
      ).body as { items: { id: string }[] }
    ).items.find((e) => e.id === id);
    expect(waiting).toMatchObject({
      finalLevel: null,
      triagedAt: null,
      triagedBy: null,
    });

    clock.advance(45_000);
    const at = new Date(NOW.getTime() + 45_000).toISOString();
    const decision = (
      await fx
        .http('post', `/encounters/${id}/triage-decision`, nurse.token)
        .send({ action: 'MANUAL', level: 2 })
        .expect(201)
    ).body as { id: string };

    const triaged = {
      status: 'TRIAGED',
      finalLevel: 2,
      triagedAt: at,
      triagedBy: { id: nurse.id, fullName: nurse.fullName },
    };
    expect(await listed()).toMatchObject(triaged);
    const detail = (await one()).body as {
      events: { type: string }[];
    };
    expect(detail).toMatchObject(triaged);
    expect(detail.events.filter((e) => e.type === 'TRIAGE_DECIDED')).toEqual([
      {
        id: expect.any(String) as string,
        type: 'TRIAGE_DECIDED',
        fromStatus: 'WAITING_TRIAGE',
        toStatus: 'TRIAGED',
        payload: { decisionId: decision.id, action: 'MANUAL' },
        actor: { type: 'STAFF', id: nurse.id, fullName: nurse.fullName },
        occurredAt: at,
      },
    ]);
  });

  it('R18: /patient/pre-registrations y /patient/profile de un paciente con atención decidida no exponen el nivel, la hora ni el responsable del triage ni la decisión', async () => {
    const p = await fx.patientUser(t.id, { identityVerified: true });
    const pre = await fx.preRegister(p, t.siteId);
    const confirmed = await fx
      .http('post', `/pre-registrations/${pre.id}/confirm`, rec.token)
      .send({ identityVerified: true })
      .expect(201);
    const encounterId = (confirmed.body as { id: string }).id;
    await fx
      .http('post', `/encounters/${encounterId}/triage-decision`, nurse.token)
      .send({ action: 'MANUAL', level: 1 })
      .expect(201);

    const forbidden = [
      'finalLevel',
      'triagedAt',
      'triagedBy',
      'level',
      'decision',
      'triageDecision',
      'suggestedLevel',
      'reason',
    ];
    const list = await fx
      .http('get', '/patient/pre-registrations', p.token)
      .expect(200);
    const profile = await fx
      .http('get', '/patient/profile', p.token)
      .expect(200);
    for (const body of [list.body, profile.body] as unknown[]) {
      const keys = deepKeys(body);
      expect(forbidden.filter((k) => keys.has(k))).toEqual([]);
    }
    // El paciente sigue viendo solo el estado.
    expect(JSON.stringify(list.body)).toContain('"status":"TRIAGED"');
  });
});
