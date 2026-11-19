import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import { createApp, problem } from './e2e-app.js';
import {
  F02Fixtures,
  type PatientUser,
  type Staff,
} from './int/f02-fixtures.js';

const NOW = new Date('2026-11-18T15:00:00.000Z');
const BENIGN = 'DEV-test dolor de cabeza desde ayer';

const turn = (dimension: string, answer: string | null) => ({
  dimension,
  question: '¿Pregunta de DEV-test?',
  answer,
});

/** Entrevista bien formada con respuestas benignas (sin señales para las reglas). */
const interview = (over: Record<string, unknown> = {}) => ({
  engine: 'ON_DEVICE',
  modelId: 'gemma-4-e2b-it',
  turns: [turn('ONSET', 'DEV-test ayer'), turn('INTENSITY', null)],
  redFlags: [],
  endedBy: 'COMPLETE',
  ...over,
});

/** F-11-api (T4): persistencia de la entrevista, unión de señales en el servidor y copia al confirmar. */
describe('F-11: entrevista en el pre-registro (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  const clock = new FixedClock(NOW);
  let t: { id: string; siteId: string; siteName: string };
  let rec: Staff;

  beforeAll(async () => {
    app = await createApp({ overrides: [{ provide: Clock, useValue: clock }] });
    fx = new F02Fixtures(app);
    t = await fx.tenant('f11-pre');
    rec = await fx.staff(t.id);
  });
  beforeEach(() => clock.set(NOW));
  afterAll(() => app.close());

  const post = (p: PatientUser, body: Record<string, unknown>) =>
    fx.http('post', '/patient/pre-registrations', p.token).send({
      siteId: t.siteId,
      chiefComplaintText: BENIGN,
      complaintSource: 'TYPED',
      ...body,
    });
  const rowOf = (id: string) =>
    fx.prisma.preRegistration.findUniqueOrThrow({
      where: { id },
      select: { symptomInterview: true, redFlags: true },
    });

  it('R1: guarda la entrevista en symptom_interview y sus redFlags en red_flags', async () => {
    const p = await fx.patientUser(t.id);
    const sent = interview({ redFlags: ['SEIZURE'], endedBy: 'RED_FLAG' });
    const res = await post(p, { interview: sent }).expect(201);
    const row = await rowOf((res.body as { id: string }).id);
    expect(row.symptomInterview).toEqual(sent);
    expect(row.redFlags).toEqual(['SEIZURE']);
  });

  it('R1: la respuesta del paciente no cambia (PatientPreRegistrationDto no lleva la entrevista ni las señales)', async () => {
    const p = await fx.patientUser(t.id);
    const res = await post(p, {
      interview: interview({ redFlags: ['SEIZURE'] }),
    }).expect(201);
    expect(Object.keys(res.body as object).sort()).toEqual([
      'encounter',
      'expiresAt',
      'id',
      'preRegisteredAt',
      'siteId',
      'siteName',
      'status',
    ]);
  });

  it('R2: una entrevista mal formada → 400 problem+json, sin crear el pre-registro ni repetir los valores', async () => {
    const p = await fx.patientUser(t.id);
    const res = await post(p, {
      interview: interview({
        turns: Array.from({ length: 7 }, () => turn('ONSET', 'DEV-ECO-91c2')),
        engine: 'DEV-ECO-91c2',
      }),
    }).expect(400);
    expect(problem(res).status).toBe(400);
    expect(res.text).not.toContain('DEV-ECO-91c2');
    expect(
      await fx.prisma.preRegistration.count({
        where: { patientId: p.patientId },
      }),
    ).toBe(0);
  });

  it('R3: sin interview se crea como en 0.10.0, con symptom_interview NULL y red_flags vacío', async () => {
    const p = await fx.patientUser(t.id);
    const res = await post(p, {}).expect(201);
    const row = await rowOf((res.body as { id: string }).id);
    expect(row).toEqual({ symptomInterview: null, redFlags: [] });
  });

  it('R4: el cliente envía [] y una respuesta "me desmayé" → el servidor añade LOSS_OF_CONSCIOUSNESS', async () => {
    const p = await fx.patientUser(t.id);
    const sent = interview({
      turns: [turn('ALARM_SIGNS', 'Sí, me desmayé esta mañana')],
    });
    const res = await post(p, { interview: sent }).expect(201);
    const row = await rowOf((res.body as { id: string }).id);
    expect(row.redFlags).toEqual(['LOSS_OF_CONSCIOUSNESS']);
    // La entrevista se guarda tal como la envió el paciente.
    expect(row.symptomInterview).toEqual(sent);
  });

  it('R4: el motivo también se revisa y nunca se quitan las señales del cliente', async () => {
    const p = await fx.patientUser(t.id);
    const res = await post(p, {
      chiefComplaintText: 'DEV-test me falta el aire',
      interview: interview({
        redFlags: ['SUICIDAL_IDEATION'],
        turns: [turn('ASSOCIATED', 'Dolor fuerte en el pecho')],
      }),
    }).expect(201);
    const row = await rowOf((res.body as { id: string }).id);
    expect(row.redFlags).toEqual([
      'SUICIDAL_IDEATION',
      'CHEST_PAIN',
      'BREATHING_DIFFICULTY',
    ]);
  });

  it('R4: sin interview, un motivo con señal de alarma también queda marcado (las reglas del servidor siempre se aplican)', async () => {
    const p = await fx.patientUser(t.id);
    const res = await post(p, {
      chiefComplaintText: 'DEV-test convulsionó en la casa',
    }).expect(201);
    const row = await rowOf((res.body as { id: string }).id);
    expect(row).toEqual({ symptomInterview: null, redFlags: ['SEIZURE'] });
  });

  it('R5: al confirmar, la atención recibe symptom_interview y red_flags en la misma transacción que el motivo', async () => {
    const p = await fx.patientUser(t.id);
    const sent = interview({ redFlags: ['STROKE_SIGNS'] });
    const pre = await post(p, { interview: sent }).expect(201);
    const res = await fx
      .http(
        'post',
        `/pre-registrations/${(pre.body as { id: string }).id}/confirm`,
        rec.token,
      )
      .send({ identityVerified: true })
      .expect(201);
    const enc = await fx.prisma.encounter.findUniqueOrThrow({
      where: { id: (res.body as { id: string }).id },
      select: {
        chiefComplaintText: true,
        symptomInterview: true,
        redFlags: true,
      },
    });
    expect(enc).toEqual({
      chiefComplaintText: BENIGN,
      symptomInterview: sent,
      redFlags: ['STROKE_SIGNS'],
    });
  });

  it('R5: sin entrevista, la atención confirmada y la directa quedan con NULL y sin señales', async () => {
    const p = await fx.patientUser(t.id);
    const pre = await post(p, {}).expect(201);
    const confirmed = await fx
      .http(
        'post',
        `/pre-registrations/${(pre.body as { id: string }).id}/confirm`,
        rec.token,
      )
      .send({ identityVerified: true })
      .expect(201);
    const other = await fx.patient(t.id);
    const direct = await fx
      .http('post', '/encounters', rec.token)
      .send({
        patientId: other.id,
        siteId: t.siteId,
        chiefComplaintText: BENIGN,
        complaintSource: 'TYPED',
      })
      .expect(201);
    const ids = [confirmed, direct].map((r) => (r.body as { id: string }).id);
    for (const id of ids) {
      expect(
        await fx.prisma.encounter.findUniqueOrThrow({
          where: { id },
          select: { symptomInterview: true, redFlags: true },
        }),
      ).toEqual({ symptomInterview: null, redFlags: [] });
    }
  });
});
