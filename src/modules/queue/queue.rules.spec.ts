import type { EncounterStatus } from '../encounters/encounter-state-machine.js';
import {
  buildQueue,
  initials,
  isOverdue,
  MAX_WAIT_MINUTES_BY_LEVEL,
  maxWaitMinutes,
  type QueueRow,
  waitMinutes,
} from './queue.rules.js';

const NOW = new Date('2026-11-09T15:00:00.000Z');
const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Hora de llegada `min` minutos (y `sec` segundos) antes de NOW. */
function ago(min: number, sec = 0): Date {
  return new Date(NOW.getTime() - min * 60_000 - sec * 1000);
}

/** `triagedAt`, si no se indica, es la llegada cuando hay nivel (clasificada al llegar; DT-02-api, T5). */
function row(
  id: string,
  status: EncounterStatus,
  arrivalAt: Date,
  finalLevel: number | null = null,
  patient: Partial<QueueRow['patient']> = {},
  triagedAt: Date | null = finalLevel !== null ? arrivalAt : null,
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
      ...patient,
    },
  };
}

const ids = (items: { encounterId: string }[]) =>
  items.map((i) => i.encounterId);

describe('queue.rules (F-06-api)', () => {
  describe('waitMinutes', () => {
    it('R3: cuenta minutos enteros completos desde la llegada hasta serverNow', () => {
      expect(waitMinutes(ago(0, 59), NOW)).toBe(0);
      expect(waitMinutes(ago(1), NOW)).toBe(1);
      expect(waitMinutes(new Date(NOW.getTime() - 119_999), NOW)).toBe(1);
      expect(waitMinutes(new Date(NOW.getTime() - 120_000), NOW)).toBe(2);
      expect(waitMinutes(NOW, NOW)).toBe(0);
    });
  });

  describe('tiempos máximos y overdue', () => {
    it('R4: los tiempos máximos son una única definición: I = 0 y II = 30 (Res. 5596 de 2015); III–V sin tiempo', () => {
      expect(MAX_WAIT_MINUTES_BY_LEVEL).toEqual({ 1: 0, 2: 30 });
      expect([1, 2, 3, 4, 5, null].map(maxWaitMinutes)).toEqual([
        0,
        30,
        null,
        null,
        null,
        null,
      ]);
    });

    // Modificado por DT-02-api: isOverdue recibe los milisegundos exactos desde la clasificación.
    it('R4: nivel I vence con más de 0 ms y nivel II con más de 30 min, con el tiempo exacto desde la clasificación', () => {
      expect(isOverdue(1, 0)).toBe(false);
      expect(isOverdue(1, 1)).toBe(true);
      expect(isOverdue(2, 1_800_000)).toBe(false);
      expect(isOverdue(2, 1_800_001)).toBe(true);
    });

    it('R4: III, IV, V y sin nivel nunca vencen', () => {
      for (const level of [3, 4, 5, null]) {
        expect([level, isOverdue(level, 100_000)]).toEqual([level, false]);
      }
    });
  });

  describe('initials', () => {
    it('R2: primera letra de la primera y de la última palabra, en mayúscula y sin tilde', () => {
      expect(initials('maría josé pérez')).toBe('MP');
      expect(initials('Ángela Úrsula Ñáñez')).toBe('AN');
      expect(initials('Ánder')).toBe('A');
      expect(initials('  juan   de   la   cruz  ')).toBe('JC');
    });

    it('R2: un NN (sin nombre) o un nombre vacío no tiene iniciales', () => {
      expect(initials(null)).toBeNull();
      expect(initials('   ')).toBeNull();
    });
  });

  describe('buildQueue', () => {
    // Modificado por DT-02-api (R5): dentro del nivel, triaged va por minutos desde la clasificación, no por la llegada.
    it('R1: reparte por estado y ordena: waitingTriage por mayor espera; triaged por nivel y minutos desde la clasificación; inCare por nivel y llegada', () => {
      const rows = [
        row('w-1', 'WAITING_TRIAGE', ago(5)),
        row('w-2', 'WAITING_TRIAGE', ago(40)),
        row('t-3-old', 'TRIAGED', ago(90), 3, {}, ago(80)),
        row('t-1', 'TRIAGED', ago(2), 1, {}, ago(1)),
        row('t-2-new', 'TRIAGED', ago(10), 2, {}, ago(10)),
        row('t-2-old', 'TRIAGED', ago(50), 2, {}, ago(5)),
        row('c-2', 'IN_CARE', ago(200), 2),
        row('c-1-new', 'IN_CARE', ago(20), 1),
        row('c-1-old', 'IN_CARE', ago(60), 1),
      ];
      const q = buildQueue(rows, NOW);
      expect(q.serverNow).toBe(NOW.toISOString());
      expect(ids(q.waitingTriage)).toEqual(['w-2', 'w-1']);
      expect(ids(q.triaged)).toEqual(['t-1', 't-2-new', 't-2-old', 't-3-old']);
      expect(ids(q.inCare)).toEqual(['c-1-old', 'c-1-new', 'c-2']);
    });

    it('R1: los empates se resuelven por id ascendente', () => {
      const at = ago(7);
      const q = buildQueue(
        [
          row('b', 'WAITING_TRIAGE', at),
          row('a', 'WAITING_TRIAGE', ago(7, 30)),
          row('d', 'TRIAGED', at, 2),
          row('c', 'TRIAGED', at, 2),
          row('f', 'IN_CARE', at, 3),
          row('e', 'IN_CARE', at, 3),
        ],
        NOW,
      );
      // 'a' llegó 30 s antes, pero ambos llevan 7 minutos completos: empate → id.
      expect(ids(q.waitingTriage)).toEqual(['a', 'b']);
      expect(ids(q.triaged)).toEqual(['c', 'd']);
      expect(ids(q.inCare)).toEqual(['e', 'f']);
    });

    it('R8: excluye REGISTERED, CLOSED y CANCELLED', () => {
      const q = buildQueue(
        [
          row('r', 'REGISTERED', ago(1)),
          row('x', 'CLOSED', ago(1), 1),
          row('y', 'CANCELLED', ago(1)),
          row('w', 'WAITING_TRIAGE', ago(1)),
        ],
        NOW,
      );
      expect(ids([...q.waitingTriage, ...q.triaged, ...q.inCare])).toEqual([
        'w',
      ]);
    });

    it('R2: cada elemento tiene la forma de la cola; finalLevel null en waitingTriage y waitMinutes null en inCare', () => {
      const q = buildQueue(
        [
          row('w', 'WAITING_TRIAGE', ago(12, 5), 4),
          row('t', 'TRIAGED', ago(31), 2, {
            fullName: null,
            birthDate: null,
            estimatedAgeYears: 40,
            sex: null,
          }),
          row('c', 'IN_CARE', ago(500), 1, {
            birthDate: null,
            estimatedAgeYears: null,
            sex: 'X',
          }),
        ],
        NOW,
      );
      expect(q.waitingTriage).toEqual([
        {
          encounterId: 'w',
          siteId: SITE,
          siteName: 'DEV-Sede Norte',
          status: 'WAITING_TRIAGE',
          finalLevel: null,
          arrivalAt: ago(12, 5).toISOString(),
          waitMinutes: 12,
          minutesSinceTriage: null,
          maxWaitMinutes: null,
          overdue: false,
          patient: { initials: 'DP', ageYears: 58, sex: 'F' },
        },
      ]);
      expect(q.triaged).toEqual([
        {
          encounterId: 't',
          siteId: SITE,
          siteName: 'DEV-Sede Norte',
          status: 'TRIAGED',
          finalLevel: 2,
          arrivalAt: ago(31).toISOString(),
          waitMinutes: 31,
          minutesSinceTriage: 31,
          maxWaitMinutes: 30,
          overdue: true,
          patient: { initials: null, ageYears: 40, sex: null },
        },
      ]);
      expect(q.inCare).toEqual([
        {
          encounterId: 'c',
          siteId: SITE,
          siteName: 'DEV-Sede Norte',
          status: 'IN_CARE',
          finalLevel: 1,
          arrivalAt: ago(500).toISOString(),
          waitMinutes: null,
          minutesSinceTriage: null,
          maxWaitMinutes: 0,
          overdue: false,
          patient: { initials: 'DP', ageYears: null, sex: 'X' },
        },
      ]);
    });

    it('R4: overdue solo en TRIAGED (nunca en waitingTriage ni en inCare)', () => {
      const q = buildQueue(
        [
          row('t1', 'TRIAGED', ago(1), 1),
          row('t1-ok', 'TRIAGED', ago(0, 59), 1),
          row('t1-now', 'TRIAGED', NOW, 1),
          row('c1', 'IN_CARE', ago(300), 1),
          row('w', 'WAITING_TRIAGE', ago(300)),
          row('t5', 'TRIAGED', ago(10_000), 5),
        ],
        NOW,
      );
      const overdue = Object.fromEntries(
        [...q.waitingTriage, ...q.triaged, ...q.inCare].map((i) => [
          i.encounterId,
          i.overdue,
        ]),
      );
      expect(overdue).toEqual({
        t1: true,
        // Modificado por DT-02-api: tiempo exacto, nivel I vence en cuanto pasa tiempo desde la clasificación.
        't1-ok': true,
        't1-now': false,
        c1: false,
        w: false,
        t5: false,
      });
    });

    it('R2: la edad se calcula en Bogotá con serverNow (birthDate, si no la estimada)', () => {
      // 2026-11-10T02:00Z: en Bogotá aún es 9 de noviembre.
      const late = new Date('2026-11-10T02:00:00Z');
      const q = buildQueue(
        [row('a', 'WAITING_TRIAGE', late, null, { birthDate: '1990-11-10' })],
        late,
      );
      expect(q.waitingTriage[0].patient.ageYears).toBe(35);
    });
  });
});
