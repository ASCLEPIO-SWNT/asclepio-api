import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { IsCalendarDate } from '../../../common/validation/is-calendar-date.js';

/** Tipos de documento que registra recepción: incluye TI y RC (menores, PA-F02-1). */
export const DOCUMENT_TYPES = ['CC', 'TI', 'CE', 'PA', 'RC'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const SEXES = ['M', 'F', 'X'] as const;
export type Sex = (typeof SEXES)[number];
export const FULL_NAME_MAX = 200;
export const DOCUMENT_NUMBER_MAX = 64;
export const ESTIMATED_AGE_MAX = 120;

const present = (v: unknown) => v !== undefined;

/** Con documento = llega el tipo o el número (deben llegar los dos). */
function hasDocument(o: CreatePatientDto): boolean {
  return present(o.documentType) || present(o.documentNumber);
}

// ---------------------------------------------------------------- Peticiones

export class SearchPatientsQueryDto {
  @ApiProperty({ enum: DOCUMENT_TYPES })
  @IsIn(DOCUMENT_TYPES)
  documentType: DocumentType;

  @ApiProperty({ maxLength: DOCUMENT_NUMBER_MAX })
  @IsString()
  @IsNotEmpty()
  @MaxLength(DOCUMENT_NUMBER_MAX)
  documentNumber: string;
}

/**
 * Alta por recepción (R26, R27, R29, PA-F02-1). Con documento: tipo, número, nombre, fecha de nacimiento y sexo.
 * NN (sin tipo ni número): sexo y exactamente uno de fecha de nacimiento o edad estimada; nombre opcional.
 */
export class CreatePatientDto {
  @ApiPropertyOptional({
    enum: DOCUMENT_TYPES,
    description:
      'Obligatorio junto con documentNumber; ninguno de los dos en un NN.',
  })
  @ValidateIf((o: CreatePatientDto) => hasDocument(o))
  @IsIn(DOCUMENT_TYPES)
  documentType?: DocumentType;

  @ApiPropertyOptional({ maxLength: DOCUMENT_NUMBER_MAX })
  @ValidateIf((o: CreatePatientDto) => hasDocument(o))
  @IsString()
  @IsNotEmpty()
  @MaxLength(DOCUMENT_NUMBER_MAX)
  documentNumber?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: FULL_NAME_MAX,
    description: 'Obligatorio con documento; opcional (o null) en un NN.',
  })
  @ValidateIf(
    (o: CreatePatientDto) =>
      hasDocument(o) || (o.fullName !== undefined && o.fullName !== null),
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(FULL_NAME_MAX)
  fullName?: string | null;

  @ApiPropertyOptional({
    format: 'date',
    example: '1990-05-17',
    description:
      'YYYY-MM-DD. Obligatoria con documento; en un NN, exactamente una de birthDate o estimatedAgeYears. Posterior a hoy en Bogotá → 422.',
  })
  @ValidateIf(
    (o: CreatePatientDto) =>
      hasDocument(o) || present(o.birthDate) || !present(o.estimatedAgeYears),
  )
  @IsCalendarDate()
  birthDate?: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: ESTIMATED_AGE_MAX,
    description: 'Solo en un NN sin birthDate.',
  })
  @ValidateIf((o: CreatePatientDto) => present(o.estimatedAgeYears))
  @IsInt()
  @Min(0)
  @Max(ESTIMATED_AGE_MAX)
  @ValidateBy({
    name: 'onlyForNnWithoutBirthDate',
    validator: {
      validate: (_v, args) => {
        const o = args?.object as CreatePatientDto;
        return !hasDocument(o) && !present(o.birthDate);
      },
      defaultMessage: () =>
        'estimatedAgeYears solo se admite en un paciente NN sin birthDate',
    },
  })
  estimatedAgeYears?: number;

  @ApiProperty({ enum: SEXES })
  @IsIn(SEXES)
  sex: Sex;
}

// ---------------------------------------------------------------- Respuestas

export class PatientDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: DOCUMENT_TYPES, nullable: true, type: String })
  documentType: string | null;
  @ApiProperty({ nullable: true, type: String }) documentNumber: string | null;
  @ApiProperty({ nullable: true, type: String }) fullName: string | null;
  @ApiProperty({ format: 'date', nullable: true, type: String })
  birthDate: string | null;
  @ApiProperty({ type: 'integer', nullable: true })
  estimatedAgeYears: number | null;
  @ApiProperty({ enum: SEXES, nullable: true, type: String })
  sex: Sex | null;
  @ApiProperty({ description: 'true si es un paciente NN (sin documento).' })
  isNN: boolean;
}
