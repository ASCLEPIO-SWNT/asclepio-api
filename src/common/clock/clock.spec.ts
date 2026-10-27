import { FixedClock } from './clock.js';

describe('Clock', () => {
  it('R24: todayInBogota usa la fecha civil de America/Bogota (UTC-5), no la de UTC', () => {
    // 2026-10-27T03:00Z son las 22:00 del 26 de octubre en Bogotá.
    expect(
      new FixedClock(new Date('2026-10-27T03:00:00Z')).todayInBogota(),
    ).toBe('2026-10-26');
    expect(
      new FixedClock(new Date('2026-10-27T05:00:00Z')).todayInBogota(),
    ).toBe('2026-10-27');
  });

  it('FixedClock devuelve copias y se puede avanzar', () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const t = clock.now();
    t.setFullYear(2000);
    clock.advance(1000);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:01.000Z');
  });
});
