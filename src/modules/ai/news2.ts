import type { SnapshotVitalSigns } from './triage-input.js';

/**
 * Puntuación NEWS2 (R17 de F-04-api, tabla D10 de specs/F-04-api/design.md). Pura: sin LLM ni base de datos.
 *
 * PROVISIONAL — no validado clínicamente, revisar con asesor clínico.
 * Fuente: Royal College of Physicians. National Early Warning Score (NEWS) 2. Londres: RCP, 2017 (escala 1 de SpO₂).
 * Decidió: el humano, PA-F04-1, 2026-11-09. Esta es la única definición de la tabla en el código.
 *
 * Un parámetro ausente (null) no puntúa: en la API los siete llegan siempre (obligatorios en F-03), pero una viñeta
 * de ai:eval puede no traerlos todos.
 */

/** Banda numérica: hasta `upTo` inclusive vale `points`. Las bandas van en orden creciente. */
interface Band {
  upTo: number;
  points: number;
}

export const NEWS2_TABLE = {
  /** Frecuencia respiratoria (rpm): ≤8 → 3; 9–11 → 1; 12–20 → 0; 21–24 → 2; ≥25 → 3. */
  respiratory_rate: [
    { upTo: 8, points: 3 },
    { upTo: 11, points: 1 },
    { upTo: 20, points: 0 },
    { upTo: 24, points: 2 },
    { upTo: Infinity, points: 3 },
  ],
  /** SpO₂ escala 1 (%): ≤91 → 3; 92–93 → 2; 94–95 → 1; ≥96 → 0. */
  spo2: [
    { upTo: 91, points: 3 },
    { upTo: 93, points: 2 },
    { upTo: 95, points: 1 },
    { upTo: Infinity, points: 0 },
  ],
  /** Oxígeno suplementario: sí → 2; no → 0. */
  supplemental_oxygen: { true: 2, false: 0 },
  /** Presión arterial sistólica (mmHg): ≤90 → 3; 91–100 → 2; 101–110 → 1; 111–219 → 0; ≥220 → 3. */
  systolic_bp: [
    { upTo: 90, points: 3 },
    { upTo: 100, points: 2 },
    { upTo: 110, points: 1 },
    { upTo: 219, points: 0 },
    { upTo: Infinity, points: 3 },
  ],
  /** Frecuencia cardiaca (lpm): ≤40 → 3; 41–50 → 1; 51–90 → 0; 91–110 → 1; 111–130 → 2; ≥131 → 3. */
  heart_rate: [
    { upTo: 40, points: 3 },
    { upTo: 50, points: 1 },
    { upTo: 90, points: 0 },
    { upTo: 110, points: 1 },
    { upTo: 130, points: 2 },
    { upTo: Infinity, points: 3 },
  ],
  /** Conciencia (ACVPU): A → 0; C, V, P o U → 3. */
  consciousness: { A: 0, C: 3, V: 3, P: 3, U: 3 },
  /** Temperatura (°C, un decimal): ≤35.0 → 3; 35.1–36.0 → 1; 36.1–38.0 → 0; 38.1–39.0 → 1; ≥39.1 → 2. */
  temperature_c: [
    { upTo: 35.0, points: 3 },
    { upTo: 36.0, points: 1 },
    { upTo: 38.0, points: 0 },
    { upTo: 39.0, points: 1 },
    { upTo: Infinity, points: 2 },
  ],
} as const satisfies Record<string, readonly Band[] | Record<string, number>>;

export type News2Field = keyof typeof NEWS2_TABLE;

export interface News2Parameter {
  /** Path en la instantánea (`vital_signs.<campo>`). */
  field: `vital_signs.${News2Field}`;
  points: number;
}

export interface News2Score {
  total: number;
  parameters: News2Parameter[];
}

function bandPoints(bands: readonly Band[], value: number): number {
  return bands.find((b) => value <= b.upTo)!.points;
}

/** Puntuación NEWS2 total y por parámetro de la toma vigente (R17). */
export function scoreNews2(v: SnapshotVitalSigns): News2Score {
  const parameters: News2Parameter[] = [];
  const add = (field: News2Field, points: number) =>
    parameters.push({ field: `vital_signs.${field}`, points });

  for (const field of [
    'respiratory_rate',
    'spo2',
    'systolic_bp',
    'heart_rate',
    'temperature_c',
  ] as const) {
    const value = v[field];
    if (value !== null && value !== undefined) {
      add(field, bandPoints(NEWS2_TABLE[field], value));
    }
  }
  if (v.supplemental_oxygen !== null && v.supplemental_oxygen !== undefined) {
    add(
      'supplemental_oxygen',
      NEWS2_TABLE.supplemental_oxygen[v.supplemental_oxygen ? 'true' : 'false'],
    );
  }
  if (v.consciousness) {
    add('consciousness', NEWS2_TABLE.consciousness[v.consciousness]);
  }
  return {
    total: parameters.reduce((sum, p) => sum + p.points, 0),
    parameters,
  };
}
