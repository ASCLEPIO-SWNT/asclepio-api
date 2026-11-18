import type { Queue } from '../queue/queue.rules.js';

/**
 * Reglas puras de la posición del paciente y su espera estimada (F-10-api, design.md). Sin Nest ni base.
 */

/**
 * Constantes de la estimación (única definición, R3). Valores PROVISIONALES de PA-F10-1 (humano, 2026-11-18): ventana
 * de 4 h, mínimo de 5 salidas de la fase en la ventana, rango [0,5 × eta, 1,5 × eta] redondeado a 5 min.
 */
export const ESTIMATE = Object.freeze({
  windowMinutes: 240,
  minExits: 5,
  low: 0.5,
  high: 1.5,
  roundTo: 5,
});

export type QueuePhase =
  'NO_ACTIVE' | 'WAITING_TRIAGE' | 'WAITING_CARE' | 'CALLED' | 'DONE';
export const QUEUE_PHASES: QueuePhase[] = [
  'NO_ACTIVE',
  'WAITING_TRIAGE',
  'WAITING_CARE',
  'CALLED',
  'DONE',
];

export type EstimateBasis = 'RECENT_THROUGHPUT' | 'INSUFFICIENT_DATA';
export const ESTIMATE_BASES: EstimateBasis[] = [
  'RECENT_THROUGHPUT',
  'INSUFFICIENT_DATA',
];

export interface Position {
  phase: QueuePhase;
  position: number | null;
  aheadCount: number | null;
}

export interface WaitEstimate {
  estimate: { minMinutes: number; maxMinutes: number } | null;
  estimateBasis: EstimateBasis | null;
}

/**
 * Fase y posición (desde 1) de la atención en la cola de su sede (R2): waitingTriage → WAITING_TRIAGE, triaged →
 * WAITING_CARE, inCare → CALLED (sin posición); ausente → NO_ACTIVE (R5).
 */
export function positionOf(queue: Queue, encounterId: string): Position {
  const sections: [QueuePhase, Queue['waitingTriage']][] = [
    ['WAITING_TRIAGE', queue.waitingTriage],
    ['WAITING_CARE', queue.triaged],
  ];
  for (const [phase, items] of sections) {
    const i = items.findIndex((it) => it.encounterId === encounterId);
    if (i >= 0) return { phase, position: i + 1, aheadCount: i };
  }
  const called = queue.inCare.some((it) => it.encounterId === encounterId);
  return {
    phase: called ? 'CALLED' : 'NO_ACTIVE',
    position: null,
    aheadCount: null,
  };
}

/** Margen para que un producto exacto (p. ej. 120,000…01) no salte al múltiplo siguiente. */
const EPS = 1e-9;
const floorTo = (x: number, step: number) => Math.floor(x / step + EPS) * step;
const ceilTo = (x: number, step: number) => Math.ceil(x / step - EPS) * step;

/**
 * Estimación por el ritmo reciente de la fase en la sede (R3, R4, D4): con ≥ minExits salidas en la ventana,
 * intervalo = windowMinutes / salidas, eta = aheadCount × intervalo y rango [floor5(low × eta), max(5, ceil5(high ×
 * eta))] (el mínimo de 5 min es un paso de redondeo); con menos, INSUFFICIENT_DATA. Sin aheadCount (CALLED, DONE, NO_ACTIVE) → todo null.
 */
export function estimateWait(
  aheadCount: number | null,
  exits: number,
): WaitEstimate {
  if (aheadCount === null) return { estimate: null, estimateBasis: null };
  if (exits < ESTIMATE.minExits) {
    return { estimate: null, estimateBasis: 'INSUFFICIENT_DATA' };
  }
  const eta = (aheadCount * ESTIMATE.windowMinutes) / exits;
  return {
    estimate: {
      minMinutes: floorTo(ESTIMATE.low * eta, ESTIMATE.roundTo),
      maxMinutes: Math.max(
        ESTIMATE.roundTo,
        ceilTo(ESTIMATE.high * eta, ESTIMATE.roundTo),
      ),
    },
    estimateBasis: 'RECENT_THROUGHPUT',
  };
}
