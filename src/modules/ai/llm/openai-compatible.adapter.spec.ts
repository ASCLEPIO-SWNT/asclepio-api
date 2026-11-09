import type { LlmConfig } from '../../../common/config/app-config.js';
import type { CaptureForSuggestion } from '../../encounters/capture-for-suggestion.js';
import { buildSnapshot } from '../triage-input.js';
import { TriagePromptBuilder } from '../triage-prompt.builder.js';
import { TRIAGE_OUTPUT_SCHEMA } from '../triage-response.validator.js';
import { LlmCallError } from './llm-client.js';
import {
  createGroqAdapter,
  createOpenRouterAdapter,
  type FetchFn,
} from './openai-compatible.adapter.js';

/**
 * Adaptador sobre fetch con el fetch interceptado: ninguna prueba llama a Groq ni a OpenRouter (R32).
 */
const CONFIG: LlmConfig = {
  groq: { apiKey: 'gsk-zz-clave-groq-secreta', model: 'openai/gpt-oss-120b' },
  openRouter: {
    apiKey: 'sk-or-zz-clave-openrouter-secreta',
    model: 'openai/gpt-oss-120b',
  },
  timeoutMs: 8000,
  totalBudgetMs: 20000,
};

const REQUEST = {
  system: 'SYSTEM',
  user: '{"age_years":58}',
  schema: TRIAGE_OUTPUT_SCHEMA,
};

interface Captured {
  url: string;
  init: RequestInit;
}

function okBody(content: unknown = '{"level":2}', extra: object = {}) {
  return {
    id: 'cmpl-1',
    model: 'openai/gpt-oss-120b-2026',
    choices: [{ index: 0, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 812, completion_tokens: 95 },
    ...extra,
  };
}

function fakeFetch(
  respond: (init: RequestInit) => Promise<Response> | Response,
): { fetch: FetchFn; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetch: FetchFn = (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(respond(init ?? {}));
  };
  return { fetch, calls };
}

const json = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** fetch que no responde hasta que se aborta la señal (como un proveedor colgado). */
const hangingFetch: FetchFn = (_url, init) =>
  new Promise((_resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError')),
    );
  });

async function errorOf(p: Promise<unknown>): Promise<LlmCallError> {
  try {
    await p;
  } catch (e) {
    return e as LlmCallError;
  }
  throw new Error('no lanzó');
}

describe('OpenAiCompatibleAdapter (Groq y OpenRouter)', () => {
  it('R11: envía a Groq model, temperature 0, messages y response_format json_schema strict, con la clave en Authorization y sin provider', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, okBody()));
    const groq = createGroqAdapter(CONFIG, fetch);
    await groq.complete(REQUEST);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'https://api.groq.com/openai/v1/chat/completions',
    );
    expect(calls[0].init.method).toBe('POST');
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${CONFIG.groq.apiKey}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      model: 'openai/gpt-oss-120b',
      temperature: 0,
      messages: [
        { role: 'system', content: 'SYSTEM' },
        { role: 'user', content: '{"age_years":58}' },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'triage_suggestion',
          strict: true,
          schema: TRIAGE_OUTPUT_SCHEMA,
        },
      },
    });
  });

  it('R11: a OpenRouter le añade provider { ignore: [groq], require_parameters: true } y usa su clave', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, okBody()));
    const or = createOpenRouterAdapter(CONFIG, fetch);
    expect(or.provider).toBe('OPENROUTER');
    await or.complete(REQUEST);
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe(
      `Bearer ${CONFIG.openRouter.apiKey}`,
    );
    const body = JSON.parse(calls[0].init.body as string) as Record<
      string,
      unknown
    >;
    expect(body.provider).toEqual({
      ignore: ['groq'],
      require_parameters: true,
    });
    expect(body).toMatchObject({
      temperature: 0,
      model: 'openai/gpt-oss-120b',
    });
  });

  it('R11: devuelve el contenido, el modelo que informa la respuesta, los tokens y el estado HTTP', async () => {
    const { fetch } = fakeFetch(() => json(200, okBody('{"x":1}')));
    await expect(
      createGroqAdapter(CONFIG, fetch).complete(REQUEST),
    ).resolves.toEqual({
      content: '{"x":1}',
      model: 'openai/gpt-oss-120b-2026',
      tokensIn: 812,
      tokensOut: 95,
      httpStatus: 200,
    });
    // Sin model ni usage en la respuesta: el modelo configurado y tokens null.
    const { fetch: bare } = fakeFetch(() =>
      json(200, { choices: [{ message: { content: 'hola' } }] }),
    );
    await expect(
      createGroqAdapter(CONFIG, bare).complete(REQUEST),
    ).resolves.toEqual({
      content: 'hola',
      model: 'openai/gpt-oss-120b',
      tokensIn: null,
      tokensOut: null,
      httpStatus: 200,
    });
  });

  it('R13: aborta la llamada a los timeoutMs y lanza LlmCallError TIMEOUT', async () => {
    const groq = createGroqAdapter({ ...CONFIG, timeoutMs: 40 }, hangingFetch);
    const started = Date.now();
    const err = await errorOf(groq.complete(REQUEST));
    expect(err).toBeInstanceOf(LlmCallError);
    expect(err.kind).toBe('TIMEOUT');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('R13: la señal externa (presupuesto) también aborta la llamada como TIMEOUT', async () => {
    const groq = createGroqAdapter(CONFIG, hangingFetch);
    const budget = new AbortController();
    setTimeout(() => budget.abort(), 20);
    const err = await errorOf(
      groq.complete({ ...REQUEST, signal: budget.signal }),
    );
    expect(err.kind).toBe('TIMEOUT');
  });

  it('R13: red caída → NETWORK; HTTP 429 o 500 → HTTP con httpStatus; sin choices[0].message.content → EMPTY', async () => {
    const down: FetchFn = () => Promise.reject(new TypeError('fetch failed'));
    expect(
      (await errorOf(createGroqAdapter(CONFIG, down).complete(REQUEST))).kind,
    ).toBe('NETWORK');
    for (const status of [429, 500, 401]) {
      const { fetch } = fakeFetch(() =>
        json(status, { error: { message: 'x' } }),
      );
      const err = await errorOf(
        createGroqAdapter(CONFIG, fetch).complete(REQUEST),
      );
      expect([status, err.kind, err.httpStatus]).toEqual([
        status,
        'HTTP',
        status,
      ]);
    }
    for (const body of [
      {},
      { choices: [] },
      { choices: [{ message: {} }] },
      { choices: [{ message: { content: '' } }] },
      { choices: [{ message: { content: null } }] },
      'no es json',
    ]) {
      const { fetch } = fakeFetch(() => json(200, body));
      const err = await errorOf(
        createGroqAdapter(CONFIG, fetch).complete(REQUEST),
      );
      expect([body, err.kind, err.httpStatus]).toEqual([body, 'EMPTY', 200]);
    }
  });

  it('R27: los errores no incluyen la clave de API ni el cuerpo de la petición o de la respuesta', async () => {
    const secretBody = { error: { message: 'zz-cuerpo-respuesta-privado' } };
    const cases: FetchFn[] = [
      fakeFetch(() => json(500, secretBody)).fetch,
      fakeFetch(() => json(200, 'zz-cuerpo-respuesta-privado')).fetch,
      () =>
        Promise.reject(
          new Error(`zz-cuerpo-respuesta-privado ${CONFIG.groq.apiKey}`),
        ),
    ];
    for (const f of cases) {
      const err = await errorOf(
        createGroqAdapter(CONFIG, f).complete({
          ...REQUEST,
          user: '{"chief_complaint_text":"zz-motivo-privado"}',
        }),
      );
      const text = `${err.message} ${String(err.stack)} ${JSON.stringify(err)}`;
      for (const secret of [
        CONFIG.groq.apiKey,
        'zz-cuerpo-respuesta-privado',
        'zz-motivo-privado',
      ]) {
        expect(text).not.toContain(secret);
      }
    }
  });

  it('R10: el cuerpo HTTP enviado no contiene el nombre, sus palabras, el documento ni los ids del paciente y la atención', async () => {
    const patientId = '0b6f4a8e-3333-4eee-8fff-0123456789ab';
    const encounterId = 'f1e2d3c4-4444-4aaa-8bbb-ba9876543210';
    const capture = {
      encounterId,
      status: 'WAITING_TRIAGE',
      chiefComplaintText:
        'Hernando Quintero Ruiz, CC 79.555.123, dolor torácico',
      complaintSource: 'TYPED',
      latestVitalSigns: {
        respiratoryRate: 22,
        oxygenSaturation: 94,
        supplementalOxygen: false,
        systolicBp: 150,
        diastolicBp: 95,
        heartRate: 112,
        consciousness: 'A',
        temperatureC: 37.4,
        glucoseMgDl: null,
      },
      symptomFindings: [
        {
          kind: 'COMPLAINT_NOTE',
          description: 'lo trae su esposa; dice que Quintero fuma',
        },
      ],
      patient: {
        id: patientId,
        birthDate: '1968-01-10',
        estimatedAgeYears: null,
        sex: 'M',
        fullName: 'Hernando Quintero Ruiz',
        documentNumber: '79555123',
      },
    } as CaptureForSuggestion;
    const prompt = new TriagePromptBuilder().build(
      buildSnapshot(capture, '2026-11-09'),
    );
    const { fetch, calls } = fakeFetch(() => json(200, okBody()));
    await createOpenRouterAdapter(CONFIG, fetch).complete({
      system: prompt.system,
      user: prompt.user,
      schema: TRIAGE_OUTPUT_SCHEMA,
    });
    const sent = (calls[0].init.body as string).toLowerCase();
    for (const needle of [
      'hernando',
      'quintero',
      'ruiz',
      '79555123',
      '79.555.123',
      '1968-01-10',
      patientId,
      encounterId,
    ]) {
      expect([needle, sent.includes(needle)]).toEqual([needle, false]);
    }
  });
});
