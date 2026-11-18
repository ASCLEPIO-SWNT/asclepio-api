import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isCalendarDate } from '../../common/validation/is-calendar-date.js';

/**
 * Periodo de los reportes (F-07-api, R1–R3). Puro: sin Nest más allá de las excepciones HTTP ni base.
 * Las fechas civiles YYYY-MM-DD se interpretan en America/Bogota con desfase fijo −05:00 (Colombia no tiene horario de
 * verano): [from 00:00 −05:00, to+1 00:00 −05:00).
 */
export const MAX_PERIOD_DAYS = 366;
const DAY_MS = 86_400_000;
const BOGOTA_OFFSET = '-05:00';

export interface ReportPeriod {
  from: string;
  to: string;
  /** Primer instante del periodo (incluido). */
  start: Date;
  /** Primer instante posterior al periodo (excluido). */
  end: Date;
}

const INVALID_DETAIL = 'La petición no superó la validación.';
const INVALID_DATE = 'Debe ser una fecha válida con formato YYYY-MM-DD.';

function bogotaMidnight(date: string): number {
  return Date.parse(`${date}T00:00:00${BOGOTA_OFFSET}`);
}

/** Días del periodo, ambos extremos incluidos (from = to → 1). */
export function periodDays(from: string, to: string): number {
  return Math.round((bogotaMidnight(to) - bogotaMidnight(from)) / DAY_MS) + 1;
}

/**
 * Valida y convierte el periodo. 400 si from o to faltan o no son fechas del calendario (R1); 422 si from > to o si el
 * periodo supera 366 días (R2). Los mensajes no repiten los valores enviados (R19).
 */
export function parsePeriod(from: unknown, to: unknown): ReportPeriod {
  const bad = [
    ...(isCalendarDate(from) ? [] : [{ field: 'from', message: INVALID_DATE }]),
    ...(isCalendarDate(to) ? [] : [{ field: 'to', message: INVALID_DATE }]),
  ];
  if (bad.length) {
    throw new BadRequestException({ detail: INVALID_DETAIL, errors: bad });
  }
  const f = from as string;
  const t = to as string;
  if (f > t) {
    throw new UnprocessableEntityException({
      detail: 'El periodo no es válido.',
      errors: [
        { field: 'from', message: 'from debe ser anterior o igual a to.' },
      ],
    });
  }
  if (periodDays(f, t) > MAX_PERIOD_DAYS) {
    throw new UnprocessableEntityException({
      detail: 'El periodo no es válido.',
      errors: [
        {
          field: 'to',
          message: `El periodo no puede superar ${MAX_PERIOD_DAYS} días.`,
        },
      ],
    });
  }
  return {
    from: f,
    to: t,
    start: new Date(bogotaMidnight(f)),
    end: new Date(bogotaMidnight(t) + DAY_MS),
  };
}

/** true si el instante cae en [start, end) (R3). */
export function inPeriod(p: ReportPeriod, instant: Date): boolean {
  const t = instant.getTime();
  return t >= p.start.getTime() && t < p.end.getTime();
}
