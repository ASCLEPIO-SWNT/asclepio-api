import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PatientOnly } from '../../common/auth/decorators.js';
import type { PatientPrincipal } from '../../common/auth/principal.js';
import { Throttled } from '../../common/throttle/throttled.decorator.js';
import {
  PatientProfileDto,
  UpdatePatientProfileDto,
} from './dto/patient-profile.dto.js';
import { PatientsService } from './patients.service.js';

/** Perfil del paciente en la app (D18): el paciente sale solo de pid y tid del token. */
@ApiTags('patient')
@Controller('patient/profile')
export class PatientProfileController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  @PatientOnly()
  @ApiOkResponse({ type: PatientProfileDto })
  get(
    @CurrentPrincipal() principal: PatientPrincipal,
  ): Promise<PatientProfileDto> {
    return this.patients.getProfile(principal.tenantId, principal.patientId);
  }

  @Patch()
  @PatientOnly()
  @Throttled()
  @ApiOkResponse({ type: PatientProfileDto })
  update(
    @CurrentPrincipal() principal: PatientPrincipal,
    @Body() dto: UpdatePatientProfileDto,
  ): Promise<PatientProfileDto> {
    if (!Object.values(dto).some((v) => v !== undefined)) {
      throw new BadRequestException({
        detail: 'La petición no superó la validación.',
        errors: [
          {
            field: 'body',
            message: 'Debe incluir al menos uno de fullName, birthDate o sex.',
          },
        ],
      });
    }
    return this.patients.updateProfile(principal, dto);
  }
}
