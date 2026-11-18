import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, ValidateIf } from 'class-validator';
import { IsCalendarDate } from '../../../common/validation/is-calendar-date.js';

/**
 * Parámetros de los dos reportes (F-07-api, R1): from y to obligatorios (YYYY-MM-DD, America/Bogota) y siteId
 * opcional. Cualquier otro parámetro → 400 por forbidNonWhitelisted.
 */
export class ReportQueryDto {
  @ApiProperty({
    format: 'date',
    example: '2026-11-01',
    description:
      'Primer día del periodo (incluido), en hora de Bogotá: desde las 00:00 −05:00.',
  })
  @IsCalendarDate()
  from: string;

  @ApiProperty({
    format: 'date',
    example: '2026-11-10',
    description:
      'Último día del periodo (incluido), en hora de Bogotá: hasta las 00:00 −05:00 del día siguiente (excluido). Máximo 366 días contando ambos extremos; from > to o un periodo mayor → 422.',
  })
  @IsCalendarDate()
  to: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Limita la población a una sede del tenant. Una sede inexistente o de otra IPS da una población vacía.',
  })
  @ValidateIf((o: ReportQueryDto) => o.siteId !== undefined)
  @IsUUID('all')
  siteId?: string;
}

const PERCENT = {
  type: Number,
  nullable: true,
  description: 'Porcentaje con 1 decimal; null si el denominador es 0.',
} as const;
const MINUTES = (what: string) =>
  ({
    type: Number,
    nullable: true,
    description: `${what} en minutos, con 1 decimal; null si n = 0.`,
  }) as const;

export class ReportPeriodDto {
  @ApiProperty({ format: 'date' }) from: string;
  @ApiProperty({ format: 'date' }) to: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  siteId: string | null;
}

export class ReportPopulationDto {
  @ApiProperty({
    type: 'integer',
    description:
      'Atenciones del tenant (y de la sede) con arrival_at en el periodo, en cualquier estado.',
  })
  encounters: number;
  @ApiProperty({
    type: 'integer',
    description: 'Atenciones de la población con triaged_at (con decisión).',
  })
  triaged: number;
}

export class TimeStatsDto {
  @ApiProperty({ type: 'integer' }) n: number;
  @ApiProperty(MINUTES('Mediana'))
  median: number | null;
  @ApiProperty(
    MINUTES('Percentil 90 (rango más cercano, posición ceil(0,9·n))'),
  )
  p90: number | null;
}

export class LevelTimeStatsDto extends TimeStatsDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5 }) level: number;
}

export class TimeToTriageDto {
  @ApiProperty({
    type: [LevelTimeStatsDto],
    description:
      'Minutos desde la llegada (arrival_at) hasta el triage (triaged_at), por nivel final 1–5.',
  })
  byLevel: LevelTimeStatsDto[];
  @ApiProperty({ type: TimeStatsDto }) total: TimeStatsDto;
}

export class CareTimeStatsDto extends LevelTimeStatsDto {
  @ApiProperty(MINUTES('Media')) mean: number | null;
}

export class TimeToCareDto {
  @ApiProperty({
    type: [CareTimeStatsDto],
    description:
      'Minutos desde la clasificación (triaged_at) hasta el inicio de la atención médica (IN_CARE), para los niveles 1 y 2: indicador "Tiempo de espera Triage II" de la Res. 256 de 2016. Solo las atenciones que llegaron a IN_CARE.',
  })
  byLevel: CareTimeStatsDto[];
}

export class ComplianceDto {
  @ApiProperty({ type: 'integer', enum: [2] }) level: number;
  @ApiProperty({
    type: 'integer',
    description:
      'Tiempo máximo del nivel II (Res. 5596 de 2015), la misma definición que usa la cola.',
  })
  maxMinutes: number;
  @ApiProperty({
    type: 'integer',
    description: 'Atenciones de nivel II que llegaron a IN_CARE.',
  })
  evaluable: number;
  @ApiProperty({
    type: 'integer',
    description:
      'Evaluables con minutos de triage a atención ≤ maxMinutes (desde la clasificación, Res. 256 de 2016).',
  })
  compliant: number;
  @ApiProperty(PERCENT) percent: number | null;
  @ApiProperty({
    type: 'integer',
    description: 'Atenciones de nivel II triadas que no llegaron a IN_CARE.',
  })
  notEvaluated: number;
}

export class ConcordanceDto {
  @ApiProperty({
    type: 'integer',
    description:
      'Pares (nivel sugerido de la sugerencia decidida, nivel final) de las decisiones VALIDATE y CORRECT.',
  })
  pairs: number;
  @ApiProperty(PERCENT) exactAgreementPercent: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Kappa de Cohen ponderado cuadrático (5 niveles), con 3 decimales; null con menos de 2 pares o si el acuerdo esperado es 1.',
  })
  weightedKappa: number | null;
  @ApiProperty({
    ...PERCENT,
    description:
      'Subclasificación: % de pares con nivel sugerido > nivel final (la IA sugirió un nivel menos grave).',
  })
  underTriagePercent: number | null;
  @ApiProperty({
    ...PERCENT,
    description:
      'Sobreclasificación: % de pares con nivel sugerido < nivel final.',
  })
  overTriagePercent: number | null;
  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'integer' } },
    description: 'Matriz 5×5 de conteos: matrix[sugerido − 1][final − 1].',
  })
  matrix: number[][];
}

export class CountPercentDto {
  @ApiProperty({ type: 'integer' }) count: number;
  @ApiProperty(PERCENT) percent: number | null;
}

export class DecisionUsageDto {
  @ApiProperty({
    type: 'integer',
    description: 'Atenciones triadas de la población.',
  })
  total: number;
  @ApiProperty({ type: CountPercentDto }) VALIDATE: CountPercentDto;
  @ApiProperty({ type: CountPercentDto }) CORRECT: CountPercentDto;
  @ApiProperty({ type: CountPercentDto }) MANUAL: CountPercentDto;
}

export class SuggestionUsageDto {
  @ApiProperty({
    type: 'integer',
    description:
      'Todas las sugerencias de la población (cada solicitud a la IA).',
  })
  total: number;
  @ApiProperty({ type: CountPercentDto }) OK: CountPercentDto;
  @ApiProperty({ type: CountPercentDto }) INVALID_OUTPUT: CountPercentDto;
  @ApiProperty({ type: CountPercentDto }) TIMEOUT: CountPercentDto;
  @ApiProperty({ type: CountPercentDto }) FAILED: CountPercentDto;
}

export class ProviderUsageDto {
  @ApiProperty({ type: 'integer', description: 'Sugerencias OK.' })
  total: number;
  @ApiProperty({ type: CountPercentDto }) GROQ: CountPercentDto;
  @ApiProperty({
    type: CountPercentDto,
    description: 'Uso del proveedor de respaldo.',
  })
  OPENROUTER: CountPercentDto;
}

export class GuardUsageDto {
  @ApiProperty({ type: 'integer', description: 'Sugerencias OK.' })
  total: number;
  @ApiProperty({
    type: 'integer',
    description: 'Sugerencias OK en las que un safety guard subió el nivel.',
  })
  applied: number;
  @ApiProperty(PERCENT) percent: number | null;
}

export class FallbackDto {
  @ApiProperty({ type: DecisionUsageDto }) decisions: DecisionUsageDto;
  @ApiProperty({ type: SuggestionUsageDto }) suggestions: SuggestionUsageDto;
  @ApiProperty({ type: ProviderUsageDto }) providers: ProviderUsageDto;
  @ApiProperty({ type: GuardUsageDto }) guards: GuardUsageDto;
}

export class ReportSummaryDto {
  @ApiProperty({ type: ReportPeriodDto }) period: ReportPeriodDto;
  @ApiProperty({
    format: 'date-time',
    description:
      'Hora del servidor con la que se generó el resumen (una sola lectura del reloj).',
  })
  generatedAt: string;
  @ApiProperty({ type: ReportPopulationDto }) population: ReportPopulationDto;
  @ApiProperty({ type: TimeToTriageDto }) timeToTriage: TimeToTriageDto;
  @ApiProperty({ type: TimeToCareDto }) timeToCare: TimeToCareDto;
  @ApiProperty({ type: ComplianceDto }) compliance: ComplianceDto;
  @ApiProperty({ type: ConcordanceDto }) concordance: ConcordanceDto;
  @ApiProperty({ type: FallbackDto }) fallback: FallbackDto;
}
