import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import { PrismaService } from '../src/common/prisma/prisma.service.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { TriageSuggestionsService } from '../src/modules/ai/triage-suggestions.service.js';
import { EncountersService } from '../src/modules/encounters/encounters.service.js';
import { createApp } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { F02Fixtures, type Staff } from './int/f02-fixtures.js';
import { F03Fixtures } from './int/f03-fixtures.js';
import { insertSuggestion } from './int/f05-fixtures.js';

const NOW = new Date('2026-11-09T18:00:00.000Z');

/** F-05-api · piezas de otros módulos que usa triage: findCurrent / findSuggestedLevel (ai) y recordTriage (encounters). */
describe('F-05: TriageSuggestionsService.findCurrent y EncountersService.recordTriage (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  let t: { id: string; siteId: string };
  let other: { id: string; siteId: string };
  let rec: Staff;
  let nurse: Staff;
  const clock = new FixedClock(NOW);
  // Ninguna prueba llama al LLM real.
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });

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
    t = await fx.tenant('f05-svc');
    other = await fx.tenant('f05-svc-other');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
  });
  afterAll(() => app.close());

  const prisma = () => app.get(PrismaService);
  const ai = () => app.get(TriageSuggestionsService);
  const encounters = () => app.get(EncountersService);
  const at = (ms: number) => new Date(NOW.getTime() + ms);
  const suggestion = (
    encounterId: string,
    createdAt: Date,
    over: Partial<Parameters<typeof insertSuggestion>[1]> = {},
  ) =>
    insertSuggestion(fx.prisma, {
      tenantId: t.id,
      encounterId,
      requestedBy: nurse.id,
      createdAt,
      ...over,
    });

  it('R7: findCurrent devuelve la sugerencia de mayor created_at (y después mayor id) de la atención, con status y nivel sugerido', async () => {
    const id = await f3.encounter(t, rec);
    await suggestion(id, at(0), { suggestedLevel: 4 });
    const latest = await suggestion(id, at(60_000), {
      suggestedLevel: 2,
      llmLevel: 3,
    });
    expect(
      await prisma().$transaction((tx) => ai().findCurrent(t.id, id, tx)),
    ).toEqual({ id: latest, status: 'OK', suggestedLevel: 2 });

    // Mismo created_at: desempata el id mayor.
    const tie = await f3.encounter(t, rec);
    const ids = [
      await suggestion(tie, at(0)),
      await suggestion(tie, at(0)),
    ].sort();
    expect(
      (await prisma().$transaction((tx) => ai().findCurrent(t.id, tie, tx)))
        ?.id,
    ).toBe(ids[1]);
  });

  it('R8: findCurrent devuelve la vigente aunque no sea OK (nivel null), y null si no hay sugerencias o la atención es de otro tenant', async () => {
    const id = await f3.encounter(t, rec);
    expect(
      await prisma().$transaction((tx) => ai().findCurrent(t.id, id, tx)),
    ).toBeNull();
    await suggestion(id, at(0));
    const failed = await suggestion(id, at(1000), { status: 'TIMEOUT' });
    expect(
      await prisma().$transaction((tx) => ai().findCurrent(t.id, id, tx)),
    ).toEqual({ id: failed, status: 'TIMEOUT', suggestedLevel: null });
    expect(
      await prisma().$transaction((tx) => ai().findCurrent(other.id, id, tx)),
    ).toBeNull();
  });

  it('R16: findSuggestedLevel devuelve el nivel sugerido de una sugerencia del tenant por su id, o null', async () => {
    const id = await f3.encounter(t, rec);
    const s = await suggestion(id, at(0), { suggestedLevel: 2, llmLevel: 4 });
    const failed = await suggestion(id, at(1), { status: 'FAILED' });
    expect(await ai().findSuggestedLevel(t.id, s)).toBe(2);
    expect(await ai().findSuggestedLevel(t.id, failed)).toBeNull();
    expect(await ai().findSuggestedLevel(other.id, s)).toBeNull();
  });

  it('R9: recordTriage pasa la atención a TRIAGED con final_level, triaged_at y triaged_by, e inserta un solo evento TRIAGE_DECIDED y la auditoría', async () => {
    const id = await f3.encounter(t, rec);
    const decidedAt = at(5 * 60_000);
    const eventsBefore = await fx.prisma.encounterEvent.count({
      where: { encounterId: id },
    });
    const decisionId = await prisma().$transaction(async (tx) => {
      const d = await tx.triageDecision.create({
        data: {
          tenantId: t.id,
          encounterId: id,
          action: 'MANUAL',
          level: 2,
          decidedBy: nurse.id,
          decidedAt,
        },
        select: { id: true },
      });
      await encounters().recordTriage(
        t.id,
        id,
        {
          level: 2,
          decisionId: d.id,
          action: 'MANUAL',
          actorId: nurse.id,
          now: decidedAt,
        },
        tx,
      );
      return d.id;
    });
    expect(
      await fx.prisma.encounter.findUniqueOrThrow({
        where: { id },
        select: {
          status: true,
          finalLevel: true,
          triagedAt: true,
          triagedBy: true,
        },
      }),
    ).toEqual({
      status: 'TRIAGED',
      finalLevel: 2,
      triagedAt: decidedAt,
      triagedBy: nurse.id,
    });
    const events = await fx.prisma.encounterEvent.findMany({
      where: { encounterId: id },
      orderBy: { id: 'asc' },
    });
    expect(events).toHaveLength(eventsBefore + 1);
    expect(events.at(-1)).toMatchObject({
      type: 'TRIAGE_DECIDED',
      fromStatus: 'WAITING_TRIAGE',
      toStatus: 'TRIAGED',
      payload: { decisionId, action: 'MANUAL' },
      actorType: 'STAFF',
      actorId: nurse.id,
      occurredAt: decidedAt,
    });
    expect(
      await fx.audits({ entityId: decisionId, action: 'TRIAGE_DECIDED' }),
    ).toEqual([
      expect.objectContaining({
        tenantId: t.id,
        actorType: 'STAFF',
        actorId: nurse.id,
        entity: 'triage_decisions',
        metadata: { encounterId: id, action: 'MANUAL' },
      }),
    ]);
  });

  it('R9: recordTriage responde 409 sin cambios si la atención ya no está en WAITING_TRIAGE (0 filas)', async () => {
    const id = await f3.encounter(t, rec);
    await f3.setStatus(id, 'CANCELLED');
    const before = await fx.prisma.encounter.findUniqueOrThrow({
      where: { id },
    });
    await expect(
      prisma().$transaction((tx) =>
        encounters().recordTriage(
          t.id,
          id,
          {
            level: 3,
            decisionId: '6f1c1d2e-0000-4000-8000-000000000009',
            action: 'MANUAL',
            actorId: nurse.id,
            now: NOW,
          },
          tx,
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await fx.prisma.encounter.findUniqueOrThrow({ where: { id } }),
    ).toEqual(before);
    expect(
      await fx.prisma.encounterEvent.count({
        where: { encounterId: id, type: 'TRIAGE_DECIDED' },
      }),
    ).toBe(0);
  });

  it('R11: la transición genérica sigue rechazando TRIAGED (409) sin modificar la atención', async () => {
    const id = await f3.encounter(t, rec);
    await expect(
      prisma().$transaction((tx) =>
        encounters().transition(
          t.id,
          id,
          'TRIAGED',
          { type: 'STAFF', id: nurse.id },
          tx,
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await fx.prisma.encounter.findUniqueOrThrow({
        where: { id },
        select: { status: true, finalLevel: true },
      }),
    ).toEqual({ status: 'WAITING_TRIAGE', finalLevel: null });
  });
});
