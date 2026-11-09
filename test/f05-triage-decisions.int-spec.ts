import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { createApp, problem } from './e2e-app.js';
import { FailingAuditService } from './int/failing-audit.js';
import { FakeLlmClient, validOutput } from './int/fake-llm.js';
import { F02Fixtures, type Staff } from './int/f02-fixtures.js';
import { F03Fixtures, VITALS } from './int/f03-fixtures.js';
import { insertSuggestion } from './int/f05-fixtures.js';

const NOW = new Date('2026-11-09T19:00:00.000Z');
const NOT_CURRENT = 'La sugerencia no es la vigente o no es válida.';
const HAS_VALID =
  'La atención tiene una sugerencia válida: valídela o corríjala.';
const ALREADY_DECIDED = 'La atención ya tiene una decisión de triage.';
const NOT_WAITING =
  'La atención no está en espera de triage: no admite una decisión de triage.';
const NOT_FOUND = 'El recurso no existe.';
const REASON = 'DEV-test dolor irradiado a mandíbula';

interface DecisionBody {
  id: string;
  encounterId: string;
  action: string;
  level: number;
  suggestionId: string | null;
  suggestedLevel: number | null;
  reason: string | null;
  decidedAt: string;
  decidedBy: { id: string; fullName: string | null };
}

describe('F-05: POST /encounters/{id}/triage-decision (integración, sin LLM real)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  const clock = new FixedClock(NOW);
  const groq = new FakeLlmClient('GROQ', 'openai/gpt-oss-120b', {
    content: validOutput(),
  });
  const openRouter = new FakeLlmClient('OPENROUTER', 'x', { fail: 'NETWORK' });
  let t: { id: string; siteId: string };
  let other: { id: string; siteId: string };
  let rec: Staff;
  let nurse: Staff;
  let nurse2: Staff;
  let otherNurse: Staff;

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
    t = await fx.tenant('f05-dec');
    other = await fx.tenant('f05-dec-other');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
    nurse2 = await fx.staff(t.id, 'NURSE');
    otherNurse = await fx.staff(other.id, 'NURSE');
  });
  beforeEach(() => clock.set(NOW));
  afterAll(() => app.close());

  const decide = (id: string, body: object, token = nurse.token) =>
    fx.http('post', `/encounters/${id}/triage-decision`, token).send(body);
  const suggestion = (
    encounterId: string,
    over: Partial<Parameters<typeof insertSuggestion>[1]> = {},
  ) =>
    insertSuggestion(fx.prisma, {
      tenantId: t.id,
      encounterId,
      requestedBy: nurse.id,
      createdAt: NOW,
      ...over,
    });
  const encounterRow = (id: string) =>
    fx.prisma.encounter.findUniqueOrThrow({ where: { id } });
  /** Filas que una decisión crea o cambia: decisión, evento, auditoría y columnas de la atención. */
  async function state(id: string) {
    return {
      decisions: await fx.prisma.triageDecision.count({
        where: { encounterId: id },
      }),
      events: await fx.prisma.encounterEvent.count({
        where: { encounterId: id, type: 'TRIAGE_DECIDED' },
      }),
      audits: await fx.prisma.auditLog.count({
        where: {
          action: 'TRIAGE_DECIDED',
          metadata: { path: ['encounterId'], equals: id },
        },
      }),
      encounter: await encounterRow(id),
    };
  }
  async function withSuggestion(level = 3, llmLevel = level) {
    const id = await f3.encounter(t, rec);
    const sid = await suggestion(id, { suggestedLevel: level, llmLevel });
    return { id, sid };
  }

  // ---------------------------------------------------------------- R1–R3, R9

  it('R1: VALIDATE sobre la sugerencia vigente válida responde 201 con la decisión y guarda el nivel sugerido (ajustado por el guard), sin motivo, con hora del servidor y responsable del token', async () => {
    // El LLM dijo 4 y un guard subió a 2: VALIDATE toma 2 (PA-F05-3).
    const { id, sid } = await withSuggestion(2, 4);
    clock.advance(90_000);
    const decidedAt = new Date(NOW.getTime() + 90_000);
    const res = await decide(id, { action: 'VALIDATE', suggestionId: sid });
    expect(res.status).toBe(201);
    const body = res.body as DecisionBody;
    expect(body).toEqual({
      id: body.id,
      encounterId: id,
      action: 'VALIDATE',
      level: 2,
      suggestionId: sid,
      suggestedLevel: 2,
      reason: null,
      decidedAt: decidedAt.toISOString(),
      decidedBy: { id: nurse.id, fullName: nurse.fullName },
    });
    expect(
      await fx.prisma.triageDecision.findUniqueOrThrow({
        where: { id: body.id },
      }),
    ).toEqual({
      id: body.id,
      tenantId: t.id,
      encounterId: id,
      suggestionId: sid,
      action: 'VALIDATE',
      level: 2,
      reason: null,
      decidedBy: nurse.id,
      decidedAt,
    });
  });

  it('R2: CORRECT con un nivel distinto y motivo responde 201 y guarda el nivel, la sugerencia y el motivo recortado', async () => {
    const { id, sid } = await withSuggestion(3);
    const res = await decide(id, {
      action: 'CORRECT',
      suggestionId: sid,
      level: 2,
      reason: `   ${REASON}  `,
    }).expect(201);
    const body = res.body as DecisionBody;
    expect(body).toMatchObject({
      action: 'CORRECT',
      level: 2,
      suggestionId: sid,
      suggestedLevel: 3,
      reason: REASON,
      decidedAt: NOW.toISOString(),
      decidedBy: { id: nurse.id },
    });
    expect(
      await fx.prisma.triageDecision.findUniqueOrThrow({
        where: { id: body.id },
      }),
    ).toMatchObject({
      tenantId: t.id,
      level: 2,
      suggestionId: sid,
      reason: REASON,
      decidedBy: nurse.id,
      decidedAt: NOW,
    });
  });

  it('R3: MANUAL sin sugerencias, o con la vigente en TIMEOUT/FAILED/INVALID_OUTPUT, responde 201 sin sugerencia ni motivo', async () => {
    const cases: (string | null)[] = [
      null,
      'TIMEOUT',
      'FAILED',
      'INVALID_OUTPUT',
    ];
    for (const status of cases) {
      const id = await f3.encounter(t, rec);
      if (status) {
        // Una OK anterior no cuenta: la vigente es la más reciente.
        await suggestion(id, { createdAt: new Date(NOW.getTime() - 1000) });
        await suggestion(id, {
          status: status as 'TIMEOUT' | 'FAILED' | 'INVALID_OUTPUT',
        });
      }
      const res = await decide(id, { action: 'MANUAL', level: 4 });
      expect([status, res.status]).toEqual([status, 201]);
      expect(res.body).toMatchObject({
        encounterId: id,
        action: 'MANUAL',
        level: 4,
        suggestionId: null,
        suggestedLevel: null,
        reason: null,
      });
      expect(
        await fx.prisma.triageDecision.findFirstOrThrow({
          where: { encounterId: id },
        }),
      ).toMatchObject({ suggestionId: null, reason: null, level: 4 });
    }
  });

  it('R9: la decisión pasa la atención a TRIAGED con final_level, triaged_at y triaged_by, un evento TRIAGE_DECIDED y la auditoría, en la misma transacción', async () => {
    const { id, sid } = await withSuggestion(3);
    clock.advance(30_000);
    const at = new Date(NOW.getTime() + 30_000);
    const res = await decide(id, {
      action: 'CORRECT',
      suggestionId: sid,
      level: 1,
      reason: REASON,
    }).expect(201);
    const decisionId = (res.body as DecisionBody).id;
    expect(await encounterRow(id)).toMatchObject({
      status: 'TRIAGED',
      finalLevel: 1,
      triagedAt: at,
      triagedBy: nurse.id,
    });
    const events = await fx.prisma.encounterEvent.findMany({
      where: { encounterId: id, type: 'TRIAGE_DECIDED' },
    });
    expect(events).toEqual([
      expect.objectContaining({
        tenantId: t.id,
        fromStatus: 'WAITING_TRIAGE',
        toStatus: 'TRIAGED',
        payload: { decisionId, action: 'CORRECT' },
        actorType: 'STAFF',
        actorId: nurse.id,
        occurredAt: at,
      }),
    ]);
    expect(
      await fx.audits({ entityId: decisionId, action: 'TRIAGE_DECIDED' }),
    ).toEqual([
      expect.objectContaining({
        tenantId: t.id,
        actorType: 'STAFF',
        actorId: nurse.id,
        entity: 'triage_decisions',
        metadata: { encounterId: id, action: 'CORRECT' },
        occurredAt: at,
      }),
    ]);
  });

  // ---------------------------------------------------------------- R5–R8

  it('R5: level fuera de 1–5 o motivo inválido en CORRECT responde 422 con el campo, sin registrar nada', async () => {
    const { id, sid } = await withSuggestion(3);
    const before = await state(id);
    for (const [body, field] of [
      [{ action: 'MANUAL', level: 0 }, 'level'],
      [
        { action: 'CORRECT', suggestionId: sid, level: 6, reason: REASON },
        'level',
      ],
      [{ action: 'CORRECT', suggestionId: sid, level: 2 }, 'reason'],
      [
        { action: 'CORRECT', suggestionId: sid, level: 2, reason: '  ' },
        'reason',
      ],
      [
        {
          action: 'CORRECT',
          suggestionId: sid,
          level: 2,
          reason: 'x'.repeat(501),
        },
        'reason',
      ],
    ] as [object, string][]) {
      const res = await decide(id, body).expect(422);
      expect(problem(res).errors?.map((e) => e.field)).toEqual([field]);
    }
    expect(await state(id)).toEqual(before);
  });

  it('R6: CORRECT con el mismo nivel que el sugerido responde 422 con level en errors[], sin registrar nada', async () => {
    const { id, sid } = await withSuggestion(3);
    const before = await state(id);
    const res = await decide(id, {
      action: 'CORRECT',
      suggestionId: sid,
      level: 3,
      reason: REASON,
    }).expect(422);
    expect(problem(res).errors?.map((e) => e.field)).toEqual(['level']);
    expect(await state(id)).toEqual(before);
  });

  it('R7: VALIDATE/CORRECT con una sugerencia que no es la vigente (inexistente, de otra atención, de otro tenant o anterior) o con la vigente no OK → 409 constante sin registrar nada', async () => {
    const { id, sid } = await withSuggestion(3);
    const otherEnc = await withSuggestion(3);
    const foreignEnc = await f3.encounter(other, await fx.staff(other.id));
    const foreign = await insertSuggestion(fx.prisma, {
      tenantId: other.id,
      encounterId: foreignEnc,
      requestedBy: otherNurse.id,
      createdAt: NOW,
    });
    const newer = await f3.encounter(t, rec);
    const old = await suggestion(newer, {
      createdAt: new Date(NOW.getTime() - 1000),
    });
    await suggestion(newer);
    const failedEnc = await f3.encounter(t, rec);
    const failed = await suggestion(failedEnc, { status: 'FAILED' });

    const cases: [string, string][] = [
      [id, '6f1c1d2e-0000-4000-8000-00000000abcd'],
      [id, otherEnc.sid],
      [id, foreign],
      [newer, old],
      [failedEnc, failed],
    ];
    for (const [enc, suggestionId] of cases) {
      const before = await state(enc);
      for (const body of [
        { action: 'VALIDATE', suggestionId },
        { action: 'CORRECT', suggestionId, level: 1, reason: REASON },
      ]) {
        const res = await decide(enc, body).expect(409);
        expect(problem(res).detail).toBe(NOT_CURRENT);
      }
      expect(await state(enc)).toEqual(before);
    }
    // La sugerencia vigente sigue siendo decidible.
    await decide(id, { action: 'VALIDATE', suggestionId: sid }).expect(201);
  });

  it('R8: MANUAL con una sugerencia vigente válida → 409 con un detail constante distinto, sin registrar nada', async () => {
    const { id } = await withSuggestion(3);
    const before = await state(id);
    const res = await decide(id, { action: 'MANUAL', level: 2 }).expect(409);
    expect(problem(res).detail).toBe(HAS_VALID);
    expect(await state(id)).toEqual(before);
  });

  // ---------------------------------------------------------------- R12–R14

  it('R12: una segunda decisión sobre la misma atención responde 409 y deja la primera y la atención intactas', async () => {
    const { id, sid } = await withSuggestion(3);
    await decide(id, { action: 'VALIDATE', suggestionId: sid }).expect(201);
    const before = await state(id);
    const first = await fx.prisma.triageDecision.findFirstOrThrow({
      where: { encounterId: id },
    });
    for (const body of [
      { action: 'VALIDATE', suggestionId: sid },
      { action: 'CORRECT', suggestionId: sid, level: 1, reason: REASON },
      { action: 'MANUAL', level: 1 },
    ]) {
      const res = await decide(id, body, nurse2.token).expect(409);
      expect(problem(res).detail).toBe(ALREADY_DECIDED);
    }
    expect(await state(id)).toEqual(before);
    expect(
      await fx.prisma.triageDecision.findFirstOrThrow({
        where: { encounterId: id },
      }),
    ).toEqual(first);
  });

  it('R12: dos decisiones simultáneas sobre la misma atención: exactamente una 201 y la otra 409', async () => {
    for (let i = 0; i < 3; i++) {
      const { id, sid } = await withSuggestion(3);
      const results = await Promise.all([
        decide(id, { action: 'VALIDATE', suggestionId: sid }),
        decide(
          id,
          { action: 'CORRECT', suggestionId: sid, level: 2, reason: REASON },
          nurse2.token,
        ),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const loser = results.find((r) => r.status === 409)!;
      expect(problem(loser).detail).toBe(ALREADY_DECIDED);
      const s = await state(id);
      expect([s.decisions, s.events, s.audits]).toEqual([1, 1, 1]);
    }
  });

  it('R13: en REGISTERED y CANCELLED (sin decisión) responde 409 sin registrar nada', async () => {
    for (const status of ['REGISTERED', 'CANCELLED'] as const) {
      const id = await f3.encounter(t, rec);
      await f3.setStatus(id, status);
      const before = await state(id);
      const res = await decide(id, { action: 'MANUAL', level: 3 }).expect(409);
      expect(problem(res).detail).toBe(NOT_WAITING);
      expect(await state(id)).toEqual(before);
    }
  });

  it('R13: si la atención se cancela antes de confirmar la decisión, responde 409; con una cancelación simultánea solo una de las dos gana', async () => {
    const id = await f3.encounter(t, rec);
    await fx
      .http('post', `/encounters/${id}/cancel`, rec.token)
      .send({ reason: 'DEV-test se retiró' })
      .expect(200);
    const res = await decide(id, { action: 'MANUAL', level: 3 }).expect(409);
    expect(problem(res).detail).toBe(NOT_WAITING);
    expect((await state(id)).decisions).toBe(0);

    const race = await f3.encounter(t, rec);
    const [cancel, decision] = await Promise.all([
      fx
        .http('post', `/encounters/${race}/cancel`, rec.token)
        .send({ reason: 'DEV-test se retiró' }),
      decide(race, { action: 'MANUAL', level: 3 }),
    ]);
    const row = await encounterRow(race);
    if (decision.status === 201) {
      // La decisión ganó: la cancelación posterior es válida desde TRIAGED y el nivel queda (D8).
      expect(row.finalLevel).toBe(3);
      expect([200, 409]).toContain(cancel.status);
    } else {
      expect(decision.status).toBe(409);
      expect(cancel.status).toBe(200);
      expect(row).toMatchObject({ status: 'CANCELLED', finalLevel: null });
      expect((await state(race)).decisions).toBe(0);
    }
  });

  it('R14: atención inexistente, de otro tenant o id mal formado → 404 con la misma respuesta, sin registrar nada', async () => {
    const { id, sid } = await withSuggestion(3);
    const before = await state(id);
    const bodies: string[] = [];
    for (const [enc, token] of [
      ['6f1c1d2e-0000-4000-8000-00000000dead', nurse.token],
      [id, otherNurse.token],
      ['no-es-un-uuid', nurse.token],
    ]) {
      const res = await decide(
        enc,
        { action: 'VALIDATE', suggestionId: sid },
        token,
      ).expect(404);
      const p = problem(res);
      expect(p.detail).toBe(NOT_FOUND);
      bodies.push(JSON.stringify({ ...p, instance: undefined }));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(await state(id)).toEqual(before);
  });

  // ---------------------------------------------------------------- F-04 después de decidir

  it('R9: después de decidir, POST /triage-suggestions responde 409 sin llamar al LLM (R2 de F-04 sigue en verde)', async () => {
    const id = await f3.encounter(t, rec);
    await fx
      .http('post', `/encounters/${id}/vital-signs`, nurse.token)
      .send(VITALS)
      .expect(201);
    await decide(id, { action: 'MANUAL', level: 3 }).expect(201);
    groq.script();
    await fx
      .http('post', `/encounters/${id}/triage-suggestions`, nurse.token)
      .expect(409);
    expect(groq.requests).toHaveLength(0);
  });
});

describe('F-05: fallo cerrado de la decisión (integración, AuditService que falla)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;

  beforeAll(async () => {
    FailingAuditService.failOn = new Set(['TRIAGE_DECIDED']);
    app = await createApp({
      overrides: [
        { provide: AuditService, useClass: FailingAuditService },
        {
          provide: GROQ_CLIENT,
          useValue: new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' }),
        },
        {
          provide: OPENROUTER_CLIENT,
          useValue: new FakeLlmClient('OPENROUTER', 'x', { fail: 'NETWORK' }),
        },
      ],
    });
    fx = new F02Fixtures(app);
    f3 = new F03Fixtures(fx);
  });
  afterAll(async () => {
    FailingAuditService.failOn = new Set([
      'AUTH_LOGIN_SUCCEEDED',
      'PATIENT_ACCOUNT_CREATED',
    ]);
    await app.close();
  });

  it('R10: si falla la auditoría responde 500 problem+json y revierte todo: sin decisión, atención sin cambios, sin evento ni auditoría', async () => {
    const t = await fx.tenant('f05-audit-fail');
    const rec = await fx.staff(t.id);
    const nurse = await fx.staff(t.id, 'NURSE');
    const id = await f3.encounter(t, rec);
    const sid = await insertSuggestion(fx.prisma, {
      tenantId: t.id,
      encounterId: id,
      requestedBy: nurse.id,
      createdAt: new Date(),
    });
    const before = await fx.prisma.encounter.findUniqueOrThrow({
      where: { id },
    });
    const res = await fx
      .http('post', `/encounters/${id}/triage-decision`, nurse.token)
      .send({ action: 'VALIDATE', suggestionId: sid })
      .expect(500);
    expect(problem(res).status).toBe(500);
    expect(
      await fx.prisma.encounter.findUniqueOrThrow({ where: { id } }),
    ).toEqual(before);
    expect(
      await fx.prisma.triageDecision.count({ where: { encounterId: id } }),
    ).toBe(0);
    expect(
      await fx.prisma.encounterEvent.count({
        where: { encounterId: id, type: 'TRIAGE_DECIDED' },
      }),
    ).toBe(0);
    expect(
      await fx.prisma.auditLog.count({
        where: {
          action: 'TRIAGE_DECIDED',
          metadata: { path: ['encounterId'], equals: id },
        },
      }),
    ).toBe(0);
  });
});
