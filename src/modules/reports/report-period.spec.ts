import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  inPeriod,
  MAX_PERIOD_DAYS,
  parsePeriod,
  periodDays,
} from './report-period.js';

/** Cuerpo del error (problem+json lo construye el filtro global a partir de detail y errors). */
function errorOf(fn: () => unknown): {
  status: number;
  fields: string[];
  body: string;
} {
  try {
    fn();
  } catch (e) {
    const ex = e as BadRequestException;
    const body = ex.getResponse() as {
      errors: { field: string; message: string }[];
    };
    return {
      status: ex.getStatus(),
      fields: body.errors.map((x) => x.field),
      body: JSON.stringify(body),
    };
  }
  throw new Error('no lanzó');
}

describe('report-period (F-07-api)', () => {
  it('R1: un from o un to ausente, mal formado o imposible → 400 con el campo en errors[] y sin repetir el valor', () => {
    const cases: [unknown, unknown, string][] = [
      [undefined, '2026-11-10', 'from'],
      ['2026-11-01', undefined, 'to'],
      ['2026-11-1', '2026-11-10', 'from'],
      ['10/11/2026', '2026-11-10', 'from'],
      ['2026-11-01', '2026-02-30', 'to'],
      ['2026-13-01', '2026-11-10', 'from'],
      ['2026-11-01', '2026-11-10T00:00:00Z', 'to'],
      [['2026-11-01', '2026-11-02'], '2026-11-10', 'from'],
    ];
    for (const [from, to, field] of cases) {
      const err = errorOf(() => parsePeriod(from, to));
      expect([from, to, err.status, err.fields]).toEqual([
        from,
        to,
        400,
        [field],
      ]);
      expect(err.body).not.toContain('2026-02-30');
      expect(err.body).not.toContain('10/11/2026');
    }
    expect(() => parsePeriod('2026-11-01', '2026-11-10')).not.toThrow(
      BadRequestException,
    );
  });

  it('R2: from posterior a to → 422 (campo from); 366 días es válido y 367 → 422 (campo to)', () => {
    const after = errorOf(() => parsePeriod('2026-11-11', '2026-11-10'));
    expect(after).toMatchObject({ status: 422, fields: ['from'] });
    expect(after.body).not.toContain('2026-11-11');

    expect(MAX_PERIOD_DAYS).toBe(366);
    // 2024 es bisiesto: del 2024-01-01 al 2024-12-31 hay 366 días (ambos inclusive).
    expect(periodDays('2024-01-01', '2024-12-31')).toBe(366);
    expect(() => parsePeriod('2024-01-01', '2024-12-31')).not.toThrow();
    expect(periodDays('2025-01-01', '2026-01-01')).toBe(366);
    expect(() => parsePeriod('2025-01-01', '2026-01-01')).not.toThrow();

    expect(periodDays('2025-01-01', '2026-01-02')).toBe(367);
    const tooLong = errorOf(() => parsePeriod('2025-01-01', '2026-01-02'));
    expect(tooLong).toMatchObject({ status: 422, fields: ['to'] });
    expect(() => parsePeriod('2025-01-01', '2026-01-02')).toThrow(
      UnprocessableEntityException,
    );

    // Un solo día (from = to) es válido.
    expect(periodDays('2026-11-10', '2026-11-10')).toBe(1);
    expect(() => parsePeriod('2026-11-10', '2026-11-10')).not.toThrow();
  });

  it('R3: límites [from 00:00 −05:00, to+1 00:00 −05:00): 23:59:59 de Bogotá del día to dentro y 00:00:00 del día siguiente fuera', () => {
    const p = parsePeriod('2026-11-01', '2026-11-10');
    expect(p.start.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-11-11T05:00:00.000Z');

    // Primer instante del periodo (00:00:00 de Bogotá del día from) dentro; el anterior fuera.
    expect(inPeriod(p, new Date('2026-11-01T00:00:00-05:00'))).toBe(true);
    expect(inPeriod(p, new Date('2026-10-31T23:59:59.999-05:00'))).toBe(false);
    // 23:59:59 de Bogotá del día to (04:59:59 UTC del día siguiente) dentro.
    expect(inPeriod(p, new Date('2026-11-10T23:59:59-05:00'))).toBe(true);
    expect(inPeriod(p, new Date('2026-11-10T23:59:59.999-05:00'))).toBe(true);
    // 00:00:00 de Bogotá del día siguiente fuera.
    expect(inPeriod(p, new Date('2026-11-11T00:00:00-05:00'))).toBe(false);
    // Una llegada a las 20:00 de Bogotá del día to es en UTC del día siguiente: sigue dentro.
    expect(inPeriod(p, new Date('2026-11-11T01:00:00.000Z'))).toBe(true);
  });
});
