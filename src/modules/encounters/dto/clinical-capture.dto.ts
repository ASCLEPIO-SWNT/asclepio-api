import { applyDecorators } from '@nestjs/common';
import { ApiProperty, type ApiPropertyOptions } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsTrimmedLength } from '../../../common/validation/trimmed-length.js';
import {
  ENCOUNTER_STATUSES,
  type EncounterStatus,
} from '../encounter-state-machine.js';
import {
  FINDING_DESCRIPTION_MAX,
  FINDINGS_MAX,
  FINDINGS_MIN,
  SYMPTOM_FINDING_KINDS,
  type SymptomFindingKind,
} from '../symptom-findings.rules.js';
import {
  CONSCIOUSNESS_LEVELS,
  type ConsciousnessLevel,
  rangeText,
  VITAL_SIGN_DEFINITIONS,
  type VitalSignField,
} from '../vital-signs.rules.js';
import {
  COMPLAINT_SOURCES,
  type ComplaintSource,
  StaffRefDto,
} from './encounters.dto.js';

const PROVISIONAL =
  'PROVISIONAL — no validado clínicamente, revisar con asesor clínico.';

/**
 * Esquema OpenAPI de un signo leído de VITAL_SIGN_DEFINITIONS (unidad, mínimo, máximo y obligatoriedad), para que
 * F-03-web genere su validación sin repetir números (D3).
 */
function vitalSignSchema(
  field: VitalSignField,
  response: boolean,
): ApiPropertyOptions {
  const d = VITAL_SIGN_DEFINITIONS.find((x) => x.field === field)!;
  const parts = [d.label + (d.unit ? ` (${d.unit})` : '') + '.'];
  if (d.type === 'integer') parts.push('Entero.');
  if (d.type === 'decimal1') parts.push('Número con como máximo un decimal.');
  if (d.min !== undefined) {
    parts.push(
      `Rango admitido ${rangeText(d)} (fuera de rango → 422 y la toma entera se rechaza).`,
    );
  }
  parts.push(
    d.required
      ? 'Obligatorio en cada toma (si falta → 422).'
      : 'Opcional en cada toma.',
  );
  parts.push(PROVISIONAL);
  const base: ApiPropertyOptions = {
    description: parts.join(' '),
    required: response || d.required,
    ...(response && !d.required ? { nullable: true } : {}),
  };
  switch (d.type) {
    case 'boolean':
      return { ...base, type: Boolean };
    case 'enum':
      return {
        ...base,
        enum: CONSCIOUSNESS_LEVELS,
        enumName: 'ConsciousnessLevel',
      };
    default:
      return {
        ...base,
        type: d.type === 'integer' ? 'integer' : 'number',
        minimum: d.min,
        maximum: d.max,
      };
  }
}

const present = (field: VitalSignField) =>
  ValidateIf(
    (o: Record<string, unknown>) => o[field] !== undefined && o[field] !== null,
  );

/**
 * Validación de forma de un signo (R3, 400). Los obligatorios se declaran opcionales para class-validator: su ausencia
 * (o null) la responde validateVitalSigns con 422 (R4). Los rangos no se validan aquí: son 422 (R5).
 */
function VitalSignInput(field: VitalSignField): PropertyDecorator {
  const d = VITAL_SIGN_DEFINITIONS.find((x) => x.field === field)!;
  const shape = {
    integer: IsInt({ message: '$property debe ser un número entero.' }),
    decimal1: IsNumber(
      { maxDecimalPlaces: 1, allowNaN: false, allowInfinity: false },
      { message: '$property debe ser un número con como máximo un decimal.' },
    ),
    boolean: IsBoolean({ message: '$property debe ser true o false.' }),
    enum: IsIn(d.values ?? [], {
      message: `$property debe ser uno de: ${(d.values ?? []).join(', ')}.`,
    }),
  }[d.type];
  return applyDecorators(
    ApiProperty(vitalSignSchema(field, false)),
    present(field),
    shape,
  );
}

const VitalSignOutput = (field: VitalSignField) =>
  ApiProperty(vitalSignSchema(field, true));

// ---------------------------------------------------------------- Peticiones
// Ningún DTO declara horas, responsables, tenantId, encounterId ni id: forbidNonWhitelisted → 400 (R13).

/** Toma de signos vitales (PA-F03-1, tabla D3). */
export class CreateVitalSignsDto {
  @VitalSignInput('respiratoryRate') respiratoryRate?: number | null;
  @VitalSignInput('oxygenSaturation') oxygenSaturation?: number | null;
  @VitalSignInput('supplementalOxygen') supplementalOxygen?: boolean | null;
  @VitalSignInput('systolicBp') systolicBp?: number | null;
  @VitalSignInput('heartRate') heartRate?: number | null;
  @VitalSignInput('consciousness') consciousness?: ConsciousnessLevel | null;
  @VitalSignInput('temperatureC') temperatureC?: number | null;
  @VitalSignInput('diastolicBp') diastolicBp?: number | null;
  @VitalSignInput('glucoseMgDl') glucoseMgDl?: number | null;
}

export class SymptomFindingInputDto {
  @ApiProperty({
    enum: SYMPTOM_FINDING_KINDS,
    enumName: 'SymptomFindingKind',
    description:
      'SYMPTOM = lo que refiere el paciente; FINDING = lo que observa enfermería; COMPLAINT_NOTE = precisión del motivo de consulta (el motivo original no se modifica).',
  })
  @IsIn(SYMPTOM_FINDING_KINDS, {
    message: `$property debe ser uno de: ${SYMPTOM_FINDING_KINDS.join(', ')}.`,
  })
  kind: SymptomFindingKind;

  @ApiProperty({
    minLength: 1,
    maxLength: FINDING_DESCRIPTION_MAX,
    description: `Texto libre de 1 a ${FINDING_DESCRIPTION_MAX} caracteres sin contar espacios iniciales y finales (se guarda sin ellos).`,
  })
  @IsString({ message: '$property debe ser texto.' })
  @IsTrimmedLength(1, FINDING_DESCRIPTION_MAX)
  description: string;
}

export class CreateSymptomFindingsDto {
  @ApiProperty({
    type: [SymptomFindingInputDto],
    minItems: FINDINGS_MIN,
    maxItems: FINDINGS_MAX,
  })
  @IsArray({ message: '$property debe ser una lista.' })
  @ArrayMinSize(FINDINGS_MIN, {
    message: `$property debe tener al menos ${FINDINGS_MIN} elemento.`,
  })
  @ArrayMaxSize(FINDINGS_MAX, {
    message: `$property admite como máximo ${FINDINGS_MAX} elementos.`,
  })
  @IsObject({ each: true, message: 'Cada elemento debe ser un objeto.' })
  @ValidateNested({ each: true })
  @Type(() => SymptomFindingInputDto)
  items: SymptomFindingInputDto[];
}

// ---------------------------------------------------------------- Respuestas

export class VitalSignsDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) encounterId: string;
  @VitalSignOutput('respiratoryRate') respiratoryRate: number;
  @VitalSignOutput('oxygenSaturation') oxygenSaturation: number;
  @VitalSignOutput('supplementalOxygen') supplementalOxygen: boolean;
  @VitalSignOutput('systolicBp') systolicBp: number;
  @VitalSignOutput('heartRate') heartRate: number;
  @VitalSignOutput('consciousness') consciousness: ConsciousnessLevel;
  @VitalSignOutput('temperatureC') temperatureC: number;
  @VitalSignOutput('diastolicBp') diastolicBp: number | null;
  @VitalSignOutput('glucoseMgDl') glucoseMgDl: number | null;
  @ApiProperty({
    format: 'date-time',
    description: 'Hora del servidor de la toma.',
  })
  recordedAt: string;
  @ApiProperty({ type: StaffRefDto }) recordedBy: StaffRefDto;
}

export class SymptomFindingDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) encounterId: string;
  @ApiProperty({ enum: SYMPTOM_FINDING_KINDS, enumName: 'SymptomFindingKind' })
  kind: SymptomFindingKind;
  @ApiProperty() description: string;
  @ApiProperty({
    format: 'date-time',
    description: 'Hora del servidor de la captura.',
  })
  recordedAt: string;
  @ApiProperty({ type: StaffRefDto }) recordedBy: StaffRefDto;
}

export class SymptomFindingListDto {
  @ApiProperty({ type: [SymptomFindingDto] }) items: SymptomFindingDto[];
}

export class ClinicalCaptureDto {
  @ApiProperty({ format: 'uuid' }) encounterId: string;
  @ApiProperty({ enum: ENCOUNTER_STATUSES }) status: EncounterStatus;
  @ApiProperty({ description: 'Motivo de consulta original (no se edita).' })
  chiefComplaintText: string;
  @ApiProperty({ enum: COMPLAINT_SOURCES }) complaintSource: ComplaintSource;
  @ApiProperty({
    type: [VitalSignsDto],
    description: 'Todas las tomas, por recordedAt e id ascendentes.',
  })
  vitalSigns: VitalSignsDto[];
  @ApiProperty({
    type: [SymptomFindingDto],
    description: 'Todos los hallazgos, por recordedAt e id ascendentes.',
  })
  symptomFindings: SymptomFindingDto[];
}
