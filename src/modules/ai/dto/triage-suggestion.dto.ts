import { ApiProperty } from '@nestjs/swagger';
import { StaffRefDto } from '../../encounters/dto/encounters.dto.js';

export const TRIAGE_SUGGESTION_STATUSES = [
  'OK',
  'INVALID_OUTPUT',
  'TIMEOUT',
  'FAILED',
] as const;
export const LLM_PROVIDERS = ['GROQ', 'OPENROUTER'] as const;

/** Cuerpo del POST: ninguno o {} (R5). Cualquier campo → 400 por el ValidationPipe global (forbidNonWhitelisted). */
export class RequestTriageSuggestionDto {}

export class TriageFactorDto {
  @ApiProperty({
    description:
      'Campo de la entrada que sustenta la sugerencia: age_years, sex, chief_complaint_text, complaint_source, vital_signs.<campo> o symptom_findings[<n>].',
  })
  field: string;
  @ApiProperty({ description: 'Por qué importa ese dato (máx. 200).' })
  note: string;
}

export class GuardTriggerDto {
  @ApiProperty({ type: 'integer', description: 'Puntuación NEWS2 total.' })
  news2Total: number;
  @ApiProperty({
    required: false,
    description:
      'Parámetro que disparó la regla (G3), p. ej. vital_signs.heart_rate.',
  })
  field?: string;
  @ApiProperty({ type: 'integer', required: false })
  points?: number;
}

export class GuardReasonDto {
  @ApiProperty({ description: 'Regla (G1, G2 o G3). PROVISIONAL.' })
  rule: string;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5 })
  maxLevel: number;
  @ApiProperty({ type: GuardTriggerDto }) trigger: GuardTriggerDto;
}

/**
 * Sugerencia de triage (R22): una PROPUESTA, nunca una decisión. Sin input_snapshot, raw_response ni attempts.
 */
export class TriageSuggestionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) encounterId: string;
  @ApiProperty({
    enum: TRIAGE_SUGGESTION_STATUSES,
    enumName: 'TriageSuggestionStatus',
    description:
      'OK: hay nivel sugerido. INVALID_OUTPUT, TIMEOUT o FAILED: no hay nivel y la web ofrece el triage manual.',
  })
  status: (typeof TRIAGE_SUGGESTION_STATUSES)[number];
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 5,
    nullable: true,
    description:
      'Nivel sugerido (1 = I, el más grave) tras los SafetyGuards; puede ser más grave que llmLevel. null si status ≠ OK.',
  })
  suggestedLevel: number | null;
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 5,
    nullable: true,
    description: 'Nivel que propuso el LLM. null si status ≠ OK.',
  })
  llmLevel: number | null;
  @ApiProperty({ type: String, nullable: true })
  explanation: string | null;
  @ApiProperty({ type: [TriageFactorDto], nullable: true })
  factors: TriageFactorDto[] | null;
  @ApiProperty({
    description:
      'true si un SafetyGuard subió la gravedad respecto a llmLevel.',
  })
  guardApplied: boolean;
  @ApiProperty({ type: [GuardReasonDto] }) guardReasons: GuardReasonDto[];
  @ApiProperty({ enum: LLM_PROVIDERS, enumName: 'LlmProvider', nullable: true })
  provider: (typeof LLM_PROVIDERS)[number] | null;
  @ApiProperty({ type: String, nullable: true }) model: string | null;
  @ApiProperty({ example: 'triage-v1' }) promptVersion: string;
  @ApiProperty({ type: 'integer', minimum: 0 }) latencyMs: number;
  @ApiProperty({ format: 'date-time', description: 'Hora del servidor.' })
  createdAt: string;
  @ApiProperty({ type: StaffRefDto }) requestedBy: StaffRefDto;
}

export class TriageSuggestionListDto {
  @ApiProperty({
    type: [TriageSuggestionDto],
    description: 'De la más reciente a la más antigua: items[0] es la vigente.',
  })
  items: TriageSuggestionDto[];
}
