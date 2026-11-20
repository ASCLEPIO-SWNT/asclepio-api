import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { createApp } from './e2e-app.js';
import { FakeLlmClient, validOutput } from './int/fake-llm.js';
import { F02Fixtures, type Staff } from './int/f02-fixtures.js';
import { VITALS } from './int/f03-fixtures.js';

const NOW = new Date('2026-11-18T15:00:00.000Z');

/** F-11-api (T7): la entrevista del pre-registro llega al LLM de F-04 saneada, con triage-v2. */
describe('F-11: instantánea v2 de la sugerencia de triage (integración, LlmClient falso)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  const clock = new FixedClock(NOW);
  const groq = new FakeLlmClient('GROQ', 'openai/gpt-oss-120b', {
    content: validOutput(),
  });
  const openRouter = new FakeLlmClient('OPENROUTER', 'openai/gpt-oss-120b', {
    fail: 'NETWORK',
  });
  let t: { id: string; siteId: string };
  let rec: Staff;
  let nurse: Staff;

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: GROQ_CLIENT, useValue: groq },
        { provide: OPENROUTER_CLIENT, useValue: openRouter },
      ],
    });
    fx = new F02Fixtures(app);
    t = await fx.tenant('f11-triage');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
  });
  afterAll(() => app.close());

  it('R9: follow_up (redactado) y patient_reported_red_flags llegan al LLM y a input_snapshot con prompt triage-v2, sin nombre ni documento', async () => {
    const p = await fx.patientUser(t.id, {
      fullName: 'DEV Rosalba Quiñones',
    });
    const pre = await fx
      .http('post', '/patient/pre-registrations', p.token)
      .send({
        siteId: t.siteId,
        chiefComplaintText: 'DEV-test dolor de cabeza',
        complaintSource: 'TYPED',
        interview: {
          engine: 'SERVER',
          modelId: 'openai/gpt-oss-120b',
          turns: [
            {
              dimension: 'ONSET',
              question: '¿Cuándo empezó, Rosalba?',
              answer: `Ayer. Soy Rosalba Quiñones, cédula ${p.documentNumber}`,
            },
            {
              dimension: 'ALARM_SIGNS',
              question: '¿Has tenido desmayos?',
              answer: 'Sí, me desmayé',
            },
          ],
          redFlags: [],
          endedBy: 'RED_FLAG',
        },
      })
      .expect(201);
    const enc = await fx
      .http(
        'post',
        `/pre-registrations/${(pre.body as { id: string }).id}/confirm`,
        rec.token,
      )
      .send({ identityVerified: true })
      .expect(201);
    const id = (enc.body as { id: string }).id;
    await fx
      .http('post', `/encounters/${id}/vital-signs`, nurse.token)
      .send(VITALS)
      .expect(201);
    groq.script({ content: validOutput() });
    const res = await fx
      .http('post', `/encounters/${id}/triage-suggestions`, nurse.token)
      .expect(201);
    expect(res.body).toMatchObject({ promptVersion: 'triage-v2' });

    const sent = JSON.parse(groq.requests[0].user) as {
      follow_up: unknown;
      patient_reported_red_flags: unknown;
    };
    expect(sent.follow_up).toEqual([
      {
        dimension: 'ONSET',
        question: '¿Cuándo empezó, [REDACTADO]?',
        answer: 'Ayer. Soy [REDACTADO] [REDACTADO], cédula [REDACTADO]',
      },
      {
        dimension: 'ALARM_SIGNS',
        question: '¿Has tenido desmayos?',
        answer: 'Sí, me desmayé',
      },
    ]);
    expect(sent.patient_reported_red_flags).toEqual(['LOSS_OF_CONSCIOUSNESS']);
    const payload = groq.requests[0].user.toLowerCase();
    for (const pii of ['rosalba', 'quiñones', p.documentNumber]) {
      expect(payload).not.toContain(pii.toLowerCase());
    }
    const row = await fx.prisma.triageSuggestion.findFirstOrThrow({
      where: { encounterId: id },
    });
    expect(row.promptVersion).toBe('triage-v2');
    expect(row.inputSnapshot).toEqual(JSON.parse(groq.requests[0].user));
  });
});
