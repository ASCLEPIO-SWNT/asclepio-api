import { FixedClock } from './clock.js';
import { ageInYears, isAdult } from './age.js';

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

  it('R4: el perfil del paciente exige 18 años cumplidos en Bogotá; una fecha futura es menor de edad', () => {
    expect(isAdult('2008-10-27', '2026-10-26')).toBe(false);
    expect(isAdult('2030-01-01', '2026-10-26')).toBe(false);
    expect(isAdult('2008-10-26', '2026-10-26')).toBe(true);
  });
});

describe('ageInYears (edad cumplida en America/Bogota)', () => {
  it('R2: cuenta los años cumplidos a la fecha civil de hoy (F-06: edad de la cola; F-04: age_years)', () => {
    expect(ageInYears('1968-03-15', '2026-11-09')).toBe(58);
    expect(ageInYears('1968-11-09', '2026-11-09')).toBe(58);
    expect(ageInYears('1968-11-10', '2026-11-09')).toBe(57);
    expect(ageInYears('2026-11-09', '2026-11-09')).toBe(0);
  });

  it('R2: quien nació un 29 de febrero cumple el 1 de marzo en años no bisiestos', () => {
    expect(ageInYears('2000-02-29', '2025-02-28')).toBe(24);
    expect(ageInYears('2000-02-29', '2025-03-01')).toBe(25);
    expect(ageInYears('2000-02-29', '2028-02-29')).toBe(28);
  });

  it('R2: con la fecha de Bogotá, no la de UTC (medianoche UTC)', () => {
    const today = new FixedClock(
      new Date('2026-11-10T02:00:00Z'),
    ).todayInBogota();
    expect(ageInYears('1990-11-10', today)).toBe(35);
  });
});
