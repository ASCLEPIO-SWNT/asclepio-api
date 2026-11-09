import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  ValidateBy,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { isUuid } from '../../../common/uuid.js';
import { StaffRefDto } from '../../encounters/dto/encounters.dto.js';
import {
  type DecisionInput,
  TRIAGE_DECISION_ACTIONS,
  type TriageDecisionAction,
} from '../triage-decision.rules.js';

export const TRIAGE_LEVEL_MIN = 1;
export const TRIAGE_LEVEL_MAX = 5;
export const CORRECTION_REASON_MAX = 500;

type FieldError = { field: string; message: string };

/** Acción del cuerpo, o null si no es una de las tres (el error lo da @IsIn de action). */
function actionOf(args: ValidationArguments): TriageDecisionAction | null {
  const action = (args.object as { action?: unknown }).action;
  return TRIAGE_DECISION_ACTIONS.includes(action as TriageDecisionAction)
    ? (action as TriageDecisionAction)
    : null;
}

/**
 * Forma de un campo según la acción (D6): `rule` devuelve si el valor es válido para esa acción. Con una acción
 * desconocida no se valida (el 400 ya lo da action). El mensaje es fijo: no repite el valor enviado (R23).
 */
function ShapeByAction(
  name: string,
  rule: (value: unknown, action: TriageDecisionAction) => boolean,
  message: string,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name,
      validator: {
        validate: (value: unknown, args?: ValidationArguments) => {
          const action = args ? actionOf(args) : null;
          return action === null || rule(value, action);
        },
        defaultMessage: () => message,
      },
    },
    options,
  );
}

// ---------------------------------------------------------------- Petición

/**
 * Cuerpo del POST /encounters/{id}/triage-decision: unión discriminada por action (D6). Solo la forma (400, R4):
 * campos que sobran para la acción, tipos, UUID y campos no declarados (forbidNonWhitelisted). Los rangos y el
 * motivo (422, R5) los comprueba validateDecisionBody. Ningún campo de hora, responsable ni tenant (R20).
 */
export class CreateTriageDecisionDto {
  @ApiProperty({
    enum: TRIAGE_DECISION_ACTIONS,
    enumName: 'TriageDecisionAction',
  })
  @IsIn(TRIAGE_DECISION_ACTIONS, {
    message: 'action debe ser VALIDATE, CORRECT o MANUAL',
  })
  action: TriageDecisionAction;

  @ApiProperty({ format: 'uuid', required: false })
  @ShapeByAction(
    'triageDecisionSuggestionId',
    (v, action) => (action === 'MANUAL' ? v === undefined : isUuid(v)),
    'suggestionId es obligatorio (UUID) en VALIDATE y CORRECT y no se admite en MANUAL',
  )
  suggestionId?: string;

  @ApiProperty({ type: 'integer', required: false })
  @ShapeByAction(
    'triageDecisionLevel',
    (v, action) =>
      action === 'VALIDATE'
        ? v === undefined
        : typeof v === 'number' && Number.isInteger(v),
    'level es obligatorio (entero) en CORRECT y MANUAL y no se admite en VALIDATE',
  )
  level?: number;

  @ApiProperty({ required: false })
  @ShapeByAction(
    'triageDecisionReason',
    (v, action) =>
      action === 'CORRECT'
        ? v === undefined || typeof v === 'string'
        : v === undefined,
    'reason solo se admite en CORRECT y debe ser texto',
  )
  reason?: string;
}

/**
 * Reglas del cuerpo que no tocan la base (422, R5; D5: antes que el 404): level 1–5 en CORRECT y MANUAL, y motivo de
 * 1 a 500 caracteres sin contar espacios iniciales y finales en CORRECT. Devuelve la entrada de las reglas con el
 * motivo recortado. Supone la forma ya validada por CreateTriageDecisionDto.
 */
export function validateDecisionBody(
  dto: CreateTriageDecisionDto,
): { errors: FieldError[] } | { input: DecisionInput } {
  const errors: FieldError[] = [];
  if (dto.action !== 'VALIDATE') {
    const level = dto.level!;
    if (level < TRIAGE_LEVEL_MIN || level > TRIAGE_LEVEL_MAX) {
      errors.push({
        field: 'level',
        message: `level debe estar entre ${TRIAGE_LEVEL_MIN} y ${TRIAGE_LEVEL_MAX}`,
      });
    }
  }
  const reason = dto.reason?.trim();
  if (
    dto.action === 'CORRECT' &&
    (!reason || reason.length > CORRECTION_REASON_MAX)
  ) {
    errors.push({
      field: 'reason',
      message: `reason es obligatorio en CORRECT y debe tener entre 1 y ${CORRECTION_REASON_MAX} caracteres sin contar los espacios iniciales y finales`,
    });
  }
  if (errors.length) return { errors };
  switch (dto.action) {
    case 'VALIDATE':
      return { input: { action: 'VALIDATE', suggestionId: dto.suggestionId! } };
    case 'CORRECT':
      return {
        input: {
          action: 'CORRECT',
          suggestionId: dto.suggestionId!,
          level: dto.level!,
          reason: reason!,
        },
      };
    case 'MANUAL':
      return { input: { action: 'MANUAL', level: dto.level! } };
  }
}

// ---------------------------------------------------------------- Esquemas OpenAPI del cuerpo (D6)
// Solo documentan las tres variantes del oneOf con discriminador action; la validación la hace CreateTriageDecisionDto.

const SUGGESTION_ID_DOC = {
  format: 'uuid',
  description:
    'Id de la sugerencia VIGENTE de la atención (items[0] de GET /encounters/{id}/triage-suggestions), con status OK. Si no lo es → 409.',
} as const;
const LEVEL_DOC = {
  type: 'integer',
  minimum: TRIAGE_LEVEL_MIN,
  maximum: TRIAGE_LEVEL_MAX,
  description: 'Nivel de triage I–V. No entero → 400; fuera de 1–5 → 422.',
} as const;

export class ValidateTriageDecisionRequest {
  @ApiProperty({
    enum: ['VALIDATE'],
    description:
      'Acepta el nivel sugerido (ya ajustado por los SafetyGuards) de la sugerencia vigente válida.',
  })
  action: 'VALIDATE';
  @ApiProperty(SUGGESTION_ID_DOC) suggestionId: string;
}

export class CorrectTriageDecisionRequest {
  @ApiProperty({
    enum: ['CORRECT'],
    description:
      'Fija un nivel distinto del sugerido por la sugerencia vigente válida, con motivo (igual al sugerido → 422).',
  })
  action: 'CORRECT';
  @ApiProperty(SUGGESTION_ID_DOC) suggestionId: string;
  @ApiProperty(LEVEL_DOC) level: number;
  @ApiProperty({
    minLength: 1,
    maxLength: CORRECTION_REASON_MAX,
    description:
      'Motivo de corrección: de 1 a 500 caracteres sin contar los espacios iniciales y finales (se guardan recortados). Ausente o inválido → 422.',
  })
  reason: string;
}

export class ManualTriageDecisionRequest {
  @ApiProperty({
    enum: ['MANUAL'],
    description:
      'Clasificación manual: solo si la atención no tiene sugerencia vigente válida (si la tiene → 409; use VALIDATE o CORRECT).',
  })
  action: 'MANUAL';
  @ApiProperty(LEVEL_DOC) level: number;
}

// ---------------------------------------------------------------- Respuesta

/** Decisión de triage (R15). */
export class TriageDecisionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) encounterId: string;
  @ApiProperty({
    enum: TRIAGE_DECISION_ACTIONS,
    enumName: 'TriageDecisionAction',
  })
  action: TriageDecisionAction;
  @ApiProperty({
    type: 'integer',
    minimum: TRIAGE_LEVEL_MIN,
    maximum: TRIAGE_LEVEL_MAX,
    description: 'Nivel final decidido por enfermería.',
  })
  level: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  suggestionId: string | null;
  @ApiProperty({
    type: 'integer',
    minimum: TRIAGE_LEVEL_MIN,
    maximum: TRIAGE_LEVEL_MAX,
    nullable: true,
    description:
      'Nivel sugerido de la sugerencia decidida, ya ajustado por los SafetyGuards; null en MANUAL.',
  })
  suggestedLevel: number | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Motivo de corrección (solo en CORRECT).',
  })
  reason: string | null;
  @ApiProperty({ format: 'date-time', description: 'Hora del servidor.' })
  decidedAt: string;
  @ApiProperty({ type: StaffRefDto }) decidedBy: StaffRefDto;
}
