import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { PublicThrottled } from '../../common/throttle/public-throttled.decorator.js';
import { TenancyService } from './tenancy.service.js';

export class PublicSiteDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
}

export class PublicTenantDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: [PublicSiteDto] }) sites: PublicSiteDto[];
}

@ApiTags('public')
@Controller('public/tenants')
export class PublicTenantsController {
  constructor(private readonly tenancy: TenancyService) {}

  /** IPS activas con sus sedes, para que la app del paciente elija IPS sin token (R37, PA-3). */
  @Get()
  @PublicThrottled()
  @ApiOkResponse({ type: [PublicTenantDto] })
  list(): Promise<PublicTenantDto[]> {
    return this.tenancy.listActiveWithSites();
  }
}
