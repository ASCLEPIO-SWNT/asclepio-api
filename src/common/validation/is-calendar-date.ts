import { ValidateBy, type ValidationOptions } from 'class-validator';

/** true si es una fecha civil YYYY-MM-DD que existe en el calendario (rechaza 2026-02-30). */
export function isCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export function IsCalendarDate(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isCalendarDate',
      validator: {
        validate: isCalendarDate,
        defaultMessage: () =>
          '$property debe ser una fecha válida con formato YYYY-MM-DD',
      },
    },
    options,
  );
}
