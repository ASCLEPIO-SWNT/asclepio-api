import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsTrimmedLength } from '../../../common/validation/trimmed-length.js';
import { PatientDto } from '../../patients/dto/patients.dto.js';
import {
  ENCOUNTER_STATUSES,
  type EncounterStatus,
} from '../encounter-state-machine.js';
import {
  PRE_REGISTRATION_STATUSES,
  type PreRegistrationStatus,
} from '../pre-registration.policy.js';

export const COMPLAINT_SOURCES = ['TYPED', 'VOICE_ON_DEVICE'] as const;
export type ComplaintSource = (typeof COMPLAINT_SOURCES)[number];
export const ENCOUNTER_ORIGINS = ['PRE_REGISTRATION', 'DIRECT'] as const;
export type EncounterOrigin = (typeof ENCOUNTER_ORIGINS)[number];
export const COMPLAINT_MAX = 2000;
export const REASON_MAX = 500;
export const LIST_LIMIT_DEFAULT = 50;
export const LIST_LIMIT_MAX = 100;

// ---------------------------------------------------------------- Peticiones
// Ningún DTO declara horas, tenantId, status ni patientId (en los del paciente): forbidNonWhitelisted → 400 (R46, R47).

export class CreatePreRegistrationDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Sede del tenant (de GET /public/tenants).',
  })
  @IsUUID('all')
  siteId: string;

  @ApiProperty({ minLength: 1, maxLength: COMPLAINT_MAX })
  @IsString()
  @MaxLength(COMPLAINT_MAX)
  @IsTrimmedLength(1, COMPLAINT_MAX)
  chiefComplaintText: string;

  @ApiProperty({ enum: COMPLAINT_SOURCES })
  @IsIn(COMPLAINT_SOURCES)
  complaintSource: ComplaintSource;
}

export class PendingPreRegistrationsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((o: PendingPreRegistrationsQueryDto) => o.siteId !== undefined)
  @IsUUID('all')
  siteId?: string;
}

export class ConfirmPreRegistrationDto {
  // Regla de negocio (422, R19): se valida en el service, no en el DTO.
  @ApiProperty({
    type: Boolean,
    enum: [true],
    description:
      'Recepción verificó la identidad del paciente presente. Si falta o no es true: 422.',
  })
  @Allow()
  identityVerified: unknown;
}

export class ReasonDto {
  @ApiProperty({
    minLength: 1,
    maxLength: REASON_MAX,
    description:
      'De 1 a 500 caracteres sin contar espacios iniciales y finales.',
  })
  @IsTrimmedLength(1, REASON_MAX)
  reason: string;
}

export class RejectPreRegistrationDto extends ReasonDto {}
export class CancelEncounterDto extends ReasonDto {}

export class CreateEncounterDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  patientId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  siteId: string;

  @ApiProperty({ minLength: 1, maxLength: COMPLAINT_MAX })
  @IsString()
  @MaxLength(COMPLAINT_MAX)
  @IsTrimmedLength(1, COMPLAINT_MAX)
  chiefComplaintText: string;

  @ApiProperty({ enum: COMPLAINT_SOURCES })
  @IsIn(COMPLAINT_SOURCES)
  complaintSource: ComplaintSource;
}

export class ListEncountersQueryDto {
  @ApiPropertyOptional({ enum: ENCOUNTER_STATUSES })
  @ValidateIf((o: ListEncountersQueryDto) => o.status !== undefined)
  @IsIn(ENCOUNTER_STATUSES)
  status?: EncounterStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((o: ListEncountersQueryDto) => o.siteId !== undefined)
  @IsUUID('all')
  siteId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((o: ListEncountersQueryDto) => o.patientId !== undefined)
  @IsUUID('all')
  patientId?: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: LIST_LIMIT_MAX,
    default: LIST_LIMIT_DEFAULT,
  })
  @ValidateIf((o: ListEncountersQueryDto) => o.limit !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIST_LIMIT_MAX)
  limit?: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 0, default: 0 })
  @ValidateIf((o: ListEncountersQueryDto) => o.offset !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

// ---------------------------------------------------------------- Respuestas

export class EncounterRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ENCOUNTER_STATUSES }) status: EncounterStatus;
}

/** Vista del paciente (R12): sin nivel de triage ni motivo de rechazo. */
export class PatientPreRegistrationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) siteId: string;
  @ApiProperty() siteName: string;
  @ApiProperty({
    enum: PRE_REGISTRATION_STATUSES,
    description: 'Estado efectivo.',
  })
  status: PreRegistrationStatus;
  @ApiProperty({ format: 'date-time' }) preRegisteredAt: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
  @ApiProperty({ type: EncounterRefDto, nullable: true })
  encounter: EncounterRefDto | null;
}

export class PendingPreRegistrationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) siteId: string;
  @ApiProperty() siteName: string;
  @ApiProperty({ format: 'date-time' }) preRegisteredAt: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
  @ApiProperty() chiefComplaintText: string;
  @ApiProperty({ enum: COMPLAINT_SOURCES }) complaintSource: ComplaintSource;
  @ApiProperty({ description: 'identity_verified de la cuenta del paciente.' })
  identityVerified: boolean;
  @ApiProperty({ type: PatientDto }) patient: PatientDto;
}

export class RejectedPreRegistrationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['REJECTED'] }) status: 'REJECTED';
  @ApiProperty({ format: 'date-time' }) resolvedAt: string;
}

export class StaffRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: String, nullable: true }) fullName: string | null;
}

export class EventActorDto {
  @ApiProperty({ enum: ['STAFF', 'PATIENT', 'SYSTEM'] })
  type: 'STAFF' | 'PATIENT' | 'SYSTEM';
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) id:
    string | null;
  @ApiProperty({ type: String, nullable: true }) fullName: string | null;
}

export class EncounterEventDto {
  @ApiProperty({ description: 'bigint serializado como texto.' }) id: string;
  @ApiProperty({ enum: ['ENCOUNTER_CREATED', 'STATUS_CHANGED'] }) type: string;
  @ApiProperty({ enum: ENCOUNTER_STATUSES, type: String, nullable: true })
  fromStatus: EncounterStatus | null;
  @ApiProperty({ enum: ENCOUNTER_STATUSES, type: String, nullable: true })
  toStatus: EncounterStatus | null;
  @ApiProperty({ type: 'object', additionalProperties: true })
  payload: Record<string, unknown>;
  @ApiProperty({ type: EventActorDto }) actor: EventActorDto;
  @ApiProperty({ format: 'date-time' }) occurredAt: string;
}

export class EncounterSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) siteId: string;
  @ApiProperty() siteName: string;
  @ApiProperty({ enum: ENCOUNTER_STATUSES }) status: EncounterStatus;
  @ApiProperty({ enum: ENCOUNTER_ORIGINS }) origin: EncounterOrigin;
  @ApiProperty({
    format: 'date-time',
    description: 'Hora legal de llegada (servidor).',
  })
  arrivalAt: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  preRegistrationId: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  preRegisteredAt: string | null;
  @ApiProperty() chiefComplaintText: string;
  @ApiProperty({ enum: COMPLAINT_SOURCES }) complaintSource: ComplaintSource;
  @ApiProperty({ type: String, nullable: true }) cancellationReason:
    string | null;
  @ApiProperty({ type: StaffRefDto }) registeredBy: StaffRefDto;
  @ApiProperty({ type: PatientDto }) patient: PatientDto;
}

export class EncounterDto extends EncounterSummaryDto {
  @ApiProperty({ type: [EncounterEventDto] }) events: EncounterEventDto[];
}

export class EncounterListDto {
  @ApiProperty({ type: [EncounterSummaryDto] }) items: EncounterSummaryDto[];
}
