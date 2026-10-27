// npm run sites:create -- --tenant <IPS> --name <sede>. Idempotente por (IPS, nombre) (R49).
import { PrismaService } from '../common/prisma/prisma.service.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { TenancyService } from '../modules/tenancy/tenancy.service.js';
import {
  CliError,
  out,
  parseCliArgs,
  requireDevPrefix,
  runCli,
} from './cli.js';

void runCli(async (context) => {
  const args = parseCliArgs(['tenant', 'name'] as const);
  const tenantName = args.tenant?.trim() ?? '';
  const siteName = args.name?.trim() ?? '';
  if (!tenantName || !siteName) {
    throw new CliError(
      'Faltan argumentos: --tenant y --name son obligatorios y no pueden estar vacíos.',
    );
  }
  requireDevPrefix('--tenant', tenantName);
  requireDevPrefix('--name', siteName);

  const app = await context();
  const tenancy = app.get(TenancyService);
  const existingTenant = await tenancy.findByName(tenantName);
  if (
    existingTenant &&
    (await tenancy.findSiteByName(existingTenant.id, siteName))
  ) {
    out('La sede ya existe en esa IPS: no se ha creado ni modificado nada.');
    return;
  }
  const audit = app.get(AuditService);
  const result = await app.get(PrismaService).$transaction(async (tx) => {
    const tenant = await tenancy.findOrCreateByName(tenantName, tx);
    const site = await tenancy.createSite(tenant.id, siteName, tx);
    await audit.record(
      {
        action: 'SITE_CREATED',
        actorType: 'SYSTEM',
        actorId: null,
        tenantId: tenant.id,
        entity: 'site',
        entityId: site.id,
      },
      tx,
    );
    return {
      siteId: site.id,
      tenantId: tenant.id,
      tenantCreated: tenant.created,
    };
  });
  out(
    `Sede creada: id ${result.siteId}, IPS ${result.tenantId}${result.tenantCreated ? ' (IPS nueva)' : ''}.`,
  );
});
