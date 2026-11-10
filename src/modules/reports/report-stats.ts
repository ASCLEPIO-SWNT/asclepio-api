/**
 * Estadísticos puros de los reportes (F-07-api, R6, R8, R10): sin Nest ni base.
 */

/** Niveles de triage (Res. 5596 de 2015): 1 (I) a 5 (V). */
export const LEVELS = [1, 2, 3, 4, 5] as const;

/** Par de concordancia (nivel sugerido por la IA, nivel final decidido). */
export type LevelPair = readonly [suggested: number, final: number];

/** Redondeo a 1 decimal (mitades hacia +∞). */
export function round1(x: number): number {
  return Math.round((x + Number.EPSILON) * 10) / 10;
}

/** Redondeo a 3 decimales (kappa, R10). */
export function round3(x: number): number {
  return Math.round((x + Number.EPSILON) * 1000) / 1000;
}

/** Porcentaje con 1 decimal; null si el denominador es 0 (R10). */
export function percent(count: number, total: number): number | null {
  return total === 0 ? null : round1((count * 100) / total);
}

const sorted = (values: readonly number[]) => [...values].sort((a, b) => a - b);

/** Mediana con 1 decimal (promedio de los dos centrales si n es par); null con n = 0. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = sorted(values);
  const mid = Math.floor(s.length / 2);
  return round1(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

/** Percentil 90 por rango más cercano: el valor en la posición ceil(0,9·n) (1-based); null con n = 0. */
export function p90(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = sorted(values);
  return round1(s[Math.ceil(0.9 * s.length) - 1]);
}

/** Media con 1 decimal; null con n = 0. */
export function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Matriz 5×5 de conteos matrix[sugerido − 1][final − 1] (R8). */
export function confusionMatrix(pairs: readonly LevelPair[]): number[][] {
  const m = LEVELS.map(() => LEVELS.map(() => 0));
  for (const [s, f] of pairs) m[s - 1][f - 1] += 1;
  return m;
}

/**
 * Kappa de Cohen ponderado cuadrático con 5 categorías (D5, PA-F07-2): κ = 1 − Σ wᵢⱼ·Oᵢⱼ / Σ wᵢⱼ·Eᵢⱼ con
 * wᵢⱼ = (i − j)² y Eᵢⱼ = rᵢ·cⱼ / n. null con menos de 2 pares o si Σ w·E = 0 (acuerdo esperado 1). 3 decimales.
 */
export function weightedKappa(pairs: readonly LevelPair[]): number | null {
  const n = pairs.length;
  if (n < 2) return null;
  const o = confusionMatrix(pairs);
  const rows = o.map((r) => r.reduce((a, b) => a + b, 0));
  const cols = LEVELS.map((_, j) => o.reduce((a, r) => a + r[j], 0));
  let observed = 0;
  let expected = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    for (let j = 0; j < LEVELS.length; j++) {
      const w = (i - j) ** 2;
      observed += w * o[i][j];
      expected += (w * rows[i] * cols[j]) / n;
    }
  }
  if (expected === 0) return null;
  return round3(1 - observed / expected);
}
