import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { createApp, problem } from './e2e-app.js';
import { FakeLlmClient, validOutput } from './int/fake-llm.js';
import { F02Fixtures, type Staff } from './int/f02-fixtures.js';
import { F03Fixtures, VITALS } from './int/f03-fixtures.js';

const NOW = new Date('2026-11-09T18:00:00.000Z');

describe('F-04: GET /encounters/{id}/triage-suggestions (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  const clock = new FixedClock(NOW);
  const groq = new FakeLlmClient('GROQ', 'openai/gpt-oss-120b', {
    content: validOutput(),
  });
  const openRouter = new FakeLlmClient('OPENROUTER', 'openai/gpt-oss-120b', {
    fail: 'NETWORK',
  });
  let t: { id: string; siteId: string };
  let other: { id: string; siteId: string };
  let rec: Staff;
  let nurse: Staff;
  let physician: Staff;
  let otherPhysician: Staff;

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: GROQ_CLIENT, useValue: groq },
        { provide: OPENROUTER_CLIENT, useValue: openRouter },
      ],
    });
    fx = new F02Fixtures(app);
    f3 = new F03Fixtures(fx);
    t = await fx.tenant('f04-read');
    other = await fx.tenant('f04-read-other');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
    physician = await fx.staff(t.id, 'PHYSICIAN');
    otherPhysician = await fx.staff(other.id, 'PHYSICIAN');
  });
  beforeEach(() => {
    clock.set(NOW);
    groq.script();
    openRouter.script();
  });
  afterAll(() => app.close());

  const list = (id: string, token = physician.token) =>
    fx.http('get', `/encounters/${id}/triage-suggestions`, token);

  async function readyEncounter(): Promise<string> {
    const id = await f3.encounter(t, rec);
    await fx
      .http('post', `/encounters/${id}/vital-signs`, nurse.token)
      .send(VITALS)
      .expect(201);
    return id;
  }
  const suggest = (id: string) =>
    fx
      .http('post', `/encounters/${id}/triage-suggestions`, nurse.token)
      .expect(201)
      .then((r) => (r.body as { id: string }).id);

  it('R21: lista vacía para una atención sin sugerencias', async () => {
    const id = await readyEncounter();
    const res = await list(id).expect(200);
    expect(res.body).toEqual({ items: [] });
  });

  it('R21: ordena por created_at y después por id descendentes (items[0] es la vigente), para NURSE y PHYSICIAN', async () => {
    const id = await readyEncounter();
    const first = await suggest(id);
    clock.advance(60_000);
    groq.script({ fail: 'TIMEOUT' });
    openRouter.script({ fail: 'TIMEOUT' });
    const second = await suggest(id);
    // Dos sugerencias con el mismo created_at: desempata el id descendente.
    clock.advance(60_000);
    const third = await suggest(id);
    const fourth = await suggest(id);
    const sameInstant = [third, fourth].sort().reverse();
    for (const token of [physician.token, nurse.token]) {
      const res = await list(id, token).expect(200);
      const items = (res.body as { items: { id: string }[] }).items;
      expect(items.map((i) => i.id)).toEqual([...sameInstant, second, first]);
    }
  });

  it('R21: una atención CANCELLED (o en cualquier estado) sigue siendo legible', async () => {
    const id = await readyEncounter();
    const sid = await suggest(id);
    await f3.setStatus(id, 'CANCELLED');
    const res = await list(id).expect(200);
    expect(
      (res.body as { items: { id: string }[] }).items.map((i) => i.id),
    ).toEqual([sid]);
  });

  it('R22: forma exacta; nivel, explicación y factores en null si status ≠ OK; sin inputSnapshot, rawResponse ni attempts', async () => {
    const id = await readyEncounter();
    groq.script({ content: 'texto que no es JSON' });
    await suggest(id);
    clock.advance(1000);
    groq.script({ content: validOutput(4) });
    await suggest(id);
    const res = await list(id).expect(200);
    const [ok, invalid] = (res.body as { items: Record<string, unknown>[] })
      .items;
    const keys = [
      'createdAt',
      'encounterId',
      'explanation',
      'factors',
      'guardApplied',
      'guardReasons',
      'id',
      'latencyMs',
      'llmLevel',
      'model',
      'promptVersion',
      'provider',
      'requestedBy',
      'status',
      'suggestedLevel',
    ];
    expect(Object.keys(ok).sort()).toEqual(keys);
    expect(Object.keys(invalid).sort()).toEqual(keys);
    expect(ok).toMatchObject({
      encounterId: id,
      status: 'OK',
      llmLevel: 4,
      suggestedLevel: 3,
      guardApplied: true,
      guardReasons: [{ rule: 'G2', maxLevel: 3, trigger: { news2Total: 5 } }],
      explanation:
        'Dolor torácico con taquicardia: descartar síndrome coronario agudo.',
      factors: [
        { field: 'chief_complaint_text', note: 'Dolor torácico' },
        { field: 'vital_signs.heart_rate', note: 'Taquicardia' },
      ],
      provider: 'GROQ',
      model: 'openai/gpt-oss-120b',
      promptVersion: 'triage-v1',
      createdAt: new Date(NOW.getTime() + 1000).toISOString(),
      requestedBy: { id: nurse.id, fullName: nurse.fullName },
    });
    expect(invalid).toMatchObject({
      status: 'INVALID_OUTPUT',
      llmLevel: null,
      suggestedLevel: null,
      explanation: null,
      factors: null,
      guardApplied: false,
      guardReasons: [],
    });
    const text = res.text;
    for (const hidden of [
      'inputSnapshot',
      'input_snapshot',
      'rawResponse',
      'raw_response',
      'attempts',
      'texto que no es JSON',
    ]) {
      expect([hidden, text.includes(hidden)]).toEqual([hidden, false]);
    }
  });

  it('R4: 404 igual entre tenants, para una atención inexistente y para un id mal formado', async () => {
    const id = await readyEncounter();
    await suggest(id);
    const bodies = [];
    for (const [target, token] of [
      [id, otherPhysician.token],
      ['00000000-0000-4000-8000-000000000000', physician.token],
      ['zz-mal-formado', physician.token],
    ]) {
      const res = await list(target, token).expect(404);
      bodies.push({ ...problem(res), instance: undefined });
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });
});
