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
  ConfirmPreRegistrationDto,
  EncounterDto,
  PendingPreRegistrationDto,
  PendingPreRegistrationsQueryDto,
  RejectedPreRegistrationDto,
  RejectPreRegistrationDto,
} from './dto/encounters.dto.js';
import { PreRegistrationsService } from './pre-registrations.service.js';

/** Bandeja, confirmación y rechazo de pre-registros por recepción (R15–R23). */
@ApiTags('pre-registrations')
@Controller('pre-registrations')
export class PreRegistrationsController {
  constructor(private readonly preRegistrations: PreRegistrationsService) {}

  @Get()
  @StaffRoles('RECEPTION')
  @ApiOkResponse({ type: [PendingPreRegistrationDto] })
  pending(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Query() q: PendingPreRegistrationsQueryDto,
  ): Promise<PendingPreRegistrationDto[]> {
    return this.preRegistrations.listPending(principal.tenantId, q.siteId);
  }

  @Post(':id/confirm')
  @StaffRoles('RECEPTION')
  @ApiCreatedResponse({ type: EncounterDto })
  confirm(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: ConfirmPreRegistrationDto,
  ): Promise<EncounterDto> {
    return this.preRegistrations.confirm(principal, id, dto);
  }

  @Post(':id/reject')
  @StaffRoles('RECEPTION')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RejectedPreRegistrationDto })
  reject(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: RejectPreRegistrationDto,
  ): Promise<RejectedPreRegistrationDto> {
    return this.preRegistrations.reject(principal, id, dto.reason);
  }
}
