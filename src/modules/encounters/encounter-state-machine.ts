/** Estados de la atención (enum encounter_status). */
export const ENCOUNTER_STATUSES = [
  'REGISTERED',
  'WAITING_TRIAGE',
  'TRIAGED',
  'IN_CARE',
  'CLOSED',
  'CANCELLED',
] as const;
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];

const TERMINAL: ReadonlySet<EncounterStatus> = new Set(['CLOSED', 'CANCELLED']);

/** Transiciones admitidas (docs/data-model.md, R33). */
const TRANSITIONS: Readonly<
  Record<EncounterStatus, readonly EncounterStatus[]>
> = {
  REGISTERED: ['WAITING_TRIAGE', 'CANCELLED'],
  WAITING_TRIAGE: ['TRIAGED', 'CANCELLED'],
  TRIAGED: ['IN_CARE', 'CANCELLED'],
  IN_CARE: ['CLOSED', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: [],
};

export function isTerminal(status: EncounterStatus): boolean {
  return TERMINAL.has(status);
}

/** Máquina de estados pura (sin Nest ni base). */
export function canTransition(
  from: EncounterStatus,
  to: EncounterStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Transición genérica de EncountersService.transition (R34): nunca a TRIAGED, que exige una fila en
 * triage_decisions (RNF-03) y llegará con su propia vía en F-05.
 */
export function canGenericTransition(
  from: EncounterStatus,
  to: EncounterStatus,
): boolean {
  return to !== 'TRIAGED' && canTransition(from, to);
}
