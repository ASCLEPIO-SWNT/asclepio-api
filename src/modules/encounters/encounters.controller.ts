import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, StaffRoles } from '../../common/auth/decorators.js';
import type { StaffPrincipal } from '../../common/auth/principal.js';
import { UuidParamPipe } from '../../common/validation/uuid-param.pipe.js';
import {
  CancelEncounterDto,
  CreateEncounterDto,
  EncounterDto,
  EncounterListDto,
  ListEncountersQueryDto,
} from './dto/encounters.dto.js';
import { EncountersService } from './encounters.service.js';

/** Atenciones: registro directo, consulta y cancelación (R30–R44). Sin endpoints de IN_CARE ni CLOSED (PA-F02-4). */
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
}
