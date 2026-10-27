import {
  canGenericTransition,
  canTransition,
  ENCOUNTER_STATUSES,
  type EncounterStatus,
  isTerminal,
} from './encounter-state-machine.js';

const ALLOWED = new Set([
  'REGISTERED>WAITING_TRIAGE',
  'WAITING_TRIAGE>TRIAGED',
  'TRIAGED>IN_CARE',
  'IN_CARE>CLOSED',
  'REGISTERED>CANCELLED',
  'WAITING_TRIAGE>CANCELLED',
  'TRIAGED>CANCELLED',
  'IN_CARE>CANCELLED',
]);

const pairs: [EncounterStatus, EncounterStatus][] = ENCOUNTER_STATUSES.flatMap(
  (from) =>
    ENCOUNTER_STATUSES.map(
      (to) => [from, to] as [EncounterStatus, EncounterStatus],
    ),
);

describe('EncounterStateMachine', () => {
  it('R33: la tabla completa 6 × 6 solo admite las ocho transiciones de la máquina', () => {
    expect(pairs).toHaveLength(36);
    for (const [from, to] of pairs) {
      expect([from, to, canTransition(from, to)]).toEqual([
        from,
        to,
        ALLOWED.has(`${from}>${to}`),
      ]);
    }
  });

  it('R33: ningún estado terminal (CLOSED, CANCELLED) tiene salida, ni siquiera hacia sí mismo', () => {
    for (const from of ['CLOSED', 'CANCELLED'] as const) {
      expect(isTerminal(from)).toBe(true);
      for (const to of ENCOUNTER_STATUSES)
        expect(canTransition(from, to)).toBe(false);
    }
    expect(isTerminal('IN_CARE')).toBe(false);
  });

  it('R34: la transición genérica rechaza TRIAGED como destino y admite el resto de la tabla', () => {
    for (const [from, to] of pairs) {
      expect(canGenericTransition(from, to)).toBe(
        to !== 'TRIAGED' && ALLOWED.has(`${from}>${to}`),
      );
    }
    expect(canGenericTransition('WAITING_TRIAGE', 'TRIAGED')).toBe(false);
  });
});
