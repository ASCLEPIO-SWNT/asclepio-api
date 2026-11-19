import { randomUUID } from 'node:crypto';
import type { INestApplication, LoggerService } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import {
  FIXED_QUESTIONS,
  QUESTION_OUTPUT_SCHEMA,
} from '../src/modules/interview/interview.rules.js';
import { PatientsService } from '../src/modules/patients/patients.service.js';
import { createApp } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';

const TENANT = '22222222-2222-4222-8222-222222222222';
const NAME = 'Rosalba Quiñones Cárdenas';
const DOC = '1012345678';
const PATH = '/api/v1/patient/symptom-interview/next-question';

/** Salida del LLM del fallback. */
const out = (over: Record<string, unknown> = {}) => ({
  content: JSON.stringify({
    done: false,
    question: '¿Dónde sientes el dolor?',
    dimension: 'LOCATION',
    redFlagSuspected: false,
    ...over,
  }),
});

const turn = (dimension: string, answer: string | null = 'DEV ayer') => ({
  dimension,
  question: '¿Pregunta de prueba?',
  answer,
});

/** Logger que guarda todo lo que la app escribe (R15: sin contenido de la petición ni de la respuesta). */
class CaptureLogger implements LoggerService {
  readonly lines: string[] = [];
  private push(...args: unknown[]) {
    this.lines.push(JSON.stringify(args));
  }
  log(...a: unknown[]) {
    this.push(...a);
  }
  error(...a: unknown[]) {
    this.push(...a);
  }
  warn(...a: unknown[]) {
    this.push(...a);
  }
  debug(...a: unknown[]) {
    this.push(...a);
  }
  verbose(...a: unknown[]) {
    this.push(...a);
  }
}

/**
 * F-11-api (T8): POST /patient/symptom-interview/next-question sin base. El LLM es un LlmClient falso (nunca Groq ni
 * OpenRouter) y PatientsService devuelve el nombre y el documento del paciente del token para redact().
 */
describe('F-11: next-question con el LLM falso (e2e, sin base)', () => {
  let app: INestApplication<App>;
  const groq = new FakeLlmClient('GROQ', 'openai/gpt-oss-120b', out());
  const openRouter = new FakeLlmClient(
    'OPENROUTER',
    'openai/gpt-oss-120b',
    out(),
  );
  const logger = new CaptureLogger();
  /** PatientsService falso: registra (tenantId, patientId) y devuelve el paciente para redact(). */
  const patients = {
    calls: [] as [string, string][],
    findById(tenantId: string, id: string) {
      patients.calls.push([tenantId, id]);
      return Promise.resolve({
        id,
        documentType: 'CC',
        documentNumber: DOC,
        fullName: NAME,
        birthDate: '1980-01-01',
        estimatedAgeYears: null,
        sex: 'F',
        isNN: false,
      });
    },
  };

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: GROQ_CLIENT, useValue: groq },
        { provide: OPENROUTER_CLIENT, useValue: openRouter },
        { provide: PatientsService, useValue: patients },
      ],
      logger,
    });
  });
  beforeEach(() => {
    groq.script();
    openRouter.script();
    patients.calls.length = 0;
  });
  afterAll(() => app.close());

  /** Un paciente nuevo por llamada: el límite de R16 no se acumula entre pruebas. */
  async function ask(body: Record<string, unknown>) {
    const patientId = randomUUID();
    const { accessToken } = await app.get(TokenService).issuePatient({
      id: randomUUID(),
      tenantId: TENANT,
      patientId,
    });
    const res = await request(app.getHttpServer())
      .post(PATH)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ chiefComplaintText: 'DEV dolor de cabeza', turns: [], ...body });
    return { res, patientId };
  }
  const llmCalls = () => groq.requests.length + openRouter.requests.length;

  it('R11: sin señales pide la pregunta al LLM (Groq) y responde 200 QUESTION con dimension y question', async () => {
    groq.script(out());
    const { res, patientId } = await ask({ turns: [turn('ONSET')] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      kind: 'QUESTION',
      dimension: 'LOCATION',
      question: '¿Dónde sientes el dolor?',
    });
    expect(groq.requests).toHaveLength(1);
    expect(openRouter.requests).toHaveLength(0);
    expect(groq.requests[0].schema).toEqual(QUESTION_OUTPUT_SCHEMA);
    expect(groq.requests[0].system).toMatch(/No diagnostiques/);
    // El paciente sale solo del token (pid y tid).
    expect(patients.calls).toEqual([[TENANT, patientId]]);
  });

  it('R11: si Groq falla en la llamada, la pide a OpenRouter', async () => {
    groq.script({ fail: 'HTTP', http: 503 });
    openRouter.script(out({ dimension: 'ONSET', question: '¿Cuándo empezó?' }));
    const { res } = await ask({});
    expect(res.body).toEqual({
      kind: 'QUESTION',
      dimension: 'ONSET',
      question: '¿Cuándo empezó?',
    });
    expect(openRouter.requests).toHaveLength(1);
  });

  it('R11: aplica primero las reglas: una señal en el motivo o en una respuesta → RED_FLAG sin llamar al LLM', async () => {
    const a = await ask({ chiefComplaintText: 'Me desmayé en el bus' });
    expect(a.res.status).toBe(200);
    expect(a.res.body).toEqual({
      kind: 'RED_FLAG',
      redFlags: ['LOSS_OF_CONSCIOUSNESS'],
    });
    const b = await ask({
      turns: [turn('ASSOCIATED', 'tengo presión en el pecho y me ahogo')],
    });
    expect(b.res.body).toEqual({
      kind: 'RED_FLAG',
      redFlags: ['CHEST_PAIN', 'BREATHING_DIFFICULTY'],
    });
    expect(llmCalls()).toBe(0);
  });

  it('R12: una salida inválida se reintenta una vez; si la segunda es válida, se usa', async () => {
    groq.script(
      out({ question: '¿Tienes migraña?' }),
      out({ dimension: 'INTENSITY', question: '¿Qué tan fuerte es?' }),
    );
    const { res } = await ask({});
    expect(res.body).toEqual({
      kind: 'QUESTION',
      dimension: 'INTENSITY',
      question: '¿Qué tan fuerte es?',
    });
    expect(groq.requests).toHaveLength(2);
  });

  it('R12: dos salidas inválidas → la pregunta fija de la primera dimensión no cubierta', async () => {
    groq.script(
      { content: 'no es JSON' },
      out({ dimension: 'ONSET' }), // dimensión ya cubierta
    );
    const { res } = await ask({ turns: [turn('ONSET'), turn('DURATION')] });
    expect(res.body).toEqual({
      kind: 'QUESTION',
      dimension: 'INTENSITY',
      question: FIXED_QUESTIONS.INTENSITY,
    });
    expect(groq.requests).toHaveLength(2);
    expect(openRouter.requests).toHaveLength(0);
  });

  it('R12: si el LLM excede el timeout → la pregunta fija, con 200', async () => {
    groq.script({ fail: 'TIMEOUT' });
    openRouter.script({ fail: 'TIMEOUT' });
    const { res } = await ask({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      kind: 'QUESTION',
      dimension: 'ONSET',
      question: FIXED_QUESTIONS.ONSET,
    });
  });

  it('R13: redFlagSuspected = true → RED_FLAG con las señales de las reglas (ninguna aquí: lista vacía)', async () => {
    groq.script(out({ redFlagSuspected: true }));
    const { res } = await ask({
      turns: [turn('ONSET', 'raro, me siento mal')],
    });
    expect(res.body).toEqual({ kind: 'RED_FLAG', redFlags: [] });
  });

  it('R13: una salida con esquema válido y redFlagSuspected = true escala a RED_FLAG aunque la pregunta no pase el validador, sin devolver esa pregunta', async () => {
    groq.script(
      out({ redFlagSuspected: true, question: '¿Sabes que es urgente?' }),
    );
    const { res } = await ask({
      turns: [turn('ONSET', 'raro, me siento mal')],
    });
    expect(res.body).toEqual({ kind: 'RED_FLAG', redFlags: [] });
    expect(res.text).not.toContain('urgente');
    // Sin reintento: la sospecha basta.
    expect(groq.requests).toHaveLength(1);
  });

  it('R13: con el esquema inválido, redFlagSuspected no cuenta (se reintenta y se usa la pregunta fija)', async () => {
    groq.script(out({ redFlagSuspected: true, extra: 1 }), {
      content: 'no es JSON',
    });
    const { res } = await ask({});
    expect(res.body).toEqual({
      kind: 'QUESTION',
      dimension: 'ONSET',
      question: FIXED_QUESTIONS.ONSET,
    });
  });

  it('R14: con 5 turnos responde DONE sin llamar al LLM', async () => {
    const { res } = await ask({
      turns: ['ONSET', 'DURATION', 'INTENSITY', 'LOCATION', 'HISTORY'].map(
        (d) => turn(d),
      ),
    });
    expect(res.body).toEqual({ kind: 'DONE' });
    expect(llmCalls()).toBe(0);
  });

  it('R14: done = true con ≥3 dimensiones respondidas → DONE; con menos, sigue con la pregunta', async () => {
    groq.script(out({ done: true }));
    const three = await ask({
      turns: [turn('ONSET'), turn('DURATION'), turn('INTENSITY')],
    });
    expect(three.res.body).toEqual({ kind: 'DONE' });

    groq.script(out({ done: true }));
    // "No sé" (answer null) no cuenta como respondida.
    const two = await ask({
      turns: [turn('ONSET'), turn('DURATION'), turn('INTENSITY', null)],
    });
    expect(two.res.body).toEqual({
      kind: 'QUESTION',
      dimension: 'LOCATION',
      question: '¿Dónde sientes el dolor?',
    });
  });

  it('R15: al LLM llegan los textos pasados por redact() con el nombre y el documento del paciente del token', async () => {
    groq.script(out());
    await ask({
      chiefComplaintText: `Soy ${NAME}, CC ${DOC}, dolor de cabeza`,
      turns: [
        {
          dimension: 'ONSET',
          question: '¿Cuándo empezó, Rosalba?',
          answer: 'ayer, dice Quiñones',
        },
      ],
    });
    const user = groq.requests[0].user;
    expect(user).toContain('[REDACTADO]');
    const lower = user.toLowerCase();
    for (const pii of ['rosalba', 'quiñones', 'cárdenas', DOC]) {
      expect(lower).not.toContain(pii);
    }
    expect(JSON.parse(user)).toEqual({
      chief_complaint_text: 'Soy [REDACTADO], CC [REDACTADO], dolor de cabeza',
      turns: [
        {
          dimension: 'ONSET',
          question: '¿Cuándo empezó, [REDACTADO]?',
          answer: 'ayer, dice [REDACTADO]',
        },
      ],
    });
  });

  it('R15: los logs no llevan el contenido de la petición ni de la respuesta', async () => {
    logger.lines.length = 0;
    groq.script(
      out({
        question: '¿Sientes el zumbido-DEV-LOG-R?',
        dimension: 'ASSOCIATED',
      }),
    );
    const { res } = await ask({
      chiefComplaintText: 'DEV-LOG-MOTIVO dolor de cabeza',
      turns: [
        {
          dimension: 'ONSET',
          question: '¿DEV-LOG-PREGUNTA?',
          answer: 'DEV-LOG-RESPUESTA',
        },
      ],
    });
    expect(res.status).toBe(200);
    groq.script({ content: 'DEV-LOG-CRUDO' }, { content: 'DEV-LOG-CRUDO' });
    await ask({ chiefComplaintText: 'DEV-LOG-MOTIVO otra vez' });
    const all = logger.lines.join('\n');
    expect(all).toContain('interview_next_question');
    for (const s of [
      'DEV-LOG-MOTIVO',
      'DEV-LOG-PREGUNTA',
      'DEV-LOG-RESPUESTA',
      'zumbido-DEV-LOG-R',
      'DEV-LOG-CRUDO',
      NAME,
      DOC,
    ]) {
      expect(all).not.toContain(s);
    }
  });
});
