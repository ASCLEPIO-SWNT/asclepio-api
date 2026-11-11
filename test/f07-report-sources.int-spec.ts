import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { TriageSuggestionsService } from '../src/modules/ai/triage-suggestions.service.js';
import { EncountersService } from '../src/modules/encounters/encounters.service.js';
import { TriageDecisionsService } from '../src/modules/triage/triage-decisions.service.js';
import { parsePeriod } from '../src/modules/reports/report-period.js';
import { createApp } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { F02Fixtures } from './int/f02-fixtures.js';
import {
  F07Flow,
  insertSuggestionAsOwner,
  type StaffRef,
  RAW_MARKER,
  SNAPSHOT_MARKER,
} from './int/f07-fixtures.js';

/** Bogotá −05:00. */
const bog = (local: string) => new Date(`${local}-05:00`);
const REASON = 'DEV-test motivo de corrección f07-sources';

/** F-07-api · T5: los tres métodos de lectura de D2 (encounters, triage y ai), sin cruzar tablas desde reports. */
describe('F-07: métodos de lectura de los reportes (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let flow: F07Flow;
  const clock = new FixedClock(bog('2026-11-05T08:00:00'));
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  let t: { id: string; siteId: string; siteName: string };
  let siteB: { id: string; name: string };
  let other: { id: string; siteId: string; siteName: string };
  let rec: StaffRef;
  let nurse: StaffRef;
  let physician: StaffRef;
  const e: Record<string, string> = {};
  const s: Record<string, string> = {};
  const period = parsePeriod('2026-11-01', '2026-11-10');

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: GROQ_CLIENT, useValue: fake },
        { provide: OPENROUTER_CLIENT, useValue: fake },
      ],
    });
    fx = new F02Fixtures(app);
    flow = new F07Flow(app, fx, clock);
    t = await fx.tenant('f07-sources');
    siteB = await fx.site(t.id, 'DEV-test Sede Sur');
    other = await fx.tenant('f07-sources-otro');
    rec = await flow.staff(t.id, 'RECEPTION');
    nurse = await flow.staff(t.id, 'NURSE');
    physician = await flow.staff(t.id, 'PHYSICIAN');
    const otherRec = await flow.staff(other.id, 'RECEPTION');
    const otherNurse = await flow.staff(other.id, 'NURSE');

    // Primer instante del periodo (00:00:00 de Bogotá del día from), sede A: VALIDATE, IN_CARE y CLOSED.
    e.first = await flow.arrive(bog('2026-11-01T00:00:00'), t, rec);
    s.first = await insertSuggestionAsOwner({
      tenantId: t.id,
      encounterId: e.first,
      requestedBy: nurse.id,
      createdAt: bog('2026-11-01T00:05:00'),
      suggestedLevel: 2,
      llmLevel: 3,
    });
    await flow.decide(e.first, bog('2026-11-01T00:10:00'), nurse, {
      action: 'VALIDATE',
      suggestionId: s.first,
    });
    await flow.move(
      e.first,
      'start-care',
      bog('2026-11-01T00:35:00'),
      physician,
    );
    await flow.move(e.first, 'close', bog('2026-11-01T01:00:00'), physician);

    // Último segundo del periodo (23:59:59 de Bogotá del día to), sede B: CORRECT con motivo, sin IN_CARE.
    e.last = await flow.arrive(
      bog('2026-11-10T23:59:59'),
      { id: t.id, siteId: siteB.id },
      rec,
    );
    s.last = await insertSuggestionAsOwner({
      tenantId: t.id,
      encounterId: e.last,
      requestedBy: nurse.id,
      createdAt: bog('2026-11-11T00:01:00'),
      suggestedLevel: 3,
      provider: 'OPENROUTER',
    });
    await flow.decide(e.last, bog('2026-11-11T00:02:00'), nurse, {
      action: 'CORRECT',
      suggestionId: s.last,
      level: 2,
      reason: REASON,
    });

    // Fuera: el instante anterior al periodo y las 00:00:00 de Bogotá del día siguiente a to.
    e.before = await flow.arrive(bog('2026-10-31T23:59:59'), t, rec);
    e.after = await flow.arrive(bog('2026-11-11T00:00:00'), t, rec);
    // Dentro, sin decisión, con una sugerencia FAILED.
    e.waiting = await flow.arrive(bog('2026-11-05T12:00:00'), t, rec);
    s.waiting = await insertSuggestionAsOwner({
      tenantId: t.id,
      encounterId: e.waiting,
      requestedBy: nurse.id,
      createdAt: bog('2026-11-05T12:01:00'),
      status: 'FAILED',
    });
    // Otro tenant en el mismo periodo, con decisión y sugerencia.
    e.other = await flow.arrive(bog('2026-11-05T12:00:00'), other, otherRec);
    s.other = await insertSuggestionAsOwner({
      tenantId: other.id,
      encounterId: e.other,
      requestedBy: otherNurse.id,
      createdAt: bog('2026-11-05T12:01:00'),
      status: 'TIMEOUT',
    });
    await flow.decide(e.other, bog('2026-11-05T12:03:00'), otherNurse, {
      action: 'MANUAL',
      level: 4,
    });
  });
  afterAll(() => app.close());

  const encounters = () => app.get(EncountersService);

  it('R3: listForReport toma la población por arrival_at en [from 00:00 −05:00, to+1 00:00 −05:00), ordenada por llegada e id', async () => {
    const rows = await encounters().listForReport(
      t.id,
      period.start,
      period.end,
    );
    expect(rows.map((r) => r.id)).toEqual([e.first, e.waiting, e.last]);
    expect(rows.map((r) => r.id)).not.toContain(e.before);
    expect(rows.map((r) => r.id)).not.toContain(e.after);
  });

  it('R4: listForReport con siteId limita a esa sede; una sede de otro tenant o inexistente → vacío', async () => {
    const b = await encounters().listForReport(
      t.id,
      period.start,
      period.end,
      siteB.id,
    );
    expect(b.map((r) => r.id)).toEqual([e.last]);
    expect(
      await encounters().listForReport(
        t.id,
        period.start,
        period.end,
        other.siteId,
      ),
    ).toEqual([]);
    expect(
      await encounters().listForReport(
        t.id,
        period.start,
        period.end,
        '99999999-9999-4999-8999-999999999999',
      ),
    ).toEqual([]);
  });

  it('R3: cada fila trae sede, estado, origen, fuente, llegada, triage, nivel final e in_care_at y closed_at tomados de los eventos; sin datos del paciente', async () => {
    const rows = await encounters().listForReport(
      t.id,
      period.start,
      period.end,
    );
    const first = rows.find((r) => r.id === e.first)!;
    expect(first).toEqual({
      id: e.first,
      siteId: t.siteId,
      siteName: t.siteName,
      status: 'CLOSED',
      origin: 'DIRECT',
      complaintSource: 'TYPED',
      arrivalAt: bog('2026-11-01T00:00:00'),
      triagedAt: bog('2026-11-01T00:10:00'),
      finalLevel: 2,
      inCareAt: bog('2026-11-01T00:35:00'),
      closedAt: bog('2026-11-01T01:00:00'),
    });
    expect(rows.find((r) => r.id === e.last)).toMatchObject({
      siteName: siteB.name,
      status: 'TRIAGED',
      finalLevel: 2,
      triagedAt: bog('2026-11-11T00:02:00'),
      inCareAt: null,
      closedAt: null,
    });
    expect(rows.find((r) => r.id === e.waiting)).toMatchObject({
      status: 'WAITING_TRIAGE',
      triagedAt: null,
      finalLevel: null,
    });
    expect(JSON.stringify(rows)).not.toMatch(
      /patient|fullName|document|chiefComplaint|DEV-test dolor|registeredBy|triagedBy/,
    );
  });

  it('R17: TriageDecisionsService.listByEncounters devuelve encounterId, action, level y suggestionId, sin reason, solo del tenant', async () => {
    const decisions = app.get(TriageDecisionsService);
    const ids = [e.first, e.last, e.waiting, e.other];
    const rows = await decisions.listByEncounters(t.id, ids);
    expect(
      [...rows].sort((a, b) => (a.encounterId < b.encounterId ? -1 : 1)),
    ).toEqual(
      [
        {
          encounterId: e.first,
          action: 'VALIDATE',
          level: 2,
          suggestionId: s.first,
        },
        {
          encounterId: e.last,
          action: 'CORRECT',
          level: 2,
          suggestionId: s.last,
        },
      ].sort((a, b) => (a.encounterId < b.encounterId ? -1 : 1)),
    );
    expect(JSON.stringify(rows)).not.toContain(REASON);
    // El otro tenant ve solo la suya; con lista vacía, nada (sin consulta).
    expect(await decisions.listByEncounters(other.id, ids)).toEqual([
      { encounterId: e.other, action: 'MANUAL', level: 4, suggestionId: null },
    ]);
    expect(await decisions.listByEncounters(t.id, [])).toEqual([]);
  });

  it('R17: TriageSuggestionsService.listByEncounters devuelve los campos de D2, sin instantánea ni respuesta cruda, solo del tenant', async () => {
    const suggestions = app.get(TriageSuggestionsService);
    const ids = [e.first, e.last, e.waiting, e.other];
    const rows = await suggestions.listByEncounters(t.id, ids);
    expect(rows.map((r) => r.id).sort()).toEqual(
      [s.first, s.last, s.waiting].sort(),
    );
    expect(rows.find((r) => r.id === s.first)).toEqual({
      id: s.first,
      encounterId: e.first,
      status: 'OK',
      suggestedLevel: 2,
      llmLevel: 3,
      guardApplied: true,
      provider: 'GROQ',
      createdAt: bog('2026-11-01T00:05:00'),
    });
    expect(rows.find((r) => r.id === s.waiting)).toMatchObject({
      status: 'FAILED',
      suggestedLevel: null,
      llmLevel: null,
      guardApplied: false,
      provider: null,
    });
    const text = JSON.stringify(rows);
    expect(text).not.toContain(RAW_MARKER);
    expect(text).not.toContain(SNAPSHOT_MARKER);
    expect(text).not.toMatch(/inputSnapshot|rawResponse|explanation|attempts/);
    expect(
      (await suggestions.listByEncounters(other.id, ids)).map((r) => r.id),
    ).toEqual([s.other]);
    expect(await suggestions.listByEncounters(t.id, [])).toEqual([]);
  });

  it('R17: listForReport de un tenant nunca devuelve atenciones de otro, aunque coincidan periodo y hora', async () => {
    const mine = await encounters().listForReport(
      t.id,
      period.start,
      period.end,
    );
    const theirs = await encounters().listForReport(
      other.id,
      period.start,
      period.end,
    );
    expect(mine.map((r) => r.id)).not.toContain(e.other);
    expect(theirs.map((r) => r.id)).toEqual([e.other]);
    expect(theirs[0].siteName).toBe(other.siteName);
  });
});
