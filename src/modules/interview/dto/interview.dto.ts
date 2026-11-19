import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsObject,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsTrimmedLength } from '../../../common/validation/trimmed-length.js';
import {
  DIMENSIONS,
  type Dimension,
  INTERVIEW_ENDED_BY,
  INTERVIEW_ENGINES,
  INTERVIEW_LIMITS,
  type InterviewEndedBy,
  type InterviewEngine,
  RED_FLAGS,
  type RedFlag,
} from '../interview.rules.js';

const L = INTERVIEW_LIMITS;

/** Turno de la entrevista (glosario de specs/F-11-api). Los mensajes no repiten el valor enviado (R2). */
export class InterviewTurnDto {
  @ApiProperty({ enum: DIMENSIONS })
  @IsIn(DIMENSIONS)
  dimension: Dimension;

  @ApiProperty({ minLength: 1, maxLength: L.turnQuestionMax })
  @IsString()
  @IsTrimmedLength(1, L.turnQuestionMax)
  question: string;

  @ApiProperty({
    type: String,
    nullable: true,
    minLength: 1,
    maxLength: L.turnAnswerMax,
    description:
      'Respuesta del paciente, no verificada. null = "No sé / prefiero no responder".',
  })
  @ValidateIf((o: InterviewTurnDto) => o.answer !== null)
  @IsString()
  @IsTrimmedLength(1, L.turnAnswerMax)
  answer: string | null;
}

/** Entrevista de síntomas que envía la app con el pre-registro (R1, R2). Son respuestas del paciente, no verificadas. */
export class SymptomInterviewDto {
  @ApiProperty({
    enum: INTERVIEW_ENGINES,
    description:
      'ON_DEVICE: modelo en el teléfono; SERVER: fallback next-question.',
  })
  @IsIn(INTERVIEW_ENGINES)
  engine: InterviewEngine;

  @ApiProperty({ minLength: 1, maxLength: L.modelIdMax })
  @IsString()
  @IsTrimmedLength(1, L.modelIdMax)
  modelId: string;

  @ApiProperty({
    type: [InterviewTurnDto],
    maxItems: L.maxTurns,
  })
  @IsArray()
  @ArrayMaxSize(L.maxTurns)
  @IsObject({ each: true, message: 'Cada turno debe ser un objeto.' })
  @ValidateNested({ each: true })
  @Type(() => InterviewTurnDto)
  turns: InterviewTurnDto[];

  @ApiProperty({
    enum: RED_FLAGS,
    isArray: true,
    uniqueItems: true,
    description:
      'Señales de alarma que detectó el cliente (PA-F11-1, provisional), sin repetir.',
  })
  @IsArray()
  @ArrayUnique()
  @IsIn(RED_FLAGS, { each: true })
  redFlags: RedFlag[];

  @ApiProperty({ enum: INTERVIEW_ENDED_BY })
  @IsIn(INTERVIEW_ENDED_BY)
  endedBy: InterviewEndedBy;
}

/** POST /patient/symptom-interview/next-question (R11): sin estado, el cliente envía todos los turnos (D4). */
export class NextQuestionRequestDto {
  @ApiProperty({ minLength: 1, maxLength: L.chiefComplaintMax })
  @IsString()
  @IsTrimmedLength(1, L.chiefComplaintMax)
  chiefComplaintText: string;

  @ApiProperty({ type: [InterviewTurnDto], maxItems: L.maxRequestTurns })
  @IsArray()
  @ArrayMaxSize(L.maxRequestTurns)
  @IsObject({ each: true, message: 'Cada turno debe ser un objeto.' })
  @ValidateNested({ each: true })
  @Type(() => InterviewTurnDto)
  turns: InterviewTurnDto[];
}

export const NEXT_QUESTION_KINDS = ['QUESTION', 'DONE', 'RED_FLAG'] as const;

/** Respuesta de next-question (R11): QUESTION lleva dimension y question; RED_FLAG lleva redFlags; DONE, nada más. */
export class NextQuestionDto {
  @ApiProperty({ enum: NEXT_QUESTION_KINDS })
  kind: (typeof NEXT_QUESTION_KINDS)[number];

  @ApiProperty({
    enum: DIMENSIONS,
    required: false,
    description: 'Solo en QUESTION.',
  })
  dimension?: Dimension;

  @ApiProperty({
    required: false,
    maxLength: L.llmQuestionMax,
    description: 'Solo en QUESTION. Una sola pregunta, terminada en "?".',
  })
  question?: string;

  @ApiProperty({
    enum: RED_FLAGS,
    isArray: true,
    required: false,
    description:
      'Solo en RED_FLAG: señales de las reglas deterministas (puede ser vacía si solo la sospechó el LLM). La app muestra "Acude ya a urgencias o llama al 123".',
  })
  redFlags?: RedFlag[];
}
