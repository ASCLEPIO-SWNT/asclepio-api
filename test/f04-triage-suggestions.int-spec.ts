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
import { randomDoc } from './int/fixtures.js';

const NOW = new Date('2026-11-09T17:00:00.000Z');
const NOT_WAITING =
  'La atención no está en espera de triage: no admite captura clínica.';
const NO_VITALS = 'La atención no tiene signos vitales registrados.';

interface SuggestionBody {
  id: string;
  encounterId: string;
  status: string;
  suggestedLevel: number | null;
  llmLevel: number | null;
  explanation: string | null;
  factors: { field: string; note: string }[] | null;
  guardApplied: boolean;
  guardReasons: unknown[];
  provider: string | null;
  model: string | null;
  promptVersion: string;
  latencyMs: number;
  createdAt: string;
  requestedBy: { id: string; fullName: string | null };
}

describe('F-04: POST /encounters/{id}/triage-suggestions (integración, LlmClient falso)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  const clock = new FixedClock(NOW);
  const groq = new FakeLlmClient('GROQ', 'openai/gpt-oss-120b', {
    content: validOutput(),
  });
  const openRouter = new FakeLlmClient('OPENROUTER', 'openai/gpt-oss-120b', {
    content: validOutput(),
  });
  let t: { id: string; siteId: string };
  let other: { id: string; siteId: string };
  let rec: Staff;
  let nurse: Staff;
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
    t = await fx.tenant('f04-sug');
    other = await fx.tenant('f04-sug-other');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
    otherNurse = await fx.staff(other.id, 'NURSE');
  });
  beforeEach(() => {
    clock.set(NOW);
    groq.script();
    openRouter.script();
  });
  afterAll(() => app.close());

  const suggest = (id: string, token = nurse.token, body?: object) => {
    const req = fx.http('post', `/encounters/${id}/triage-suggestions`, token);
    return body === undefined ? req : req.send(body);
  };
  const vitals = (id: string, body: object = VITALS) =>
    fx
      .http('post', `/encounters/${id}/vital-signs`, nurse.token)
      .send(body)
      .expect(201);
  const rows = (encounterId: string) =>
    fx.prisma.triageSuggestion.findMany({
      where: { encounterId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  const calls = () => groq.requests.length + openRouter.requests.length;

  async function readyEncounter(): Promise<string> {
    const id = await f3.encounter(t, rec);
    await vitals(id);
    return id;
  }

  it('R1: con una atención en WAITING_TRIAGE y signos vitales responde 201 con la sugerencia OK y guarda una fila', async () => {
    const id = await readyEncounter();
    groq.script({ content: validOutput(2), tokens: [812, 95] });
    const res = await suggest(id).expect(201);
    const body = res.body as SuggestionBody;
    expect(body).toEqual({
      id: body.id,
      encounterId: id,
      status: 'OK',
      suggestedLevel: 2,
      llmLevel: 2,
      explanation:
        'Dolor torácico con taquicardia: descartar síndrome coronario agudo.',
      factors: [
        { field: 'chief_complaint_text', note: 'Dolor torácico' },
        { field: 'vital_signs.heart_rate', note: 'Taquicardia' },
      ],
      guardApplied: false,
      guardReasons: [],
      provider: 'GROQ',
      model: 'openai/gpt-oss-120b',
      promptVersion: 'triage-v1',
      latencyMs: expect.any(Number) as number,
      createdAt: NOW.toISOString(),
      requestedBy: { id: nurse.id, fullName: nurse.fullName },
    });
    expect(await rows(id)).toHaveLength(1);
    // Un cuerpo {} también se acepta.
    await suggest(id, nurse.token, {}).expect(201);
  });

  it('R1: también responde 201 y guarda la fila cuando el resultado es TIMEOUT, FAILED o INVALID_OUTPUT', async () => {
    const cases: [string, () => void][] = [
      [
        'TIMEOUT',
        () => {
          groq.script({ fail: 'TIMEOUT' });
          openRouter.script({ fail: 'TIMEOUT' });
        },
      ],
      [
        'FAILED',
        () => {
          groq.script({ fail: 'HTTP', http: 500 });
          openRouter.script({ fail: 'NETWORK' });
        },
      ],
      ['INVALID_OUTPUT', () => groq.script({ content: 'Nivel II' })],
    ];
    for (const [status, arrange] of cases) {
      const id = await readyEncounter();
      arrange();
      const res = await suggest(id).expect(201);
      expect(res.body).toMatchObject({
        status,
        suggestedLevel: null,
        llmLevel: null,
        explanation: null,
        factors: null,
        guardApplied: false,
        guardReasons: [],
      });
      const [row] = await rows(id);
      expect(row).toMatchObject({
        status,
        llmLevel: null,
        suggestedLevel: null,
        explanation: null,
      });
      expect(row.rawResponse).toBe(
        status === 'INVALID_OUTPUT' ? 'Nivel II' : null,
      );
    }
  });

  it('R2: responde 409 en REGISTERED, TRIAGED, IN_CARE, CLOSED y CANCELLED sin llamar al LLM ni insertar filas', async () => {
    for (const status of [
      'REGISTERED',
      'TRIAGED',
      'IN_CARE',
      'CLOSED',
      'CANCELLED',
    ] as const) {
      const id = await readyEncounter();
      await f3.setStatus(id, status);
      const res = await suggest(id).expect(409);
      expect([status, problem(res).detail]).toEqual([status, NOT_WAITING]);
      expect(await rows(id)).toHaveLength(0);
    }
    expect(calls()).toBe(0);
  });

  it('R3: responde 409 con un detail propio si la atención no tiene signos vitales, sin llamar al LLM ni insertar filas', async () => {
    const id = await f3.encounter(t, rec);
    await fx
      .http('post', `/encounters/${id}/symptom-findings`, nurse.token)
      .send({ items: [{ kind: 'SYMPTOM', description: 'DEV-test tos' }] })
      .expect(201);
    const res = await suggest(id).expect(409);
    expect(problem(res).detail).toBe(NO_VITALS);
    expect(NO_VITALS).not.toBe(NOT_WAITING);
    expect(await rows(id)).toHaveLength(0);
    expect(calls()).toBe(0);
  });

  it('R4: responde 404 igual para una atención de otro tenant, inexistente o con id mal formado, sin llamar al LLM', async () => {
    const id = await readyEncounter();
    const bodies = [];
    for (const [target, token] of [
      [id, otherNurse.token],
      ['00000000-0000-4000-8000-000000000000', nurse.token],
      ['zz-mal-formado', nurse.token],
    ]) {
      const res = await suggest(target, token).expect(404);
      bodies.push({ ...problem(res), instance: undefined });
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(await rows(id)).toHaveLength(0);
    expect(calls()).toBe(0);
  });

  it('R5: un cuerpo con campos (level, provider, model, createdAt, inputSnapshot) responde 400 sin llamar al LLM ni insertar filas', async () => {
    const id = await readyEncounter();
    for (const body of [
      { level: 1 },
      { provider: 'GROQ' },
      { model: 'x' },
      { createdAt: NOW.toISOString() },
      { inputSnapshot: {} },
    ]) {
      const res = await suggest(id, nurse.token, body).expect(400);
      expect(problem(res).status).toBe(400);
    }
    expect(await rows(id)).toHaveLength(0);
    expect(calls()).toBe(0);
  });

  it('R6: una segunda solicitud inserta otra fila y deja la primera intacta', async () => {
    const id = await readyEncounter();
    groq.script({ content: validOutput(2) }, { content: validOutput(3) });
    const first = (await suggest(id).expect(201)).body as SuggestionBody;
    const before = await fx.prisma.triageSuggestion.findUniqueOrThrow({
      where: { id: first.id },
    });
    clock.advance(60_000);
    const second = (await suggest(id).expect(201)).body as SuggestionBody;
    expect(second.id).not.toBe(first.id);
    const all = await rows(id);
    expect(all.map((r) => r.id)).toEqual([first.id, second.id]);
    expect(all[0]).toEqual(before);
    expect(all[1].llmLevel).toBe(3);
  });

  it('R20: guarda cada columna: tenant y responsable del token, created_at del reloj, instantánea, guard, proveedor y modelo, tokens, latencia y attempts', async () => {
    const id = await readyEncounter();
    groq.script({ fail: 'HTTP', http: 503 });
    openRouter.script({
      content: validOutput(4),
      model: 'openai/gpt-oss-120b:proveedor-x',
      tokens: [900, 120],
    });
    const res = await suggest(id).expect(201);
    const row = await fx.prisma.triageSuggestion.findUniqueOrThrow({
      where: { id: (res.body as SuggestionBody).id },
    });
    expect(row).toMatchObject({
      tenantId: t.id,
      encounterId: id,
      requestedBy: nurse.id,
      status: 'OK',
      llmLevel: 4,
      // VITALS suma NEWS2 = 5 → G2 limita a III.
      suggestedLevel: 3,
      explanation: {
        summary:
          'Dolor torácico con taquicardia: descartar síndrome coronario agudo.',
        factors: [
          { field: 'chief_complaint_text', note: 'Dolor torácico' },
          { field: 'vital_signs.heart_rate', note: 'Taquicardia' },
        ],
      },
      guardApplied: true,
      guardReasons: [{ rule: 'G2', maxLevel: 3, trigger: { news2Total: 5 } }],
      provider: 'OPENROUTER',
      model: 'openai/gpt-oss-120b:proveedor-x',
      promptVersion: 'triage-v1',
      rawResponse: validOutput(4),
      tokensIn: 900,
      tokensOut: 120,
      createdAt: NOW,
    });
    expect(row.latencyMs).toBeGreaterThanOrEqual(0);
    expect(row.attempts).toEqual([
      {
        provider: 'GROQ',
        model: 'openai/gpt-oss-120b',
        outcome: 'HTTP',
        latencyMs: expect.any(Number) as number,
        httpStatus: 503,
      },
      {
        provider: 'OPENROUTER',
        model: 'openai/gpt-oss-120b:proveedor-x',
        outcome: 'OK',
        latencyMs: expect.any(Number) as number,
        httpStatus: 200,
      },
    ]);
    expect(row.inputSnapshot).toEqual({
      // Paciente de F02Fixtures.patient: nacido el 1970-01-01, sexo M.
      age_years: 56,
      sex: 'M',
      chief_complaint_text:
        '[REDACTADO]-[REDACTADO] dolor torácico desde la mañana',
      complaint_source: 'TYPED',
      vital_signs: {
        respiratory_rate: VITALS.respiratoryRate,
        spo2: VITALS.oxygenSaturation,
        supplemental_oxygen: VITALS.supplementalOxygen,
        systolic_bp: VITALS.systolicBp,
        diastolic_bp: VITALS.diastolicBp,
        heart_rate: VITALS.heartRate,
        consciousness: VITALS.consciousness,
        temperature_c: VITALS.temperatureC,
        glucose_mg_dl: VITALS.glucoseMgDl,
      },
      symptom_findings: [],
    });
  });

  it('R20: con la toma vigente (la de mayor recorded_at) y todos los hallazgos en orden', async () => {
    const id = await f3.encounter(t, rec);
    await vitals(id, { ...VITALS, heartRate: 80 });
    clock.advance(60_000);
    await vitals(id, { ...VITALS, heartRate: 131 });
    // Orden D7: recorded_at y después id. Dos capturas en horas distintas fijan el orden sin depender del uuid.
    for (const [kind, description] of [
      ['FINDING', 'DEV-test primero'],
      ['SYMPTOM', 'DEV-test segundo'],
    ]) {
      clock.advance(1000);
      await fx
        .http('post', `/encounters/${id}/symptom-findings`, nurse.token)
        .send({ items: [{ kind, description }] })
        .expect(201);
    }
    groq.script({ content: validOutput(2) });
    await suggest(id).expect(201);
    const sent = JSON.parse(groq.requests[0].user) as {
      vital_signs: { heart_rate: number };
      symptom_findings: { kind: string }[];
    };
    expect(sent.vital_signs.heart_rate).toBe(131);
    expect(sent.symptom_findings.map((f) => f.kind)).toEqual([
      'FINDING',
      'SYMPTOM',
    ]);
  });

  it('R23: la solicitud no modifica la atención (status, updated_at, motivo) ni crea decisiones de triage', async () => {
    const id = await readyEncounter();
    const before = await fx.prisma.encounter.findUniqueOrThrow({
      where: { id },
    });
    const events = await fx.prisma.encounterEvent.count({
      where: { encounterId: id },
    });
    clock.advance(120_000);
    await suggest(id).expect(201);
    expect(
      await fx.prisma.encounter.findUniqueOrThrow({ where: { id } }),
    ).toEqual(before);
    expect(
      await fx.prisma.encounterEvent.count({ where: { encounterId: id } }),
    ).toBe(events);
    // F-05 creó triage_decisions: la sugerencia no inserta ninguna decisión.
    expect(
      await fx.prisma.triageDecision.count({ where: { encounterId: id } }),
    ).toBe(0);
  });

  it('R25: inserta en la misma transacción la auditoría TRIAGE_SUGGESTION_CREATED con encounterId, status y guardApplied, sin niveles', async () => {
    const id = await readyEncounter();
    groq.script({ content: validOutput(4) });
    const body = (await suggest(id).expect(201)).body as SuggestionBody;
    const audits = await fx.audits({
      entityId: body.id,
      action: 'TRIAGE_SUGGESTION_CREATED',
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: 'STAFF',
      actorId: nurse.id,
      tenantId: t.id,
      entity: 'triage_suggestions',
      entityId: body.id,
      metadata: { encounterId: id, status: 'OK', guardApplied: true },
      occurredAt: NOW,
    });
    expect(Object.keys(audits[0].metadata as object).sort()).toEqual([
      'encounterId',
      'guardApplied',
      'status',
    ]);
  });

  it('R10: el cliente LLM solo recibe la instantánea: ni el nombre, ni sus palabras, ni el documento, ni los ids', async () => {
    const documentNumber = randomDoc();
    const patient = await fx.patient(t.id, {
      fullName: 'Zoraida Villamizar Quiceno',
      documentNumber,
    });
    const created = await fx
      .http('post', '/encounters', rec.token)
      .send({
        patientId: patient.id,
        siteId: t.siteId,
        chiefComplaintText: `Zoraida Villamizar Quiceno, documento ${documentNumber}, con dolor torácico`,
        complaintSource: 'TYPED',
      })
      .expect(201);
    const id = (created.body as { id: string }).id;
    await vitals(id);
    await fx
      .http('post', `/encounters/${id}/symptom-findings`, nurse.token)
      .send({
        items: [
          {
            kind: 'COMPLAINT_NOTE',
            description: 'la acompaña la hermana de VILLAMIZAR',
          },
        ],
      })
      .expect(201);
    groq.script({ fail: 'TIMEOUT' });
    openRouter.script({ content: validOutput(2) });
    await suggest(id).expect(201);
    const sent = JSON.stringify([
      ...groq.requests,
      ...openRouter.requests,
    ]).toLowerCase();
    for (const needle of [
      'zoraida',
      'villamizar',
      'quiceno',
      documentNumber,
      patient.id,
      id,
      t.id,
      nurse.id,
    ]) {
      expect([needle, sent.includes(needle)]).toEqual([needle, false]);
    }
    const [row] = await rows(id);
    expect(JSON.stringify(row.inputSnapshot).toLowerCase()).not.toMatch(
      /zoraida|villamizar|quiceno/,
    );
  });

  it('R7: registrar signos vitales y hallazgos (F-03) no llama al LLM ni crea sugerencias', async () => {
    const id = await f3.encounter(t, rec);
    await vitals(id);
    await fx
      .http('post', `/encounters/${id}/symptom-findings`, nurse.token)
      .send({ items: [{ kind: 'SYMPTOM', description: 'DEV-test fiebre' }] })
      .expect(201);
    await fx
      .http('get', `/encounters/${id}/clinical-capture`, nurse.token)
      .expect(200);
    expect(calls()).toBe(0);
    expect(await rows(id)).toHaveLength(0);
  });
});

describe('F-04: fallo cerrado de la auditoría de la sugerencia (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  const groq = new FakeLlmClient('GROQ', 'openai/gpt-oss-120b', {
    content: validOutput(),
  });

  beforeAll(async () => {
    FailingAuditService.failOn = new Set(['TRIAGE_SUGGESTION_CREATED']);
    app = await createApp({
      overrides: [
        { provide: AuditService, useClass: FailingAuditService },
        { provide: GROQ_CLIENT, useValue: groq },
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

  it('R26: si falla la auditoría responde 500 problem+json y no queda ninguna fila de la sugerencia', async () => {
    const t = await fx.tenant('f04-audit-fail');
    const rec = await fx.staff(t.id);
    const nurse = await fx.staff(t.id, 'NURSE');
    const id = await f3.encounter(t, rec);
    await fx
      .http('post', `/encounters/${id}/vital-signs`, nurse.token)
      .send(VITALS)
      .expect(201);
    const res = await fx
      .http('post', `/encounters/${id}/triage-suggestions`, nurse.token)
      .expect(500);
    expect(problem(res).status).toBe(500);
    expect(
      await fx.prisma.triageSuggestion.count({ where: { encounterId: id } }),
    ).toBe(0);
    expect(
      await fx.prisma.auditLog.count({
        where: {
          action: 'TRIAGE_SUGGESTION_CREATED',
          metadata: { path: ['encounterId'], equals: id },
        },
      }),
    ).toBe(0);
  });
});
