import type { News2Score } from './news2.js';

/**
 * SafetyGuards (R18, R19 de F-04-api; ADR 0005): reglas deterministas sobre la puntuación NEWS2 que solo pueden
 * subir la gravedad sugerida por el LLM (un nivel más grave es un número menor). Pura: sin LLM ni base de datos.
 *
 * PROVISIONAL — no validado clínicamente, revisar con asesor clínico.
 * NEWS2 (RCP 2017) no define niveles I–V: la correspondencia es una decisión de producto del humano (PA-F04-1,
 * 2026-11-09). G4 (conciencia P/U → máx. I) se propuso y fue rechazada: no se implementa.
 */

export interface GuardTrigger {
  news2Total: number;
  field?: string;
  points?: number;
}

export interface GuardReason {
  rule: string;
  maxLevel: number;
  trigger: GuardTrigger;
}

export interface SafetyGuardRule {
  rule: string;
  maxLevel: number;
  description: string;
  /** Devuelve el disparador si la regla se cumple; si no, null. */
  check(news2: News2Score): GuardTrigger | null;
}

export const SAFETY_GUARD_RULES: readonly SafetyGuardRule[] = [
  {
    rule: 'G1',
    maxLevel: 2,
    description: 'NEWS2 total ≥ 7 → nivel máximo II',
    check: (n) => (n.total >= 7 ? { news2Total: n.total } : null),
  },
  {
    rule: 'G2',
    maxLevel: 3,
    description: 'NEWS2 total 5–6 → nivel máximo III',
    check: (n) =>
      n.total >= 5 && n.total <= 6 ? { news2Total: n.total } : null,
  },
  {
    rule: 'G3',
    maxLevel: 3,
    description: 'algún parámetro NEWS2 con 3 puntos → nivel máximo III',
    check: (n) => {
      const p = n.parameters.find((x) => x.points === 3);
      return p
        ? { news2Total: n.total, field: p.field, points: p.points }
        : null;
    },
  },
];

export interface GuardResult {
  suggestedLevel: number;
  guardApplied: boolean;
  guardReasons: GuardReason[];
}

/**
 * suggestedLevel = min(llmLevel, máximo de cada regla cumplida). guard_reasons lista solo las reglas cumplidas que
 * limitan el nivel (maxLevel < llmLevel); guard_applied = suggestedLevel < llmLevel (R18, R19).
 */
export function applyGuards(llmLevel: number, news2: News2Score): GuardResult {
  const guardReasons: GuardReason[] = [];
  let suggestedLevel = llmLevel;
  for (const r of SAFETY_GUARD_RULES) {
    const trigger = r.check(news2);
    if (trigger && r.maxLevel < llmLevel) {
      guardReasons.push({ rule: r.rule, maxLevel: r.maxLevel, trigger });
      suggestedLevel = Math.min(suggestedLevel, r.maxLevel);
    }
  }
  return {
    suggestedLevel,
    guardApplied: suggestedLevel < llmLevel,
    guardReasons,
  };
}
