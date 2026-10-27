import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, StaffRoles } from '../../common/auth/decorators.js';
import type { StaffPrincipal } from '../../common/auth/principal.js';
import { UuidParamPipe } from '../../common/validation/uuid-param.pipe.js';
import { ClinicalCaptureService } from './clinical-capture.service.js';
import {
  ClinicalCaptureDto,
  CreateSymptomFindingsDto,
  CreateVitalSignsDto,
  SymptomFindingListDto,
  VitalSignsDto,
} from './dto/clinical-capture.dto.js';

/**
 * Captura clínica de enfermería (F-03-api, R1–R22): NURSE captura; NURSE y PHYSICIAN leen (D11). Ningún endpoint
 * modifica el motivo de consulta (R10): las precisiones son hallazgos COMPLAINT_NOTE.
 */
@ApiTags('clinical-capture')
@Controller('encounters')
export class ClinicalCaptureController {
  constructor(private readonly capture: ClinicalCaptureService) {}

  @Post(':id/vital-signs')
  @StaffRoles('NURSE')
  @ApiCreatedResponse({
    type: VitalSignsDto,
    description:
      'Toma registrada con hora del servidor y responsable del token. 422 con errors[] por campo si falta un signo obligatorio, alguno está fuera de rango (la toma entera se rechaza) o la sistólica no supera a la diastólica.',
  })
  recordVitalSigns(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: CreateVitalSignsDto,
  ): Promise<VitalSignsDto> {
    return this.capture.recordVitalSigns(principal, id, dto);
  }

  @Post(':id/symptom-findings')
  @StaffRoles('NURSE')
  @ApiCreatedResponse({
    type: SymptomFindingListDto,
    description:
      'Hallazgos registrados en el orden recibido, con la misma hora del servidor y el responsable del token.',
  })
  recordSymptomFindings(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: CreateSymptomFindingsDto,
  ): Promise<SymptomFindingListDto> {
    return this.capture.recordSymptomFindings(principal, id, dto);
  }

  @Get(':id/clinical-capture')
  @StaffRoles('NURSE', 'PHYSICIAN')
  @ApiOkResponse({ type: ClinicalCaptureDto })
  getCapture(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<ClinicalCaptureDto> {
    return this.capture.getCapture(principal.tenantId, id);
  }
}
