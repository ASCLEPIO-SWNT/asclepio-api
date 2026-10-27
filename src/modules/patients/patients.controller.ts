import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, StaffRoles } from '../../common/auth/decorators.js';
import type { StaffPrincipal } from '../../common/auth/principal.js';
import {
  CreatePatientDto,
  PatientDto,
  SearchPatientsQueryDto,
} from './dto/patients.dto.js';
import { PatientsService } from './patients.service.js';

@ApiTags('patients')
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  /** Búsqueda exacta por documento en el tenant del token (R24, R25): lista de 0 o 1. */
  @Get()
  @StaffRoles('RECEPTION')
  @ApiOkResponse({ type: [PatientDto] })
  search(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Query() q: SearchPatientsQueryDto,
  ): Promise<PatientDto[]> {
    return this.patients.searchByDocument(
      principal.tenantId,
      q.documentType,
      q.documentNumber,
    );
  }

  /** Alta de paciente por recepción, con documento o NN (R26–R29). */
  @Post()
  @StaffRoles('RECEPTION')
  @ApiCreatedResponse({ type: PatientDto })
  create(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Body() dto: CreatePatientDto,
  ): Promise<PatientDto> {
    return this.patients.createByReception(principal, dto);
  }
}
