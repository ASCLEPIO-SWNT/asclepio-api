import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PatientOnly } from '../../common/auth/decorators.js';
import type { PatientPrincipal } from '../../common/auth/principal.js';
import { Throttled } from '../../common/throttle/throttled.decorator.js';
import { UuidParamPipe } from '../../common/validation/uuid-param.pipe.js';
import {
  CreatePreRegistrationDto,
  PatientPreRegistrationDto,
} from './dto/encounters.dto.js';
import { PreRegistrationsService } from './pre-registrations.service.js';

/** Pre-registros del paciente en la app (D18): el paciente sale solo de pid y tid del token. */
@ApiTags('patient')
@Controller('patient/pre-registrations')
export class PatientPreRegistrationsController {
  constructor(private readonly preRegistrations: PreRegistrationsService) {}

  @Post()
  @PatientOnly()
  @Throttled()
  @ApiCreatedResponse({ type: PatientPreRegistrationDto })
  create(
    @CurrentPrincipal() principal: PatientPrincipal,
    @Body() dto: CreatePreRegistrationDto,
  ): Promise<PatientPreRegistrationDto> {
    return this.preRegistrations.create(principal, dto);
  }

  @Get()
  @PatientOnly()
  @ApiOkResponse({ type: [PatientPreRegistrationDto] })
  list(
    @CurrentPrincipal() principal: PatientPrincipal,
  ): Promise<PatientPreRegistrationDto[]> {
    return this.preRegistrations.listForPatient(principal);
  }

  @Get(':id')
  @PatientOnly()
  @ApiOkResponse({ type: PatientPreRegistrationDto })
  get(
    @CurrentPrincipal() principal: PatientPrincipal,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<PatientPreRegistrationDto> {
    return this.preRegistrations.getForPatient(principal, id);
  }
}
