import { FixedClock } from '../../common/clock/clock.js';
import { isAdult } from './age.js';

describe('isAdult (mayoría de edad en America/Bogota)', () => {
  it('R24: es mayor quien cumple 18 hoy y menor quien los cumple mañana', () => {
    expect(isAdult('2008-10-26', '2026-10-26')).toBe(true);
    expect(isAdult('2008-10-27', '2026-10-26')).toBe(false);
    expect(isAdult('1980-01-01', '2026-10-26')).toBe(true);
  });

  it('R24: quien nació un 29 de febrero cumple el 1 de marzo en años no bisiestos', () => {
    expect(isAdult('2008-02-29', '2026-02-28')).toBe(false);
    expect(isAdult('2008-02-29', '2026-03-01')).toBe(true);
    // Año bisiesto: cumple el propio 29 de febrero.
    expect(isAdult('2010-02-29', '2028-02-29')).toBe(true);
    expect(isAdult('2010-02-28', '2028-02-27')).toBe(false);
  });

  it('R24: una fecha de nacimiento futura nunca es mayor de edad', () => {
    expect(isAdult('2027-01-01', '2026-10-26')).toBe(false);
  });

  it('R24: compara con la fecha de Bogotá, no con la de UTC (medianoche UTC)', () => {
    // 2026-10-27T02:00Z: en UTC ya es 27, en Bogotá todavía es 26.
    const today = new FixedClock(
      new Date('2026-10-27T02:00:00Z'),
    ).todayInBogota();
    expect(isAdult('2008-10-27', today)).toBe(false);
    expect(isAdult('2008-10-26', today)).toBe(true);
  });
});
