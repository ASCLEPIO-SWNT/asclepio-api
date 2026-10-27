import { Module } from '@nestjs/common';
import { PublicTenantsController } from './public-tenants.controller.js';
import { TenancyService } from './tenancy.service.js';

/** Servicio de tenancy, sin HTTP: lo importan otros módulos y los scripts CLI. */
@Module({ providers: [TenancyService], exports: [TenancyService] })
export class TenancyModule {}

/** Endpoints HTTP de tenancy (GET /public/tenants). Solo lo importa AppModule (necesita el throttler). */
@Module({ imports: [TenancyModule], controllers: [PublicTenantsController] })
export class TenancyHttpModule {}
