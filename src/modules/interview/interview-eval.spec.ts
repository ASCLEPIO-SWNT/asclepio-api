import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InterviewAdvice } from './interview-advisor.js';
import {
  type InterviewVignette,
  parseInterviewVignette,
  runInterviewEval,
} from './interview-eval.js';
import {
  detectRedFlags,
  DIMENSIONS,
  FIXED_QUESTIONS,
  type InterviewTurn,
} from './interview.rules.js';

function vignette(
  id: string,
  redFlag: boolean,
  reviewed: string | null = null,
): InterviewVignette {
  return parseInterviewVignette({
    id,
    title: `DEV ${id}`,
    chief_complaint_text: `caso ${id}`,
    scripted_answers: ['DEV respuesta 1', 'DEV respuesta 2'],
    expected: { red_flag: redFlag, must_cover: ['ONSET'] },
    source: 'BORRADOR — revisar con asesor clínico',
    reviewed_by: reviewed,
  });
}

/**
 * Advisor falso (sin LLM): pregunta por las dimensiones en orden con la primera salida válida, hasta `stopAfter`
 * preguntas; después DONE. `escalate` → RED_FLAG en la primera llamada.
 */
function fakeAdvisor(opts: { escalate?: string[]; stopAfter?: number } = {}) {
  const seen: { complaint: string; turns: InterviewTurn[] }[] = [];
  return {
    seen,
    advise(
      complaint: string,
      turns: InterviewTurn[],
    ): Promise<InterviewAdvice> {
      seen.push({ complaint, turns: [...turns] });
      if (opts.escalate?.includes(complaint)) {
        return Promise.resolve({
          result: { kind: 'RED_FLAG', redFlags: [] },
          source: 'LLM',
          llmCalls: 1,
          outputs: ['VALID'],
        });
      }
      if (turns.length >= (opts.stopAfter ?? 3)) {
        return Promise.resolve({
          result: { kind: 'DONE' },
          source: 'LLM',
          llmCalls: 1,
          outputs: ['VALID'],
        });
      }
      const d = DIMENSIONS[turns.length];
      return Promise.resolve({
        result: {
          kind: 'QUESTION',
          dimension: d,
          question: FIXED_QUESTIONS[d],
        },
        source: turns.length === 1 ? 'FIXED' : 'LLM',
        llmCalls: 2,
        outputs:
          turns.length === 1 ? ['INVALID', 'INVALID'] : ['INVALID', 'VALID'],
      });
    },
  };
}

async function run(
  vignettes: InterviewVignette[],
  advisor = fakeAdvisor(),
): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await runInterviewEval(advisor, vignettes, (l) => lines.push(l));
  return { code, lines };
}

describe('ai:eval de la entrevista (F-11-api, T10)', () => {
  it('R11: las 14 viñetas de ai/vignettes/interview son válidas (9 ambiguas y 5 de alarma) y sintéticas', () => {
    const dir = join(process.cwd(), 'ai', 'vignettes', 'interview');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    const all = files.map((f) =>
      parseInterviewVignette(JSON.parse(readFileSync(join(dir, f), 'utf8'))),
    );
    expect(all).toHaveLength(14);
    expect(all.filter((v) => v.expectedRedFlag)).toHaveLength(5);
    expect(new Set(all.map((v) => v.id)).size).toBe(14);
    // Las respuestas guionizadas de los ambiguos no activan las reglas: si escalan, es por el LLM.
    for (const v of all.filter((x) => !x.expectedRedFlag)) {
      expect([
        v.id,
        detectRedFlags(v.chiefComplaintText, ...v.scriptedAnswers),
      ]).toEqual([v.id, []]);
    }
    // R11: las 5 alarmas (también las sutiles, como IV-014) las escalan ya las reglas deterministas.
    for (const v of all.filter((x) => x.expectedRedFlag)) {
      expect([v.id, detectRedFlags(v.chiefComplaintText).length > 0]).toEqual([
        v.id,
        true,
      ]);
    }
  });

  it('R11: simula la entrevista con las respuestas guionizadas (null cuando se acaban) hasta DONE o RED_FLAG', async () => {
    const advisor = fakeAdvisor({ stopAfter: 3 });
    await run([vignette('IV-901', false)], advisor);
    expect(advisor.seen.map((s) => s.turns.map((t) => t.answer))).toEqual([
      [],
      ['DEV respuesta 1'],
      ['DEV respuesta 1', 'DEV respuesta 2'],
      ['DEV respuesta 1', 'DEV respuesta 2', null],
    ]);
    expect(advisor.seen[3].turns.map((t) => t.dimension)).toEqual([
      'ONSET',
      'DURATION',
      'INTENSITY',
    ]);
  });

  it('R12: informa JSON válido al primer intento, salidas rechazadas, preguntas fijas, preguntas por caso y alarmas escaladas', async () => {
    const { lines } = await run(
      [vignette('IV-901', false), vignette('IV-902', true)],
      fakeAdvisor({ escalate: ['caso IV-902'] }),
    );
    const text = lines.join('\n');
    expect(text).toMatch(/IV-901 · fin=DONE · preguntas=3/);
    expect(text).toMatch(/IV-902 · fin=RED_FLAG · preguntas=0/);
    expect(text).toMatch(/JSON válido al primer intento: 40\.0 % \(2\/5\)/);
    expect(text).toMatch(/Salidas rechazadas: 4/);
    expect(text).toMatch(/Preguntas fijas: 1/);
    expect(text).toMatch(/Alarmas escaladas: 100\.0 % \(1\/1\)/);
  });

  it('R13: termina con código ≠ 0 si una viñeta de alarma REVISADA no escala; sin revisar, solo avisa', async () => {
    expect((await run([vignette('IV-902', true)])).code).toBe(0);
    expect((await run([vignette('IV-902', true, 'DEV-revisor')])).code).toBe(1);
    expect(
      (
        await run(
          [vignette('IV-902', true, 'DEV-revisor')],
          fakeAdvisor({ escalate: ['caso IV-902'] }),
        )
      ).code,
    ).toBe(0);
  });

  it('R11: rechaza una viñeta mal formada sin repetir su contenido', () => {
    expect(() =>
      parseInterviewVignette({ id: 'IV-1', chief_complaint_text: 'x' }),
    ).toThrow(/IV-1/);
    expect(() =>
      parseInterviewVignette({
        id: 'IV-001',
        chief_complaint_text: 'x',
        expected: { red_flag: true, must_cover: ['MOOD'] },
      }),
    ).toThrow(/must_cover/);
  });
});
