import {
  type LlmClient,
  LlmCallError,
  type LlmProviderName,
  type LlmRequest,
  type LlmResponse,
} from './llm/llm-client.js';
import { type AdvisorTimer, TriageAdvisor } from './triage-advisor.js';
import type { TriageInputSnapshot } from './triage-input.js';
import { TriagePromptBuilder } from './triage-prompt.builder.js';

/**
 * TriageAdvisor con un LlmClient falso (un puerto, no un mock del proveedor) y un reloj y una señal de presupuesto
 * falsos: cubre el fallback, el timeout, el presupuesto y INVALID_OUTPUT sin red (docs/verification.md).
 */
const SNAPSHOT: TriageInputSnapshot = {
  age_years: 58,
  sex: 'M',
  chief_complaint_text: 'dolor torácico opresivo de 40 minutos',
  complaint_source: 'TYPED',
  vital_signs: {
    respiratory_rate: 16,
    spo2: 98,
    supplemental_oxygen: false,
    systolic_bp: 150,
    diastolic_bp: 95,
    heart_rate: 112,
    consciousness: 'A',
    temperature_c: 37.4,
    glucose_mg_dl: null,
  },
  symptom_findings: [{ kind: 'SYMPTOM', description: 'diaforesis' }],
};

const OUTPUT = {
  level: 2,
  explanation:
    'Dolor torácico con taquicardia: descartar síndrome coronario agudo.',
  factors: [
    { field: 'chief_complaint_text', note: 'Dolor torácico opresivo' },
    { field: 'vital_signs.heart_rate', note: 'Taquicardia' },
  ],
};

class FakeTimer implements AdvisorTimer {
  t = 1000;
  readonly controller = new AbortController();
  now(): number {
    return this.t;
  }
  budget(): AbortSignal {
    return this.controller.signal;
  }
}

type Step =
  | { ok: string; model?: string; ms?: number; tokens?: [number, number] }
  | {
      fail: LlmCallError['kind'];
      ms?: number;
      http?: number;
      exhaust?: boolean;
    };

class FakeClient implements LlmClient {
  readonly requests: LlmRequest[] = [];
  constructor(
    readonly provider: LlmProviderName,
    readonly model: string,
    private readonly step: Step,
    private readonly timer: FakeTimer,
  ) {}

  complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(req);
    const s = this.step;
    this.timer.t += s.ms ?? 100;
    if ('fail' in s) {
      if (s.exhaust) this.timer.controller.abort();
      return Promise.reject(new LlmCallError(s.fail, s.http ?? null));
    }
    return Promise.resolve({
      content: s.ok,
      model: s.model ?? `${this.model}-reportado`,
      tokensIn: s.tokens?.[0] ?? 700,
      tokensOut: s.tokens?.[1] ?? 80,
      httpStatus: 200,
    });
  }
}

function setup(groqStep: Step, orStep: Step = { ok: JSON.stringify(OUTPUT) }) {
  const timer = new FakeTimer();
  const groq = new FakeClient('GROQ', 'groq-model', groqStep, timer);
  const or = new FakeClient('OPENROUTER', 'or-model', orStep, timer);
  const advisor = new TriageAdvisor(
    groq,
    or,
    new TriagePromptBuilder(),
    { totalBudgetMs: 20000 },
    timer,
  );
  return { advisor, groq, or, timer };
}

describe('TriageAdvisor', () => {
  it('R16: Groq responde una salida válida → OK con nivel, explicación, factores, proveedor y modelo informado, sin llamar a OpenRouter', async () => {
    const { advisor, groq, or } = setup({
      ok: JSON.stringify(OUTPUT),
      ms: 640,
      tokens: [812, 95],
    });
    const r = await advisor.advise(SNAPSHOT);
    expect(r).toEqual({
      status: 'OK',
      llmLevel: 2,
      suggestedLevel: 2,
      explanation: { summary: OUTPUT.explanation, factors: OUTPUT.factors },
      guardApplied: false,
      guardReasons: [],
      provider: 'GROQ',
      model: 'groq-model-reportado',
      promptVersion: 'triage-v1',
      rawResponse: JSON.stringify(OUTPUT),
      tokensIn: 812,
      tokensOut: 95,
      latencyMs: 640,
      attempts: [
        {
          provider: 'GROQ',
          model: 'groq-model-reportado',
          outcome: 'OK',
          latencyMs: 640,
          httpStatus: 200,
        },
      ],
    });
    expect(groq.requests).toHaveLength(1);
    expect(or.requests).toHaveLength(0);
    expect(groq.requests[0]).toMatchObject({
      user: JSON.stringify(SNAPSHOT),
    });
    expect(groq.requests[0].signal).toBeDefined();
  });

  it('R18: con status OK aplica los SafetyGuards sobre la toma de la instantánea (NEWS2 ≥ 7 → máx. II)', async () => {
    const { advisor } = setup({ ok: JSON.stringify({ ...OUTPUT, level: 4 }) });
    const r = await advisor.advise({
      ...SNAPSHOT,
      vital_signs: {
        ...SNAPSHOT.vital_signs,
        respiratory_rate: 22,
        spo2: 94,
        supplemental_oxygen: true,
      },
    });
    expect(r).toMatchObject({
      status: 'OK',
      llmLevel: 4,
      suggestedLevel: 2,
      guardApplied: true,
      guardReasons: [{ rule: 'G1', maxLevel: 2, trigger: { news2Total: 7 } }],
    });
  });

  it('R12: si Groq falla, hace exactamente una llamada a OpenRouter con la misma instantánea y el mismo prompt', async () => {
    const { advisor, groq, or } = setup(
      { fail: 'HTTP', http: 503, ms: 300 },
      { ok: JSON.stringify(OUTPUT), model: 'openai/gpt-oss-120b', ms: 900 },
    );
    const r = await advisor.advise(SNAPSHOT);
    expect(groq.requests).toHaveLength(1);
    expect(or.requests).toHaveLength(1);
    expect(or.requests[0].system).toBe(groq.requests[0].system);
    expect(or.requests[0].user).toBe(groq.requests[0].user);
    expect(r).toMatchObject({
      status: 'OK',
      provider: 'OPENROUTER',
      model: 'openai/gpt-oss-120b',
      latencyMs: 1200,
      attempts: [
        {
          provider: 'GROQ',
          model: 'groq-model',
          outcome: 'HTTP',
          latencyMs: 300,
          httpStatus: 503,
        },
        {
          provider: 'OPENROUTER',
          model: 'openai/gpt-oss-120b',
          outcome: 'OK',
          latencyMs: 900,
          httpStatus: 200,
        },
      ],
    });
  });

  it('R14: las dos llamadas con TIMEOUT → TIMEOUT sin nivel, explicación ni factores; provider y modelo de la última intentada', async () => {
    const { advisor } = setup(
      { fail: 'TIMEOUT', ms: 8000 },
      { fail: 'TIMEOUT', ms: 8000 },
    );
    const r = await advisor.advise(SNAPSHOT);
    expect(r).toMatchObject({
      status: 'TIMEOUT',
      llmLevel: null,
      suggestedLevel: null,
      explanation: null,
      guardApplied: false,
      guardReasons: [],
      provider: 'OPENROUTER',
      model: 'or-model',
      rawResponse: null,
      tokensIn: null,
      tokensOut: null,
      latencyMs: 16000,
    });
    expect(r.attempts.map((a) => a.outcome)).toEqual(['TIMEOUT', 'TIMEOUT']);
  });

  it('R14: TIMEOUT + HTTP (o NETWORK, o EMPTY) → FAILED', async () => {
    for (const fail of ['HTTP', 'NETWORK', 'EMPTY'] as const) {
      const { advisor } = setup({ fail: 'TIMEOUT' }, { fail, http: 500 });
      const r = await advisor.advise(SNAPSHOT);
      expect([fail, r.status]).toEqual([fail, 'FAILED']);
      expect(r.attempts.map((a) => a.outcome)).toEqual(['TIMEOUT', fail]);
    }
  });

  it('R13: si Groq agota el presupuesto total, su intento queda BUDGET_EXHAUSTED, no se llama a OpenRouter y el estado es TIMEOUT', async () => {
    const { advisor, or } = setup({
      fail: 'TIMEOUT',
      ms: 20000,
      exhaust: true,
    });
    const r = await advisor.advise(SNAPSHOT);
    expect(or.requests).toHaveLength(0);
    expect(r).toMatchObject({
      status: 'TIMEOUT',
      provider: 'GROQ',
      model: 'groq-model',
      latencyMs: 20000,
      attempts: [
        {
          provider: 'GROQ',
          model: 'groq-model',
          outcome: 'BUDGET_EXHAUSTED',
          latencyMs: 20000,
          httpStatus: null,
        },
      ],
    });
  });

  it('R14: si Groq falla con HTTP y ya no queda presupuesto, no se llama a OpenRouter y el estado es FAILED', async () => {
    const { advisor, or } = setup({ fail: 'HTTP', http: 500, exhaust: true });
    const r = await advisor.advise(SNAPSHOT);
    expect(or.requests).toHaveLength(0);
    expect(r.status).toBe('FAILED');
    expect(r.attempts.map((a) => a.outcome)).toEqual(['HTTP']);
  });

  it('R15: Groq responde una salida inválida → INVALID_OUTPUT con la respuesta cruda, sin niveles y sin llamar a OpenRouter', async () => {
    const raw = '{"level": 7, "explanation": "zz"}';
    const { advisor, or } = setup({ ok: raw, tokens: [500, 10] });
    const r = await advisor.advise(SNAPSHOT);
    expect(or.requests).toHaveLength(0);
    expect(r).toMatchObject({
      status: 'INVALID_OUTPUT',
      llmLevel: null,
      suggestedLevel: null,
      explanation: null,
      guardApplied: false,
      guardReasons: [],
      provider: 'GROQ',
      model: 'groq-model-reportado',
      rawResponse: raw,
      tokensIn: 500,
      tokensOut: 10,
    });
    expect(r.attempts.map((a) => a.outcome)).toEqual(['INVALID_OUTPUT']);
  });

  it('R15: un factor que no existe en la instantánea hace la salida inválida (también desde OpenRouter)', async () => {
    const bad = {
      ...OUTPUT,
      factors: [{ field: 'vital_signs.glucose_mg_dl', note: 'x' }],
    };
    const { advisor } = setup({ fail: 'NETWORK' }, { ok: JSON.stringify(bad) });
    const r = await advisor.advise(SNAPSHOT);
    expect(r.status).toBe('INVALID_OUTPUT');
    expect(r.provider).toBe('OPENROUTER');
    expect(r.attempts.map((a) => a.outcome)).toEqual([
      'NETWORK',
      'INVALID_OUTPUT',
    ]);
  });

  it('R20: un error que no es LlmCallError cuenta como fallo de red y no rompe la solicitud', async () => {
    const timer = new FakeTimer();
    const broken: LlmClient = {
      provider: 'GROQ',
      model: 'groq-model',
      complete: () => Promise.reject(new Error('inesperado')),
    };
    const or = new FakeClient(
      'OPENROUTER',
      'or-model',
      { fail: 'HTTP', http: 502 },
      timer,
    );
    const advisor = new TriageAdvisor(
      broken,
      or,
      new TriagePromptBuilder(),
      { totalBudgetMs: 20000 },
      timer,
    );
    const r = await advisor.advise(SNAPSHOT);
    expect(r.status).toBe('FAILED');
    expect(r.attempts).toEqual([
      {
        provider: 'GROQ',
        model: 'groq-model',
        outcome: 'NETWORK',
        latencyMs: 0,
        httpStatus: null,
      },
      {
        provider: 'OPENROUTER',
        model: 'or-model',
        outcome: 'HTTP',
        latencyMs: 100,
        httpStatus: 502,
      },
    ]);
  });
});
