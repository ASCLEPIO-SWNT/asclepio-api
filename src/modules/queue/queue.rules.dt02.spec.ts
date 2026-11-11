import type { EncounterStatus } from '../encounters/encounter-state-machine.js';
import {
  buildQueue,
  isOverdue,
  minutesSinceTriage,
  type QueueItem,
  type QueueRow,
} from './queue.rules.js';

const NOW = new Date('2026-11-11T15:00:00.000Z');
const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MIN = 60_000;

/** Instante `ms` milisegundos antes de NOW. */
const before = (ms: number) => new Date(NOW.getTime() - ms);

function row(
  id: string,
  status: EncounterStatus,
  arrivalAt: Date,
  finalLevel: number | null,
  triagedAt: Date | null,
): QueueRow {
  return {
    id,
    siteId: SITE,
    siteName: 'DEV-Sede Norte',
    status,
    finalLevel,
    arrivalAt,
    triagedAt,
    patient: {
      fullName: 'DEV María José Pérez',
      birthDate: '1968-03-15',
      estimatedAgeYears: null,
      sex: 'F',
    },
  };
}

/** El único elemento de la cola construida con una fila. */
function only(r: QueueRow, now = NOW): QueueItem {
  const q = buildQueue([r], now);
  const all = [...q.waitingTriage, ...q.triaged, ...q.inCare];
  expect(all).toHaveLength(1);
  return all[0];
}

const ids = (items: { encounterId: string }[]) =>
  items.map((i) => i.encounterId);

describe('queue.rules (DT-02-api: desde la clasificación)', () => {
  describe('minutesSinceTriage', () => {
    it('R1: minutos completos desde triaged_at hasta serverNow (floor)', () => {
      expect(minutesSinceTriage(before(59_000), NOW)).toBe(0);
      expect(minutesSinceTriage(before(60_000), NOW)).toBe(1);
      expect(minutesSinceTriage(before(30 * MIN + 59_000), NOW)).toBe(30);
      expect(minutesSinceTriage(NOW, NOW)).toBe(0);
    });

    it('R1: el elemento de triaged lleva minutesSinceTriage; waitingTriage e inCare, null', () => {
      expect(
        only(row('t', 'TRIAGED', before(50 * MIN), 3, before(12 * MIN + 1)))
          .minutesSinceTriage,
      ).toBe(12);
      expect(
        only(row('w', 'WAITING_TRIAGE', before(50 * MIN), null, null))
          .minutesSinceTriage,
      ).toBeNull();
      expect(
        only(row('c', 'IN_CARE', before(50 * MIN), 2, before(40 * MIN)))
          .minutesSinceTriage,
      ).toBeNull();
    });
  });

  describe('isOverdue (tiempo exacto en milisegundos)', () => {
    it('R2: nivel II vence con más de 1 800 000 ms y nivel I con más de 0 ms desde la clasificación', () => {
      expect(isOverdue(2, 1_800_000)).toBe(false);
      expect(isOverdue(2, 1_800_001)).toBe(true);
      expect(isOverdue(1, 0)).toBe(false);
      expect(isOverdue(1, 1)).toBe(true);
    });

    it('R2: III, IV, V y sin nivel nunca vencen', () => {
      for (const level of [3, 4, 5, null]) {
        expect([level, isOverdue(level, 10 * 24 * 60 * MIN)]).toEqual([
          level,
          false,
        ]);
      }
    });

    it('R2: TRIAGED de III–V con mucho tiempo desde la clasificación sigue sin alerta', () => {
      for (const level of [3, 4, 5]) {
        const i = only(
          row('t', 'TRIAGED', before(600 * MIN), level, before(500 * MIN)),
        );
        expect([level, i.overdue, i.maxWaitMinutes]).toEqual([
          level,
          false,
          null,
        ]);
      }
    });
  });

  describe('instantes límite con buildQueue', () => {
    it('R3: nivel II llegado hace 90 min: 30:00.000 → false; 30:00.001 y 30:01 → true con 30; 31:00 → true con 31', () => {
      const cases: [number, boolean, number][] = [
        [30 * MIN, false, 30],
        [30 * MIN + 1, true, 30],
        [30 * MIN + 1000, true, 30],
        [31 * MIN, true, 31],
      ];
      for (const [sinceTriage, overdue, minutes] of cases) {
        const i = only(
          row('t2', 'TRIAGED', before(90 * MIN), 2, before(sinceTriage)),
        );
        expect([
          sinceTriage,
          i.waitMinutes,
          i.overdue,
          i.minutesSinceTriage,
        ]).toEqual([sinceTriage, 90, overdue, minutes]);
        expect(i.maxWaitMinutes).toBe(30);
      }
    });

    it('R3: nivel I con triagedAt = serverNow → false; 1 ms y 1 s después → true, con minutesSinceTriage = 0', () => {
      const cases: [number, boolean][] = [
        [0, false],
        [1, true],
        [1000, true],
      ];
      for (const [sinceTriage, overdue] of cases) {
        const i = only(
          row('t1', 'TRIAGED', before(90 * MIN), 1, before(sinceTriage)),
        );
        expect([sinceTriage, i.overdue, i.minutesSinceTriage]).toEqual([
          sinceTriage,
          overdue,
          0,
        ]);
        expect(i.maxWaitMinutes).toBe(0);
      }
    });

    it('R3: la espera desde la llegada no decide la alerta (llegada hace 600 min, clasificada hace 10 → false)', () => {
      const i = only(
        row('t2', 'TRIAGED', before(600 * MIN), 2, before(10 * MIN)),
      );
      expect([i.waitMinutes, i.minutesSinceTriage, i.overdue]).toEqual([
        600,
        10,
        false,
      ]);
    });
  });

  describe('estados fuera de triaged y fila incoherente', () => {
    it('R6: IN_CARE → overdue false, minutesSinceTriage null, waitMinutes null y maxWaitMinutes según su nivel', () => {
      const cases: [number, number | null][] = [
        [1, 0],
        [2, 30],
        [3, null],
      ];
      for (const [level, max] of cases) {
        const i = only(
          row('c', 'IN_CARE', before(500 * MIN), level, before(400 * MIN)),
        );
        expect([
          level,
          i.overdue,
          i.minutesSinceTriage,
          i.waitMinutes,
          i.maxWaitMinutes,
        ]).toEqual([level, false, null, null, max]);
      }
    });

    it('R7: WAITING_TRIAGE → finalLevel null, maxWaitMinutes null, minutesSinceTriage null y overdue false', () => {
      const i = only(
        row('w', 'WAITING_TRIAGE', before(300 * MIN), 2, before(200 * MIN)),
      );
      expect(i).toMatchObject({
        finalLevel: null,
        maxWaitMinutes: null,
        minutesSinceTriage: null,
        overdue: false,
        waitMinutes: 300,
      });
    });

    it('R8: TRIAGED sin triaged_at → minutesSinceTriage null y overdue false, sin error', () => {
      for (const level of [null, 1, 2]) {
        const i = only(row('x', 'TRIAGED', before(300 * MIN), level, null));
        expect([level, i.minutesSinceTriage, i.overdue]).toEqual([
          level,
          null,
          false,
        ]);
      }
    });

    it('R9: waitMinutes, minutesSinceTriage y overdue salen del mismo now', () => {
      const later = new Date(NOW.getTime() + 1);
      const r = row('t2', 'TRIAGED', before(90 * MIN), 2, before(30 * MIN));
      expect(only(r, NOW)).toMatchObject({
        waitMinutes: 90,
        minutesSinceTriage: 30,
        overdue: false,
      });
      const q = buildQueue([r], later);
      expect(q.serverNow).toBe(later.toISOString());
      expect(q.triaged[0]).toMatchObject({
        waitMinutes: 90,
        minutesSinceTriage: 30,
        overdue: true,
      });
      expect(ids(q.triaged)).toEqual(['t2']);
    });
  });
});
