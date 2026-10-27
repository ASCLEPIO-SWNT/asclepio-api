export const ADULT_AGE = 18;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

/**
 * true si en la fecha civil `today` (YYYY-MM-DD, en America/Bogota) ya se cumplieron 18 años desde `birthDate`
 * (D18). Se compara año, mes y día; quien nació un 29 de febrero cumple el 1 de marzo en años no bisiestos.
 */
export function isAdult(birthDate: string, today: string): boolean {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const y = by + ADULT_AGE;
  let m = bm;
  let d = bd;
  if (m === 2 && d === 29 && !isLeap(y)) {
    m = 3;
    d = 1;
  }
  const adultOn = `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
  return today >= adultOn;
}
