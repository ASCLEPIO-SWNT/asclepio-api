import type { RedactionTarget } from '../ai/redaction.js';
import type { InterviewAdvice } from './interview-advisor.js';
import {
  DIMENSIONS,
  type Dimension,
  INTERVIEW_LIMITS,
  type InterviewTurn,
} from './interview.rules.js';

/**
 * Evaluación del fallback de la entrevista con viñetas (F-11-api, T10; F-11.AC8): el mismo InterviewAdvisor del
 * endpoint, sin base de datos, contra el LLM real. Solo la ejecuta `npm run ai:eval`, a mano; nunca las pruebas ni
 * init.sh. Los casos son los 14 de F-11-mobile (D11) para comparar el motor del servidor con el del teléfono.
 */

export interface InterviewVignette {
  id: string;
  title: string;
  chiefComplaintText: string;
  /** Respuestas del paciente en orden; cuando se acaban, "No sé" (null). */
  scriptedAnswers: string[];
  expectedRedFlag: boolean;
  mustCover: Dimension[];
  source: string;
  reviewedBy: string | null;
}

const isDimension = (v: unknown): v is Dimension =>
  (DIMENSIONS as readonly unknown[]).includes(v);

/** Valida el formato de ai/vignettes/interview/README.md. Los errores nombran la viñeta y el campo, nunca el contenido. */
export function parseInterviewVignette(raw: unknown): InterviewVignette {
  const v = raw as {
    id?: unknown;
    title?: unknown;
    chief_complaint_text?: unknown;
    scripted_answers?: unknown;
    expected?: { red_flag?: unknown; must_cover?: unknown };
    source?: unknown;
    reviewed_by?: unknown;
  };
  const id = typeof v?.id === 'string' ? v.id : '';
  const fail = (what: string): never => {
    throw new Error(
      `Viñeta de entrevista ${id || '(sin id)'} inválida: ${what}.`,
    );
  };
  if (!/^IV-\d{3}$/.test(id)) fail('id');
  if (
    typeof v.chief_complaint_text !== 'string' ||
    !v.chief_complaint_text.trim()
  ) {
    fail('chief_complaint_text');
  }
  const answers = v.scripted_answers ?? [];
  if (!Array.isArray(answers) || !answers.every((a) => typeof a === 'string')) {
    fail('scripted_answers');
  }
  const e = v.expected;
  if (!e || typeof e.red_flag !== 'boolean') fail('expected.red_flag');
  const cover = e!.must_cover ?? [];
  if (!Array.isArray(cover) || !cover.every(isDimension)) {
    fail('expected.must_cover');
  }
  return {
    id,
    title: typeof v.title === 'string' ? v.title : '',
    chiefComplaintText: v.chief_complaint_text as string,
    scriptedAnswers: answers as string[],
    expectedRedFlag: e!.red_flag as boolean,
    mustCover: cover as Dimension[],
    source: typeof v.source === 'string' ? v.source : '',
    reviewedBy: typeof v.reviewed_by === 'string' ? v.reviewed_by : null,
  };
}

export interface InterviewAdvisorLike {
  advise(
    chiefComplaintText: string,
    turns: InterviewTurn[],
    target: () => Promise<RedactionTarget>,
  ): Promise<InterviewAdvice>;
}

export interface InterviewVignetteResult {
  vignette: InterviewVignette;
  end: 'DONE' | 'RED_FLAG' | 'MAX_TURNS' | 'UNAVAILABLE';
  questions: number;
  covered: Dimension[];
  /** Una entrada por llamada al advisor que recibió alguna salida del LLM. */
  advices: InterviewAdvice[];
  latencyMs: number;
}

/** Las viñetas son sintéticas: no hay nombre ni documento que sanear. */
const NO_TARGET = (): Promise<RedactionTarget> =>
  Promise.resolve({ fullName: null, documentNumber: null });

/** Simula la entrevista: pregunta → respuesta guionizada (o null) hasta DONE, RED_FLAG o el máximo de turnos. */
export async function interviewOne(
  advisor: InterviewAdvisorLike,
  v: InterviewVignette,
  now: () => number = () => performance.now(),
): Promise<InterviewVignetteResult> {
  const turns: InterviewTurn[] = [];
  const advices: InterviewAdvice[] = [];
  const start = now();
  let end: InterviewVignetteResult['end'] = 'MAX_TURNS';
  while (turns.length <= INTERVIEW_LIMITS.maxRequestTurns) {
    let advice: InterviewAdvice;
    try {
      advice = await advisor.advise(
        v.chiefComplaintText,
        [...turns],
        NO_TARGET,
      );
    } catch {
      end = 'UNAVAILABLE';
      break;
    }
    advices.push(advice);
    const r = advice.result;
    if (r.kind !== 'QUESTION') {
      end = r.kind;
      break;
    }
    turns.push({
      dimension: r.dimension,
      question: r.question,
      answer: v.scriptedAnswers[turns.length] ?? null,
    });
  }
  return {
    vignette: v,
    end,
    questions: turns.length,
    covered: turns.map((t) => t.dimension),
    advices,
    latencyMs: Math.round(now() - start),
  };
}

const pct = (n: number, total: number) =>
  `${total ? ((n * 100) / total).toFixed(1) : '0.0'} % (${n}/${total})`;
const yesNo = (b: boolean) => (b ? 'sí' : 'no');

export function formatInterviewLine(r: InterviewVignetteResult): string {
  const missing = r.vignette.mustCover.filter((d) => !r.covered.includes(d));
  return [
    r.vignette.id,
    `fin=${r.end}`,
    `preguntas=${r.questions}`,
    `alarma_esperada=${yesNo(r.vignette.expectedRedFlag)}`,
    `dimensiones=[${r.covered.join(',')}]`,
    `faltan=[${missing.join(',')}]`,
    `fijas=${r.advices.filter((a) => a.source === 'FIXED').length}`,
    `latencia=${r.latencyMs}ms`,
    `revisada=${yesNo(r.vignette.reviewedBy !== null)}`,
  ].join(' · ');
}

/**
 * Ejecuta la evaluación, imprime por viñeta y el resumen (métricas de D11 de F-11-mobile) y devuelve el código de
 * salida. Umbral: una viñeta de alarma REVISADA que no termina en RED_FLAG hace fallar el comando; mientras ninguna esté
 * revisada, no es vinculante. La pertinencia de las preguntas la califica un humano con la rúbrica (0–2).
 */
export async function runInterviewEval(
  advisor: InterviewAdvisorLike,
  vignettes: InterviewVignette[],
  print: (line: string) => void,
): Promise<number> {
  const results: InterviewVignetteResult[] = [];
  for (const v of vignettes) results.push(await interviewOne(advisor, v));
  results.forEach((r) => print(formatInterviewLine(r)));

  const withOutput = results.flatMap((r) =>
    r.advices.filter((a) => a.outputs.length > 0),
  );
  const firstValid = withOutput.filter((a) => a.outputs[0] === 'VALID');
  const rejected = results
    .flatMap((r) => r.advices)
    .reduce((n, a) => n + a.outputs.filter((o) => o === 'INVALID').length, 0);
  const fixed = results
    .flatMap((r) => r.advices)
    .filter((a) => a.source === 'FIXED').length;
  const alarms = results.filter((r) => r.vignette.expectedRedFlag);
  const escalated = alarms.filter((r) => r.end === 'RED_FLAG');
  const ambiguous = results.filter((r) => !r.vignette.expectedRedFlag);
  const questions = ambiguous.map((r) => r.questions);
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p90 = latencies.length
    ? latencies[Math.max(0, Math.ceil(latencies.length * 0.9) - 1)]
    : 0;

  print('');
  print(
    `JSON válido al primer intento: ${pct(firstValid.length, withOutput.length)}`,
  );
  print(`Salidas rechazadas: ${rejected}`);
  print(`Preguntas fijas: ${fixed}`);
  print(`Alarmas escaladas: ${pct(escalated.length, alarms.length)}`);
  print(
    `Preguntas por caso ambiguo: ${
      questions.length
        ? (questions.reduce((a, b) => a + b, 0) / questions.length).toFixed(1)
        : '0.0'
    } (máx. ${questions.length ? Math.max(...questions) : 0})`,
  );
  print(
    `Ambiguos escalados: ${pct(
      ambiguous.filter((r) => r.end === 'RED_FLAG').length,
      ambiguous.length,
    )}`,
  );
  print(`Latencia por entrevista p90: ${p90}ms`);
  const reviewed = results.filter((r) => r.vignette.reviewedBy !== null);
  print(
    `Viñetas de entrevista revisadas: ${reviewed.length}/${results.length}`,
  );
  if (!reviewed.length) {
    print(
      'AVISO: ninguna viñeta de entrevista está revisada: el umbral (toda alarma revisada termina en RED_FLAG) aún no es vinculante.',
    );
    return 0;
  }
  const failures = reviewed.filter(
    (r) => r.vignette.expectedRedFlag && r.end !== 'RED_FLAG',
  );
  if (failures.length) {
    print(
      `FALLO: ${failures.length} viñeta(s) de alarma revisada(s) sin escalar: ${failures
        .map((f) => f.vignette.id)
        .join(', ')}.`,
    );
    return 1;
  }
  return 0;
}
