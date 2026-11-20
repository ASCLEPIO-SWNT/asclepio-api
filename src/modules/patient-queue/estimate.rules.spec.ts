import type { EncounterStatus } from '../encounters/encounter-state-machine.js';
import { buildQueue, type QueueRow } from '../queue/queue.rules.js';
import { ESTIMATE, estimateWait, positionOf } from './estimate.rules.js';

const NOW = new Date('2026-11-18T15:00:00.000Z');
const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function ago(min: number): Date {
  return new Date(NOW.getTime() - min * 60_000);
}

function row(
  id: string,
  status: EncounterStatus,
  arrivalMinAgo: number,
  finalLevel: number | null = null,
  triagedMinAgo: number | null = finalLevel !== null ? arrivalMinAgo : null,
): QueueRow {
  return {
    id,
    siteId: SITE,
    siteName: 'DEV-Sede Norte',
    status,
    finalLevel,
    arrivalAt: ago(arrivalMinAgo),
    triagedAt: triagedMinAgo === null ? null : ago(triagedMinAgo),
    hasRedFlags: false,
    patient: {
      fullName: 'DEV María Pérez',
      birthDate: '1968-03-15',
      estimatedAgeYears: null,
      sex: 'F',
    },
  };
}

describe('estimate.rules (F-10-api)', () => {
  describe('positionOf', () => {
    const queue = buildQueue(
      [
        row('w-1', 'WAITING_TRIAGE', 10),
        row('w-2', 'WAITING_TRIAGE', 30),
        row('t-3', 'TRIAGED', 60, 3, 50),
        row('t-2', 'TRIAGED', 20, 2, 5),
        row('c-1', 'IN_CARE', 90, 3),
      ],
      NOW,
    );

    it('R2: en WAITING_TRIAGE la posición es el índice desde 1 en waitingTriage (mayor espera primero)', () => {
      expect(positionOf(queue, 'w-2')).toEqual({
        phase: 'WAITING_TRIAGE',
        position: 1,
        aheadCount: 0,
      });
      expect(positionOf(queue, 'w-1')).toEqual({
        phase: 'WAITING_TRIAGE',
        position: 2,
        aheadCount: 1,
      });
    });

    it('R2: en TRIAGED la fase es WAITING_CARE y un nivel más urgente queda delante aunque se clasificara después', () => {
      expect(positionOf(queue, 't-2')).toEqual({
        phase: 'WAITING_CARE',
        position: 1,
        aheadCount: 0,
      });
      expect(positionOf(queue, 't-3')).toEqual({
        phase: 'WAITING_CARE',
        position: 2,
        aheadCount: 1,
      });
    });

    it('R2: con el mismo nivel, el empate lo resuelve buildQueue (más tiempo desde la clasificación, luego id)', () => {
      const q = buildQueue(
        [
          row('b', 'TRIAGED', 30, 3, 10),
          row('a', 'TRIAGED', 30, 3, 10),
          row('c', 'TRIAGED', 30, 3, 20),
        ],
        NOW,
      );
      expect(['c', 'a', 'b'].map((id) => positionOf(q, id).position)).toEqual([
        1, 2, 3,
      ]);
    });

    it('R2: en IN_CARE la fase es CALLED, sin posición ni personas delante', () => {
      expect(positionOf(queue, 'c-1')).toEqual({
        phase: 'CALLED',
        position: null,
        aheadCount: null,
      });
    });

    it('R5: una atención ausente de la cola → NO_ACTIVE, sin posición', () => {
      expect(positionOf(queue, 'otra')).toEqual({
        phase: 'NO_ACTIVE',
        position: null,
        aheadCount: null,
      });
    });
  });

  describe('estimateWait', () => {
    it('R3: las constantes de PA-F10-1 tienen una única definición', () => {
      expect(ESTIMATE).toEqual({
        windowMinutes: 240,
        minExits: 5,
        low: 0.5,
        high: 1.5,
        roundTo: 5,
      });
      expect(Object.isFrozen(ESTIMATE)).toBe(true);
    });

    it('R4: con 4 salidas en la ventana → estimate null e INSUFFICIENT_DATA', () => {
      expect(estimateWait(3, 4)).toEqual({
        estimate: null,
        estimateBasis: 'INSUFFICIENT_DATA',
      });
      expect(estimateWait(0, 0)).toEqual({
        estimate: null,
        estimateBasis: 'INSUFFICIENT_DATA',
      });
    });

    it('R3: con 5 salidas, intervalo = 240/5 = 48 min; 2 delante → eta 96 → [45, 145]', () => {
      // 0,5 × 96 = 48 → floor5 = 45; 1,5 × 96 = 144 → ceil5 = 145.
      expect(estimateWait(2, 5)).toEqual({
        estimate: { minMinutes: 45, maxMinutes: 145 },
        estimateBasis: 'RECENT_THROUGHPUT',
      });
    });

    it('R3: redondea a múltiplos de 5 sin errores de coma flotante en los valores exactos', () => {
      // 240/6 = 40; 2 delante → eta 80 → 40 y 120 exactos.
      expect(estimateWait(2, 6).estimate).toEqual({
        minMinutes: 40,
        maxMinutes: 120,
      });
      // 240/7 ≈ 34,29; 1 delante → 17,14 → 15 y 51,43 → 55.
      expect(estimateWait(1, 7).estimate).toEqual({
        minMinutes: 15,
        maxMinutes: 55,
      });
    });

    it('R3: el máximo nunca baja de 5 min (0 delante → [0, 5]; mucho ritmo → [0, 5])', () => {
      expect(estimateWait(0, 5).estimate).toEqual({
        minMinutes: 0,
        maxMinutes: 5,
      });
      expect(estimateWait(1, 200).estimate).toEqual({
        minMinutes: 0,
        maxMinutes: 5,
      });
    });

    it('R5: sin personas delante conocidas (CALLED, DONE, NO_ACTIVE) no hay estimación ni base', () => {
      expect(estimateWait(null, 50)).toEqual({
        estimate: null,
        estimateBasis: null,
      });
    });
  });
});
