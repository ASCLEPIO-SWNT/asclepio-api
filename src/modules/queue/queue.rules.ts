import { ageInYears } from '../../common/clock/age.js';
import { bogotaDate } from '../../common/clock/clock.js';
import type { EncounterStatus } from '../encounters/encounter-state-machine.js';

/**
 * Reglas puras de la cola priorizada (F-06-api, design.md). Sin Nest ni base: todo se calcula con un único `now`
 * (serverNow, R3).
 */

/**
 * Tiempo máximo de espera por nivel de triage, en minutos (única definición, R4).
 * Res. 5596 de 2015: I inmediato, II 30 min; III–V sin tiempo máximo en el MVP (PA-F06-1, opción (a), humano,
 * 2026-11-09). La norma deja III–V a cada IPS: no se inventan valores.
 */
export const MAX_WAIT_MINUTES_BY_LEVEL: Readonly<Record<number, number>> =
  Object.freeze({ 1: 0, 2: 30 });

export type QueueSex = 'M' | 'F' | 'X';

/** Fila leída por EncountersService.listActiveForQueue (solo los campos de D2). */
export interface QueueRow {
  id: string;
  siteId: string;
  siteName: string;
  status: EncounterStatus;
  finalLevel: number | null;
  arrivalAt: Date;
  patient: {
    fullName: string | null;
    /** Fecha civil YYYY-MM-DD. */
    birthDate: string | null;
    estimatedAgeYears: number | null;
    sex: QueueSex | null;
  };
}

/** Datos del paciente en la cola (PA-F06-5, R7): nunca nombre, documento, fecha de nacimiento ni id. */
export interface QueuePatient {
  initials: string | null;
  ageYears: number | null;
  sex: QueueSex | null;
}

export interface QueueItem {
  encounterId: string;
  siteId: string;
  siteName: string;
  status: EncounterStatus;
  finalLevel: number | null;
  arrivalAt: string;
  waitMinutes: number | null;
  maxWaitMinutes: number | null;
  overdue: boolean;
  patient: QueuePatient;
}

export interface Queue {
  serverNow: string;
  waitingTriage: QueueItem[];
  triaged: QueueItem[];
  inCare: QueueItem[];
}

/** Minutos enteros completos desde la llegada hasta `now` (PA-F06-2, R3). */
export function waitMinutes(arrivalAt: Date, now: Date): number {
  return Math.floor((now.getTime() - arrivalAt.getTime()) / 60_000);
}

/** Tiempo máximo del nivel; null sin nivel o en III–V (R4). */
export function maxWaitMinutes(level: number | null): number | null {
  return level === null ? null : (MAX_WAIT_MINUTES_BY_LEVEL[level] ?? null);
}

/** true si la espera supera el tiempo máximo del nivel (I > 0, II > 30); nunca en III–V ni sin nivel (R4). */
export function isOverdue(level: number | null, wait: number): boolean {
  const max = maxWaitMinutes(level);
  return max !== null && wait > max;
}

function firstLetter(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').charAt(0).toUpperCase();
}

/** Primera letra (mayúscula, sin tilde) de la primera y la última palabra; una sola palabra → una letra; NN → null. */
export function initials(fullName: string | null): string | null {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const first = firstLetter(words[0]);
  return words.length === 1
    ? first
    : first + firstLetter(words[words.length - 1]);
}

function toItem(r: QueueRow, now: Date, today: string): QueueItem {
  const waiting = r.status === 'WAITING_TRIAGE';
  const triaged = r.status === 'TRIAGED';
  const level = waiting ? null : r.finalLevel;
  const wait = r.status === 'IN_CARE' ? null : waitMinutes(r.arrivalAt, now);
  const p = r.patient;
  return {
    encounterId: r.id,
    siteId: r.siteId,
    siteName: r.siteName,
    status: r.status,
    finalLevel: level,
    arrivalAt: r.arrivalAt.toISOString(),
    waitMinutes: wait,
    maxWaitMinutes: maxWaitMinutes(level),
    overdue: triaged && wait !== null && isOverdue(level, wait),
    patient: {
      initials: initials(p.fullName),
      ageYears: p.birthDate
        ? ageInYears(p.birthDate, today)
        : p.estimatedAgeYears,
      sex: p.sex,
    },
  };
}

const byId = (a: QueueItem, b: QueueItem) =>
  a.encounterId < b.encounterId ? -1 : a.encounterId > b.encounterId ? 1 : 0;
const byLevel = (a: QueueItem, b: QueueItem) =>
  (a.finalLevel ?? 6) - (b.finalLevel ?? 6);
const byWaitDesc = (a: QueueItem, b: QueueItem) =>
  (b.waitMinutes ?? 0) - (a.waitMinutes ?? 0);
const byArrival = (a: QueueItem, b: QueueItem) =>
  Date.parse(a.arrivalAt) - Date.parse(b.arrivalAt);

/**
 * Las tres secciones de la cola (R1, R8): waitingTriage por mayor espera; triaged por nivel ascendente y mayor espera;
 * inCare por nivel ascendente y llegada ascendente. Empates por id. REGISTERED, CLOSED y CANCELLED no aparecen.
 */
export function buildQueue(rows: QueueRow[], now: Date): Queue {
  const today = bogotaDate(now);
  const items = rows.map((r) => toItem(r, now, today));
  const section = (
    status: EncounterStatus,
    ...order: ((a: QueueItem, b: QueueItem) => number)[]
  ) =>
    items
      .filter((i) => i.status === status)
      .sort((a, b) => {
        for (const cmp of [...order, byId]) {
          const c = cmp(a, b);
          if (c !== 0) return c;
        }
        return 0;
      });
  return {
    serverNow: now.toISOString(),
    waitingTriage: section('WAITING_TRIAGE', byWaitDesc),
    triaged: section('TRIAGED', byLevel, byWaitDesc),
    inCare: section('IN_CARE', byLevel, byArrival),
  };
}
