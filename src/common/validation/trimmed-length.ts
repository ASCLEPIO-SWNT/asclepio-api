import { ValidateBy, type ValidationOptions } from 'class-validator';

/**
 * Texto de min a max caracteres sin contar espacios iniciales y finales (no admite solo espacios).
 * Los mensajes no repiten el valor enviado (R49).
 */
export function IsTrimmedLength(
  min: number,
  max: number,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isTrimmedLength',
      constraints: [min, max],
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          value.trim().length >= min &&
          value.trim().length <= max,
        defaultMessage: () =>
          `$property debe tener entre ${min} y ${max} caracteres sin contar los espacios iniciales y finales`,
      },
    },
    options,
  );
}
