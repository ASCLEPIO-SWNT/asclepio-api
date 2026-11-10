import {
  applyDecorators,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentPrincipal, StaffRoles } from '../../common/auth/decorators.js';
import type { StaffPrincipal } from '../../common/auth/principal.js';
import { ApiProblemResponse } from '../../common/problem/api-problem-response.js';
import { UuidParamPipe } from '../../common/validation/uuid-param.pipe.js';
import {
  CancelEncounterDto,
  CreateEncounterDto,
  EncounterDto,
  EncounterListDto,
  ListEncountersQueryDto,
  NoBodyDto,
} from './dto/encounters.dto.js';
import { EncountersService } from './encounters.service.js';

/** Errores comunes de start-care y close (F-06-api, R11, R12, R14). */
const TransitionProblems = (from: string) =>
  applyDecorators(
    ApiProblemResponse(
      400,
      'El cuerpo trae algún campo (errors[] con el campo).',
    ),
    ApiProblemResponse(401, 'Sin token válido.'),
    ApiProblemResponse(403, 'Rol distinto de PHYSICIAN o token de paciente.'),
    ApiProblemResponse(
      404,
      'La atención no existe, es de otro tenant o el id está mal formado.',
    ),
    ApiProblemResponse(
      409,
      `La atención no está en ${from} (también tras un cambio concurrente).`,
    ),
  );

const NO_BODY = {
  required: false,
  description: 'Sin cuerpo o {}. Cualquier campo → 400.',
  schema: { type: 'object', additionalProperties: false, properties: {} },
} as const;

/**
 * Atenciones: registro directo, consulta y cancelación (R30–R44 de F-02); paso a atención y cierre por PHYSICIAN
 * (F-06-api, PA-F02-4).
 */
@ApiTags('encounters')
@Controller('encounters')
export class EncountersController {
  constructor(private readonly encounters: EncountersService) {}

  @Post()
  @StaffRoles('RECEPTION')
  @ApiCreatedResponse({ type: EncounterDto })
  create(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Body() dto: CreateEncounterDto,
  ): Promise<EncounterDto> {
    return this.encounters.createDirect(principal, dto);
  }

  @Get()
  @StaffRoles('RECEPTION', 'NURSE', 'PHYSICIAN', 'ADMIN')
  @ApiOkResponse({ type: EncounterListDto })
  list(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Query() q: ListEncountersQueryDto,
  ): Promise<EncounterListDto> {
    return this.encounters.list(principal.tenantId, q);
  }

  @Get(':id')
  @StaffRoles('RECEPTION', 'NURSE', 'PHYSICIAN', 'ADMIN')
  @ApiOkResponse({ type: EncounterDto })
  get(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<EncounterDto> {
    return this.encounters.findOne(principal.tenantId, id);
  }

  @Post(':id/cancel')
  @StaffRoles('RECEPTION', 'NURSE')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: EncounterDto })
  cancel(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: CancelEncounterDto,
  ): Promise<EncounterDto> {
    return this.encounters.cancel(principal, id, dto.reason);
  }

  @Post(':id/start-care')
  @StaffRoles('PHYSICIAN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pasa la atención a IN_CARE (medicina empieza la atención)',
    description:
      'Solo desde TRIAGED (si no, 409; dos peticiones simultáneas: una 200 y otra 409). Conserva finalLevel, triagedAt y triagedBy. Hora y responsable del servidor y del token.',
  })
  @ApiBody(NO_BODY)
  @ApiOkResponse({ type: EncounterDto })
  @TransitionProblems('TRIAGED')
  startCare(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param('id', UuidParamPipe) id: string,
    // El cuerpo solo se valida (R12: ninguno o {}); no se usa.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body() _body: NoBodyDto,
  ): Promise<EncounterDto> {
    return this.encounters.startCare(principal, id);
  }

  @Post(':id/close')
  @StaffRoles('PHYSICIAN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cierra la atención (CLOSED)',
    description:
      'Solo desde IN_CARE (si no, 409). La atención cerrada conserva su nivel final (finalLevel, triagedAt y triagedBy).',
  })
  @ApiBody(NO_BODY)
  @ApiOkResponse({ type: EncounterDto })
  @TransitionProblems('IN_CARE')
  close(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param('id', UuidParamPipe) id: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body() _body: NoBodyDto,
  ): Promise<EncounterDto> {
    return this.encounters.close(principal, id);
  }
}
