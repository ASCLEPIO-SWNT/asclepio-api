import type { AdvisorResult } from './triage-advisor.js';
import type {
  SnapshotVitalSigns,
  TriageInputSnapshot,
} from './triage-input.js';

/**
 * Evaluación con viñetas (R30–R32 de F-04-api, D14): mismo flujo del TriageAdvisor (R8–R18) sin base de datos.
 * Solo la ejecuta `npm run ai:eval`, a mano; nunca las pruebas ni init.sh (R32).
 */

export interface Vignette {
  id: string;
  title: string;
  input: TriageInputSnapshot;
  expectedLevel: number;
  acceptableLevels: number[];
  mustMentionFactors: string[];
  source: string;
  reviewedBy: string | null;
}

const VITAL_KEYS: (keyof SnapshotVitalSigns)[] = [
  'respiratory_rate',
  'spo2',
  'supplemental_oxygen',
  'systolic_bp',
  'diastolic_bp',
  'heart_rate',
  'consciousness',
  'temperature_c',
  'glucose_mg_dl',
];

function isLevel(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;
}

/** Valida el formato de ai/vignettes/README.md y completa con null (o TYPED / []) lo que la viñeta no trae. */
export function parseVignette(raw: unknown): Vignette {
  const v = raw as {
    id?: unknown;
    title?: unknown;
    input?: Partial<Omit<TriageInputSnapshot, 'vital_signs'>> & {
      vital_signs?: Partial<SnapshotVitalSigns>;
    };
    expected?: {
      level?: unknown;
      acceptable_levels?: unknown;
      must_mention_factors?: unknown;
    };
    source?: unknown;
    reviewed_by?: unknown;
  };
  const id = typeof v?.id === 'string' ? v.id : '';
  const fail = (what: string) => {
    throw new Error(`Viñeta ${id || '(sin id)'} inválida: ${what}.`);
  };
  if (!/^V-\d{3}$/.test(id)) fail('id');
  const input = v.input;
  if (!input || typeof input.chief_complaint_text !== 'string') fail('input');
  const e = v.expected;
  if (!e || !isLevel(e.level)) fail('expected.level');
  const acceptable = e!.acceptable_levels;
  if (
    !Array.isArray(acceptable) ||
    !acceptable.length ||
    !acceptable.every(isLevel)
  ) {
    fail('expected.acceptable_levels');
  }
  const vitals = Object.fromEntries(
    VITAL_KEYS.map((k) => [k, input!.vital_signs?.[k] ?? null]),
  ) as unknown as SnapshotVitalSigns;
  return {
    id,
    title: typeof v.title === 'string' ? v.title : '',
    input: {
      age_years: input!.age_years ?? null,
      sex: input!.sex ?? null,
      chief_complaint_text: input!.chief_complaint_text!,
      complaint_source: input!.complaint_source ?? 'TYPED',
      vital_signs: vitals,
      symptom_findings: input!.symptom_findings ?? [],
    },
    expectedLevel: e!.level as number,
    acceptableLevels: acceptable as number[],
    mustMentionFactors: Array.isArray(e!.must_mention_factors)
      ? (e!.must_mention_factors as string[])
      : [],
    source: typeof v.source === 'string' ? v.source : '',
    reviewedBy: typeof v.reviewed_by === 'string' ? v.reviewed_by : null,
  };
}

export interface VignetteResult {
  vignette: Vignette;
  result: AdvisorResult;
  /** Nivel obtenido (sugerido, tras los guards) o null si status ≠ OK. */
  level: number | null;
  hit: boolean;
  /** Subclasifica: nivel menos grave que el máximo aceptable. */
  under: boolean;
}

export interface Advisor {
  advise(snapshot: TriageInputSnapshot): Promise<AdvisorResult>;
}

export async function evaluate(
  advisor: Advisor,
  vignettes: Vignette[],
): Promise<VignetteResult[]> {
  const out: VignetteResult[] = [];
  for (const vignette of vignettes) {
    const result = await advisor.advise(vignette.input);
    const level = result.status === 'OK' ? result.suggestedLevel : null;
    out.push({
      vignette,
      result,
      level,
      hit: level !== null && vignette.acceptableLevels.includes(level),
      under: level !== null && level > Math.max(...vignette.acceptableLevels),
    });
  }
  return out;
}

const yesNo = (b: boolean) => (b ? 'sí' : 'no');
const pct = (n: number, total: number) =>
  `${total ? ((n * 100) / total).toFixed(1) : '0.0'} % (${n}/${total})`;

export function formatLine(r: VignetteResult): string {
  const res = r.result;
  return [
    r.vignette.id,
    `nivel=${r.level ?? `— (${res.status})`}`,
    `esperado=${r.vignette.expectedLevel}`,
    `aceptables=[${r.vignette.acceptableLevels.join(',')}]`,
    `acierto=${yesNo(r.hit)}`,
    `subclasifica=${yesNo(r.under)}`,
    `guard=${yesNo(res.guardApplied)}`,
    `proveedor=${res.provider ?? '—'}`,
    `modelo=${res.model ?? '—'}`,
    `prompt=${res.promptVersion}`,
    `latencia=${res.latencyMs}ms`,
    `revisada=${yesNo(r.vignette.reviewedBy !== null)}`,
  ].join(' · ');
}

/**
 * R31: una viñeta REVISADA con nivel esperado I o II que subclasifica o queda sin nivel hace fallar el comando.
 * Mientras ninguna esté revisada, el umbral no es vinculante (PA-F04-6).
 */
export function blockingFailures(results: VignetteResult[]): VignetteResult[] {
  return results.filter(
    (r) =>
      r.vignette.reviewedBy !== null &&
      r.vignette.expectedLevel <= 2 &&
      (r.under || r.level === null),
  );
}

/** Ejecuta la evaluación, imprime por viñeta y el resumen, y devuelve el código de salida. */
export async function runEval(
  advisor: Advisor,
  vignettes: Vignette[],
  print: (line: string) => void,
): Promise<number> {
  const results = await evaluate(advisor, vignettes);
  results.forEach((r) => print(formatLine(r)));
  const total = results.length;
  const reviewed = results.filter((r) => r.vignette.reviewedBy !== null);
  print('');
  print(`Acierto: ${pct(results.filter((r) => r.hit).length, total)}`);
  print(
    `Subclasificación: ${pct(results.filter((r) => r.under).length, total)}`,
  );
  print(
    `Guards aplicados: ${results.filter((r) => r.result.guardApplied).length}`,
  );
  print(`Viñetas revisadas: ${reviewed.length}/${total}`);
  if (!reviewed.length) {
    print(
      'AVISO: ninguna viñeta está revisada: el umbral de R31 (ninguna I–II subclasificada) aún no es vinculante.',
    );
    return 0;
  }
  const failures = blockingFailures(results);
  if (failures.length) {
    print(
      `FALLO: ${failures.length} viñeta(s) revisada(s) de nivel I–II subclasificada(s) o sin nivel: ${failures
        .map((f) => f.vignette.id)
        .join(', ')}.`,
    );
    return 1;
  }
  return 0;
}
