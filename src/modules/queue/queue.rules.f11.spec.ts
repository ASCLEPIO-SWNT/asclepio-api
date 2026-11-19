import type { EncounterStatus } from '../encounters/encounter-state-machine.js';
import { positionOf } from '../patient-queue/estimate.rules.js';
import { buildQueue, type QueueRow } from './queue.rules.js';

const NOW = new Date('2026-11-18T15:00:00.000Z');
const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MIN = 60_000;

function row(
  id: string,
  status: EncounterStatus,
  arrivalMinAgo: number,
  hasRedFlags: boolean,
  finalLevel: number | null = status === 'WAITING_TRIAGE' ? null : 3,
): QueueRow {
  const arrivalAt = new Date(NOW.getTime() - arrivalMinAgo * MIN);
  return {
    id,
    siteId: SITE,
    siteName: 'DEV-Sede Norte',
    status,
    finalLevel,
    arrivalAt,
    triagedAt: finalLevel === null ? null : arrivalAt,
    hasRedFlags,
    patient: {
      fullName: 'DEV María José Pérez',
      birthDate: '1968-03-15',
      estimatedAgeYears: null,
      sex: 'F',
    },
  };
}

const ids = (items: { encounterId: string }[]) =>
  items.map((i) => i.encounterId);

describe('queue.rules con señales de alarma (F-11-api)', () => {
  it('R8: waitingTriage pone primero las atenciones con señales y, en cada grupo, la mayor espera desde la llegada', () => {
    const q = buildQueue(
      [
        row('a', 'WAITING_TRIAGE', 50, false),
        row('b', 'WAITING_TRIAGE', 5, true),
        row('c', 'WAITING_TRIAGE', 30, false),
        row('d', 'WAITING_TRIAGE', 20, true),
      ],
      NOW,
    );
    expect(ids(q.waitingTriage)).toEqual(['d', 'b', 'a', 'c']);
  });

  it('R8: cada elemento de la cola lleva hasRedFlags', () => {
    const q = buildQueue(
      [
        row('a', 'WAITING_TRIAGE', 5, true),
        row('b', 'TRIAGED', 5, true),
        row('c', 'IN_CARE', 5, false),
      ],
      NOW,
    );
    expect(q.waitingTriage[0].hasRedFlags).toBe(true);
    expect(q.triaged[0].hasRedFlags).toBe(true);
    expect(q.inCare[0].hasRedFlags).toBe(false);
  });

  it('R8: el orden de triaged e inCare no cambia por las señales', () => {
    const q = buildQueue(
      [
        row('t1', 'TRIAGED', 10, false, 2),
        row('t2', 'TRIAGED', 40, true, 3),
        row('c1', 'IN_CARE', 30, false, 1),
        row('c2', 'IN_CARE', 60, true, 4),
      ],
      NOW,
    );
    expect(ids(q.triaged)).toEqual(['t1', 't2']);
    expect(ids(q.inCare)).toEqual(['c1', 'c2']);
  });

  it('R8: la posición del paciente (F-10) hereda el orden: una atención con señales que llegó después va delante', () => {
    const q = buildQueue(
      [
        row('mine', 'WAITING_TRIAGE', 40, false),
        row('flagged', 'WAITING_TRIAGE', 2, true),
      ],
      NOW,
    );
    expect(positionOf(q, 'mine')).toEqual({
      phase: 'WAITING_TRIAGE',
      position: 2,
      aheadCount: 1,
    });
  });
});
