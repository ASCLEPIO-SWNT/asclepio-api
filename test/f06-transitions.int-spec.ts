import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { createApp, problem } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { F02Fixtures, type Staff } from './int/f02-fixtures.js';
import { F03Fixtures, type EncounterStatusName } from './int/f03-fixtures.js';

const NOW = new Date('2026-11-09T16:00:00.000Z');

interface EventBody {
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  actor: { type: string; id: string | null; fullName: string | null };
  occurredAt: string;
}
interface EncounterBody {
  id: string;
  status: string;
  finalLevel: number | null;
  triagedAt: string | null;
  triagedBy: { id: string; fullName: string | null } | null;
  events: EventBody[];
}

describe('F-06: POST /encounters/{id}/start-care y /close (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  const clock = new FixedClock(NOW);
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  let t: { id: string; siteId: string };
  let other: { id: string; siteId: string };
  let rec: Staff;
  let nurse: Staff;
  let physician: Staff;
  let otherRec: Staff;

  const post = (id: string, action: 'start-care' | 'close', token: string) =>
    fx.http('post', `/encounters/${id}/${action}`, token);

  /** Atención TRIAGED por la vía real de F-05 (decisión MANUAL de enfermería). */
  async function triaged(level = 2): Promise<string> {
    const id = await f3.encounter(t, rec);
    await fx
      .http('post', `/encounters/${id}/triage-decision`, nurse.token)
      .send({ action: 'MANUAL', level })
      .expect(201);
    return id;
  }

  async function snapshot(id: string) {
    const p = fx.prisma;
    const [enc, events, audits] = await Promise.all([
      p.encounter.findUniqueOrThrow({
        where: { id },
        select: {
          status: true,
          finalLevel: true,
          triagedAt: true,
          triagedBy: true,
          updatedAt: true,
        },
      }),
      p.encounterEvent.count({ where: { encounterId: id } }),
      p.auditLog.count({
        where: { entityId: id, action: 'ENCOUNTER_STATUS_CHANGED' },
      }),
    ]);
    return { enc, events, audits };
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
    t = await fx.tenant('f06-transitions');
    other = await fx.tenant('f06-transitions-otro');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
    physician = await fx.staff(t.id, 'PHYSICIAN');
    otherRec = await fx.staff(other.id);
  });
  beforeEach(() => clock.set(NOW));
  afterAll(() => app.close());

  it('R9: start-care pasa TRIAGED → IN_CARE, responde 200 con la atención y deja el evento STATUS_CHANGED y la auditoría', async () => {
    const id = await triaged();
    clock.advance(5 * 60_000);
    const at = clock.now().toISOString();
    const res = await post(id, 'start-care', physician.token).expect(200);
    const body = res.body as EncounterBody;
    expect(body).toMatchObject({ id, status: 'IN_CARE', finalLevel: 2 });
    expect(
      body.events.filter((e) => e.type === 'STATUS_CHANGED').at(-1),
    ).toEqual({
      id: expect.any(String) as string,
      type: 'STATUS_CHANGED',
      fromStatus: 'TRIAGED',
      toStatus: 'IN_CARE',
      payload: {},
      actor: {
        type: 'STAFF',
        id: physician.id,
        fullName: physician.fullName,
      },
      occurredAt: at,
    });
    const audits = await fx.audits({
      entityId: id,
      action: 'ENCOUNTER_STATUS_CHANGED',
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: 'STAFF',
      actorId: physician.id,
      tenantId: t.id,
      entity: 'encounter',
      metadata: { fromStatus: 'TRIAGED', toStatus: 'IN_CARE' },
    });
    // GET /encounters/{id} tiene la misma forma que la respuesta.
    const again = await fx
      .http('get', `/encounters/${id}`, physician.token)
      .expect(200);
    expect(again.body).toEqual(res.body);
  });

  it('R9: start-care admite un cuerpo {} además de ninguno', async () => {
    const id = await triaged();
    await post(id, 'start-care', physician.token).send({}).expect(200);
  });

  it('R10: close pasa IN_CARE → CLOSED y responde 200 con el evento y la auditoría', async () => {
    const id = await triaged();
    await post(id, 'start-care', physician.token).expect(200);
    clock.advance(40 * 60_000);
    const at = clock.now().toISOString();
    const res = await post(id, 'close', physician.token).send({}).expect(200);
    const body = res.body as EncounterBody;
    expect(body.status).toBe('CLOSED');
    expect(
      body.events
        .filter((e) => e.type === 'STATUS_CHANGED')
        .map((e) => [e.fromStatus, e.toStatus, e.actor.id, e.occurredAt]),
    ).toEqual([
      ['REGISTERED', 'WAITING_TRIAGE', rec.id, NOW.toISOString()],
      ['TRIAGED', 'IN_CARE', physician.id, NOW.toISOString()],
      ['IN_CARE', 'CLOSED', physician.id, at],
    ]);
    const audits = await fx.audits({
      entityId: id,
      action: 'ENCOUNTER_STATUS_CHANGED',
    });
    expect(audits.map((a) => a.metadata)).toEqual([
      { fromStatus: 'TRIAGED', toStatus: 'IN_CARE' },
      { fromStatus: 'IN_CARE', toStatus: 'CLOSED' },
    ]);
  });

  it('R11: responde 409 sin modificar nada en cada estado no válido', async () => {
    const cases: [EncounterStatusName, 'start-care' | 'close'][] = [
      ['WAITING_TRIAGE', 'start-care'],
      ['WAITING_TRIAGE', 'close'],
      ['TRIAGED', 'close'],
      ['IN_CARE', 'start-care'],
      ['CLOSED', 'start-care'],
      ['CLOSED', 'close'],
      ['CANCELLED', 'start-care'],
      ['CANCELLED', 'close'],
    ];
    for (const [status, action] of cases) {
      const id = await f3.encounter(t, rec);
      if (status !== 'WAITING_TRIAGE') await f3.setStatus(id, status);
      const before = await snapshot(id);
      const res = await post(id, action, physician.token);
      expect([status, action, res.status]).toEqual([status, action, 409]);
      expect(problem(res).status).toBe(409);
      expect(await snapshot(id)).toEqual(before);
    }
  });

  it('R11: dos start-care simultáneos → un 200 y un 409, con un solo evento y una sola auditoría', async () => {
    const id = await triaged();
    const before = await snapshot(id);
    const results = await Promise.all([
      post(id, 'start-care', physician.token),
      post(id, 'start-care', physician.token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const after = await snapshot(id);
    expect(after.enc.status).toBe('IN_CARE');
    expect(after.events).toBe(before.events + 1);
    expect(after.audits).toBe(before.audits + 1);
  });

  it('R11: dos close simultáneos → un 200 y un 409', async () => {
    const id = await triaged();
    await post(id, 'start-care', physician.token).expect(200);
    const results = await Promise.all([
      post(id, 'close', physician.token),
      post(id, 'close', physician.token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('R12: id inexistente, de otro tenant o mal formado → 404 con la misma respuesta; cuerpo con campos → 400; sin modificar nada', async () => {
    const foreign = await f3.encounter(other, otherRec);
    await f3.setStatus(foreign, 'TRIAGED');
    const foreignBefore = await snapshot(foreign);
    for (const action of ['start-care', 'close'] as const) {
      const bodies = [];
      for (const id of [
        '0d6c1f6a-0000-4000-8000-000000000000',
        foreign,
        'zz-mal-formado',
      ]) {
        const res = await post(id, action, physician.token);
        expect([action, id, res.status]).toEqual([action, id, 404]);
        const p = problem(res);
        bodies.push({ ...p, instance: undefined });
      }
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    }
    expect(await snapshot(foreign)).toEqual(foreignBefore);

    const id = await triaged();
    const before = await snapshot(id);
    for (const [action, body] of [
      ['start-care', { status: 'CLOSED' }],
      ['close', { status: 'CLOSED' }],
      ['start-care', { at: '2024-01-01T00:00:00Z' }],
    ] as const) {
      const res = await post(id, action, physician.token).send(body);
      expect([action, body, res.status]).toEqual([action, body, 400]);
      expect(problem(res).status).toBe(400);
    }
    expect(await snapshot(id)).toEqual(before);
  });

  it('R13: final_level, triaged_at y triaged_by se conservan tras start-care y close (CHECK de F-05 satisfecho)', async () => {
    const id = await triaged(1);
    const triagedRow = await snapshot(id);
    expect(triagedRow.enc).toMatchObject({
      status: 'TRIAGED',
      finalLevel: 1,
      triagedBy: nurse.id,
    });
    clock.advance(60_000);
    await post(id, 'start-care', physician.token).expect(200);
    clock.advance(60_000);
    const closed = (await post(id, 'close', physician.token).expect(200))
      .body as EncounterBody;
    expect(closed).toMatchObject({
      status: 'CLOSED',
      finalLevel: 1,
      triagedAt: NOW.toISOString(),
      triagedBy: { id: nurse.id, fullName: nurse.fullName },
    });
    const after = await snapshot(id);
    expect(after.enc).toMatchObject({
      status: 'CLOSED',
      finalLevel: triagedRow.enc.finalLevel,
      triagedAt: triagedRow.enc.triagedAt,
      triagedBy: triagedRow.enc.triagedBy,
    });
  });

  it('R9: tras start-care la atención pasa de triaged a inCare en la cola', async () => {
    const id = await triaged(2);
    const section = async () => {
      const q = (await fx.http('get', '/queue', physician.token).expect(200))
        .body as Record<string, { encounterId: string }[]>;
      return ['waitingTriage', 'triaged', 'inCare'].filter((s) =>
        q[s].some((i) => i.encounterId === id),
      );
    };
    expect(await section()).toEqual(['triaged']);
    await post(id, 'start-care', physician.token).expect(200);
    expect(await section()).toEqual(['inCare']);
    await post(id, 'close', physician.token).expect(200);
    expect(await section()).toEqual([]);
  });
});
