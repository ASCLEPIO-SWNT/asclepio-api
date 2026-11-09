import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CurrentPrincipal, StaffRoles } from '../../common/auth/decorators.js';
import type { StaffPrincipal } from '../../common/auth/principal.js';
import { ProblemDetailsDto } from '../../common/problem/problem-details.dto.js';
import { UuidParamPipe } from '../../common/validation/uuid-param.pipe.js';
import {
  CorrectTriageDecisionRequest,
  CreateTriageDecisionDto,
  ManualTriageDecisionRequest,
  TriageDecisionDto,
  ValidateTriageDecisionRequest,
} from './dto/triage-decision.dto.js';
import { TriageDecisionsService } from './triage-decisions.service.js';

const DECIDES =
  'La IA propone, el profesional decide: esta es la decisión de enfermería y la única vía a TRIAGED (fija finalLevel, triagedAt y triagedBy con la hora del servidor y el usuario del token). Como mucho una por atención (sin re-triage).';

/** Respuesta de error documentada como application/problem+json. */
const problem = (status: number, description: string) =>
  ApiResponse({
    status,
    description,
    content: {
      'application/problem+json': {
        schema: { $ref: getSchemaPath(ProblemDetailsDto) },
      },
    },
  });

/** Decisión de triage (F-05-api): NURSE decide; NURSE y PHYSICIAN la leen. */
@ApiTags('triage-decision')
@ApiExtraModels(
  ValidateTriageDecisionRequest,
  CorrectTriageDecisionRequest,
  ManualTriageDecisionRequest,
)
@Controller('encounters')
export class TriageDecisionsController {
  constructor(private readonly decisions: TriageDecisionsService) {}

  @Post(':id/triage-decision')
  @StaffRoles('NURSE')
  @ApiOperation({
    summary:
      'Registra la decisión de triage: validar, corregir o clasificar a mano',
    description: `${DECIDES} Solo con la atención en WAITING_TRIAGE. Responde solo la decisión: el nuevo estado se lee en GET /encounters/{id}.`,
  })
  @ApiBody({
    required: true,
    description:
      'Uno de los tres cuerpos según action. Un campo que no corresponde a la acción, un tipo incorrecto o cualquier campo no declarado (horas, responsable, tenant, finalLevel, id) → 400.',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(ValidateTriageDecisionRequest) },
        { $ref: getSchemaPath(CorrectTriageDecisionRequest) },
        { $ref: getSchemaPath(ManualTriageDecisionRequest) },
      ],
      discriminator: {
        propertyName: 'action',
        mapping: {
          VALIDATE: getSchemaPath(ValidateTriageDecisionRequest),
          CORRECT: getSchemaPath(CorrectTriageDecisionRequest),
          MANUAL: getSchemaPath(ManualTriageDecisionRequest),
        },
      },
    },
  })
  @ApiCreatedResponse({ type: TriageDecisionDto })
  @problem(400, 'Cuerpo mal formado (errors[] con el campo).')
  @problem(401, 'Sin token válido.')
  @problem(403, 'Rol distinto de NURSE o token de paciente.')
  @problem(
    404,
    'La atención no existe, es de otro tenant o el id está mal formado.',
  )
  @problem(
    409,
    'La atención ya tiene una decisión, no está en WAITING_TRIAGE, la sugerencia no es la vigente o no es válida (VALIDATE/CORRECT), o hay una sugerencia válida (MANUAL).',
  )
  @problem(
    422,
    'level fuera de 1–5, motivo de corrección inválido o CORRECT con el mismo nivel que el sugerido (errors[] con el campo).',
  )
  decide(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param('id', UuidParamPipe) id: string,
    @Body() body: CreateTriageDecisionDto,
  ): Promise<TriageDecisionDto> {
    return this.decisions.decide(principal, id, body);
  }

  @Get(':id/triage-decision')
  @StaffRoles('NURSE', 'PHYSICIAN')
  @ApiOperation({
    summary: 'Lee la decisión de triage de la atención',
    description: `${DECIDES} suggestedLevel es el nivel sugerido (ya ajustado por los SafetyGuards) de la sugerencia decidida, o null en MANUAL.`,
  })
  @ApiOkResponse({ type: TriageDecisionDto })
  @problem(401, 'Sin token válido.')
  @problem(403, 'Rol distinto de NURSE o PHYSICIAN, o token de paciente.')
  @problem(
    404,
    'La atención no existe, es de otro tenant o el id está mal formado; o existe pero aún no tiene decisión (detail distinto).',
  )
  findOne(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<TriageDecisionDto> {
    return this.decisions.findOne(principal.tenantId, id);
  }
}
