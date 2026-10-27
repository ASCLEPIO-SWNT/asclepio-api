import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  CurrentPrincipal,
  PatientOnly,
  StaffRoles,
} from '../../common/auth/decorators.js';
import { type Principal, STAFF_ROLES } from '../../common/auth/principal.js';
import { PublicThrottled } from '../../common/throttle/public-throttled.decorator.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import {
  AccessTokenDto,
  CreatePatientAccountDto,
  type MeDto,
  PatientAccountCreatedDto,
  PatientLoginDto,
  PatientMeDto,
  StaffLoginDto,
  StaffMeDto,
} from './dto/auth.dto.js';
import { PatientAccountsService } from './patient-accounts.service.js';

const ACCOUNT_GONE = 'La cuenta del token ya no está disponible.';

@ApiTags('auth')
@ApiExtraModels(StaffMeDto, PatientMeDto)
@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly patientAccounts: PatientAccountsService,
    private readonly users: UsersService,
  ) {}

  /** Login del personal: email + contraseña → JWT de 8 h (R1, R4–R7). Sin refresh token (R2). */
  @Post('auth/login')
  @PublicThrottled()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AccessTokenDto })
  loginStaff(@Body() dto: StaffLoginDto): Promise<AccessTokenDto> {
    return this.auth.loginStaff(dto);
  }

  /** Login del paciente: IPS + documento + contraseña → JWT de paciente de 8 h (R3–R7). */
  @Post('auth/patient/login')
  @PublicThrottled()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AccessTokenDto })
  loginPatient(@Body() dto: PatientLoginDto): Promise<AccessTokenDto> {
    return this.auth.loginPatient(dto);
  }

  /** Alta de la cuenta de paciente con consentimiento (R20–R26, R44–R47). No emite token (D9). */
  @Post('auth/patient/accounts')
  @PublicThrottled()
  @ApiCreatedResponse({ type: PatientAccountCreatedDto })
  createPatientAccount(
    @Body() dto: CreatePatientAccountDto,
  ): Promise<PatientAccountCreatedDto> {
    return this.patientAccounts.create(dto);
  }

  /** Identidad actual del token, de personal o de paciente (R17–R19). */
  @Get('me')
  @StaffRoles(...STAFF_ROLES)
  @PatientOnly()
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(StaffMeDto) },
        { $ref: getSchemaPath(PatientMeDto) },
      ],
      discriminator: {
        propertyName: 'kind',
        mapping: {
          STAFF: getSchemaPath(StaffMeDto),
          PATIENT: getSchemaPath(PatientMeDto),
        },
      },
    },
  })
  async me(@CurrentPrincipal() principal: Principal): Promise<MeDto> {
    if (principal.kind === 'STAFF') {
      const user = await this.users.findById(principal.id);
      if (!user?.active || user.tenantId !== principal.tenantId) {
        throw new UnauthorizedException(ACCOUNT_GONE);
      }
      return {
        kind: 'STAFF',
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      };
    }
    const account = await this.patientAccounts.findById(principal.id);
    if (!account?.active || account.tenantId !== principal.tenantId) {
      throw new UnauthorizedException(ACCOUNT_GONE);
    }
    return {
      kind: 'PATIENT',
      id: account.id,
      tenantId: account.tenantId,
      patientId: account.patientId,
      consentVersion: account.consentVersion,
      identityVerified: account.identityVerified,
    };
  }
}
