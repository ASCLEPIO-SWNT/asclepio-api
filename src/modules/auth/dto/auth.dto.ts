import { ApiProperty } from '@nestjs/swagger';
import {
  Allow,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { STAFF_ROLES, type StaffRole } from '../../../common/auth/principal.js';
import { IsCalendarDate } from './is-calendar-date.js';

/** Tipos de documento admitidos en la cuenta de paciente: TI y RC quedan fuera (menores, PA-5). */
export const PATIENT_DOCUMENT_TYPES = ['CC', 'CE', 'PA'] as const;
export type PatientDocumentType = (typeof PATIENT_DOCUMENT_TYPES)[number];
export const PATIENT_SEXES = ['M', 'F', 'X'] as const;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

// ---------------------------------------------------------------- Peticiones

export class StaffLoginDto {
  @ApiProperty({ format: 'email', example: 'enfermera@ips.example' })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ maxLength: PASSWORD_MAX, format: 'password' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX)
  password: string;
}

export class PatientLoginDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  tenantId: string;

  @ApiProperty({ enum: PATIENT_DOCUMENT_TYPES })
  @IsIn(PATIENT_DOCUMENT_TYPES)
  documentType: PatientDocumentType;

  @ApiProperty({ maxLength: 64 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  documentNumber: string;

  @ApiProperty({ maxLength: PASSWORD_MAX, format: 'password' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX)
  password: string;
}

export class CreatePatientAccountDto {
  @ApiProperty({ format: 'uuid', description: 'IPS (de GET /public/tenants).' })
  @IsUUID('all')
  tenantId: string;

  @ApiProperty({ enum: PATIENT_DOCUMENT_TYPES })
  @IsIn(PATIENT_DOCUMENT_TYPES)
  documentType: PatientDocumentType;

  @ApiProperty({ maxLength: 64 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  documentNumber: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullName: string;

  @ApiProperty({
    format: 'date',
    example: '1990-05-17',
    description:
      'Fecha civil YYYY-MM-DD; se exigen 18 años cumplidos en America/Bogota.',
  })
  @IsCalendarDate()
  birthDate: string;

  @ApiProperty({ enum: PATIENT_SEXES })
  @IsIn(PATIENT_SEXES)
  sex: (typeof PATIENT_SEXES)[number];

  @ApiProperty({
    minLength: PASSWORD_MIN,
    maxLength: PASSWORD_MAX,
    format: 'password',
  })
  @IsString()
  @Length(PASSWORD_MIN, PASSWORD_MAX)
  password: string;

  // Reglas de negocio (422, D11): se validan en el service, no en el DTO.
  @ApiProperty({
    type: Boolean,
    enum: [true],
    description: 'Debe ser true (Ley 1581). Si falta o es otro valor: 422.',
  })
  @Allow()
  consentAccepted: unknown;

  @ApiProperty({
    type: String,
    example: '2026-10-v1',
    description: 'Versión vigente de GET /public/consent. Si no coincide: 422.',
  })
  @Allow()
  consentVersion: unknown;
}

// ---------------------------------------------------------------- Respuestas

export class AccessTokenDto {
  @ApiProperty({ description: 'JWT HS256 de 8 h. No hay refresh token.' })
  accessToken: string;

  @ApiProperty({ enum: ['Bearer'] })
  tokenType: 'Bearer';

  @ApiProperty({ format: 'date-time', example: '2026-10-26T23:00:00.000Z' })
  expiresAt: string;
}

export class PatientAccountCreatedDto {
  @ApiProperty({ format: 'uuid', description: 'Id de la cuenta de paciente.' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  patientId: string;
}

export class StaffMeDto {
  @ApiProperty({ enum: ['STAFF'] }) kind: 'STAFF';
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) tenantId: string;
  @ApiProperty({ format: 'email' }) email: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ enum: STAFF_ROLES }) role: StaffRole;
}

export class PatientMeDto {
  @ApiProperty({ enum: ['PATIENT'] }) kind: 'PATIENT';
  @ApiProperty({ format: 'uuid', description: 'Id de la cuenta de paciente.' })
  id: string;
  @ApiProperty({ format: 'uuid' }) tenantId: string;
  @ApiProperty({ format: 'uuid' }) patientId: string;
  @ApiProperty() consentVersion: string;
  @ApiProperty({
    description: 'false hasta que recepción verifique la identidad (F-02).',
  })
  identityVerified: boolean;
}

export type MeDto = StaffMeDto | PatientMeDto;
