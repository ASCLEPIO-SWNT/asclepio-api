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
import { F03Fixtures } from './int/f03-fixtures.js';
import { insertSuggestion } from './int/f05-fixtures.js';

const NOW = new Date('2026-11-09T20:00:00.000Z');
const NOT_FOUND = 'El recurso no existe.';
const NO_DECISION = 'La atención no tiene una decisión de triage.';
const REASON = 'DEV-test hallazgo de alarma';

describe('F-05: GET /encounters/{id}/triage-decision (integración)', () => {
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
  let otherPhysician: Staff;

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
    t = await fx.tenant('f05-read');
    other = await fx.tenant('f05-read-other');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
    physician = await fx.staff(t.id, 'PHYSICIAN');
    otherPhysician = await fx.staff(other.id, 'PHYSICIAN');
  });
  afterAll(() => app.close());

  const read = (id: string, token = physician.token) =>
    fx.http('get', `/encounters/${id}/triage-decision`, token);
  const decide = (id: string, body: object) =>
    fx
      .http('post', `/encounters/${id}/triage-decision`, nurse.token)
      .send(body)
      .expect(201);

  it('R16: NURSE y PHYSICIAN leen la decisión CORRECT con el nivel sugerido (ajustado) de su sugerencia, aunque después haya otra más reciente', async () => {
    const id = await f3.encounter(t, rec);
    const sid = await insertSuggestion(fx.prisma, {
      tenantId: t.id,
      encounterId: id,
      requestedBy: nurse.id,
      createdAt: NOW,
      suggestedLevel: 2,
      llmLevel: 4,
    });
    const created = await decide(id, {
      action: 'CORRECT',
      suggestionId: sid,
      level: 1,
      reason: REASON,
    });
    // Carrera de D4: una sugerencia insertada después no cambia la lectura.
    await insertSuggestion(fx.prisma, {
      tenantId: t.id,
      encounterId: id,
      requestedBy: nurse.id,
      createdAt: new Date(NOW.getTime() + 1000),
      suggestedLevel: 5,
    });
    for (const token of [nurse.token, physician.token]) {
      const res = await read(id, token).expect(200);
      expect(res.body).toEqual(created.body);
      expect(res.body).toEqual({
        id: (created.body as { id: string }).id,
        encounterId: id,
        action: 'CORRECT',
        level: 1,
        suggestionId: sid,
        suggestedLevel: 2,
        reason: REASON,
        decidedAt: NOW.toISOString(),
        decidedBy: { id: nurse.id, fullName: nurse.fullName },
      });
    }
  });

  it('R15: VALIDATE devuelve suggestedLevel = level y MANUAL devuelve suggestionId y suggestedLevel null', async () => {
    const v = await f3.encounter(t, rec);
    const sid = await insertSuggestion(fx.prisma, {
      tenantId: t.id,
      encounterId: v,
      requestedBy: nurse.id,
      createdAt: NOW,
      suggestedLevel: 3,
    });
    await decide(v, { action: 'VALIDATE', suggestionId: sid });
    expect((await read(v).expect(200)).body).toMatchObject({
      action: 'VALIDATE',
      level: 3,
      suggestionId: sid,
      suggestedLevel: 3,
      reason: null,
    });
    const m = await f3.encounter(t, rec);
    await decide(m, { action: 'MANUAL', level: 5 });
    expect((await read(m).expect(200)).body).toMatchObject({
      action: 'MANUAL',
      level: 5,
      suggestionId: null,
      suggestedLevel: null,
      reason: null,
    });
  });

  it('R16: atención del tenant sin decisión → 404 con un detail distinto del de R14', async () => {
    const id = await f3.encounter(t, rec);
    const p = problem(await read(id).expect(404));
    expect(p.detail).toBe(NO_DECISION);
    expect(p.detail).not.toBe(NOT_FOUND);
  });

  it('R14: atención inexistente, de otro tenant (aunque tenga decisión) o id mal formado → 404 igual', async () => {
    const id = await f3.encounter(t, rec);
    await decide(id, { action: 'MANUAL', level: 2 });
    const bodies = new Set<string>();
    for (const [enc, token] of [
      ['6f1c1d2e-0000-4000-8000-00000000dead', physician.token],
      [id, otherPhysician.token],
      ['no-es-un-uuid', physician.token],
    ]) {
      const p = problem(await read(enc, token).expect(404));
      expect(p.detail).toBe(NOT_FOUND);
      bodies.add(JSON.stringify({ ...p, instance: undefined }));
    }
    expect(bodies.size).toBe(1);
  });
});
