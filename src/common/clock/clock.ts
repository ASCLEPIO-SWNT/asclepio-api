import { Injectable } from '@nestjs/common';

const BOGOTA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Fecha civil YYYY-MM-DD de un instante en America/Bogota (D18). */
export function bogotaDate(instant: Date): string {
  return BOGOTA_DATE.format(instant);
}

/**
 * Reloj del servidor (RNF-10). Toda hora legal (consent_at, locked_until, iat/exp…) sale de aquí, nunca del cliente.
 * Se inyecta por la clase abstracta; en pruebas se sustituye por FixedClock.
 */
export abstract class Clock {
  abstract now(): Date;

  /** Fecha actual en Bogotá (YYYY-MM-DD). */
  todayInBogota(): string {
    return bogotaDate(this.now());
  }
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

/** Reloj fijo y avanzable para pruebas. */
export class FixedClock extends Clock {
  constructor(private current: Date) {
    super();
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(instant: Date): void {
    this.current = new Date(instant.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
