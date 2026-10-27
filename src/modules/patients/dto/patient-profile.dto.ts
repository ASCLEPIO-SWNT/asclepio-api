import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsCalendarDate } from '../../../common/validation/is-calendar-date.js';
import { FULL_NAME_MAX, SEXES, type Sex } from './patients.dto.js';

/** Campos editables por el paciente mientras su identidad no esté verificada (R2, R4, PA-F02-5). Al menos uno. */
export class UpdatePatientProfileDto {
  @ApiPropertyOptional({ maxLength: FULL_NAME_MAX })
  @ValidateIf((o: UpdatePatientProfileDto) => o.fullName !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(FULL_NAME_MAX)
  fullName?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '1990-05-17',
    description:
      'YYYY-MM-DD; se exigen 18 años cumplidos en America/Bogota (si no: 422).',
  })
  @ValidateIf((o: UpdatePatientProfileDto) => o.birthDate !== undefined)
  @IsCalendarDate()
  birthDate?: string;

  @ApiPropertyOptional({ enum: SEXES })
  @ValidateIf((o: UpdatePatientProfileDto) => o.sex !== undefined)
  @IsIn(SEXES)
  sex?: Sex;
}

export class PatientProfileDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: String, nullable: true }) documentType: string | null;
  @ApiProperty({ type: String, nullable: true }) documentNumber: string | null;
  @ApiProperty({ type: String, nullable: true }) fullName: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true })
  birthDate: string | null;
  @ApiProperty({ enum: SEXES, type: String, nullable: true }) sex: Sex | null;
  @ApiProperty({
    description:
      'true mientras recepción no haya verificado la identidad; después los datos quedan bloqueados.',
  })
  editable: boolean;
}
