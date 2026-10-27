import { Controller, Get, type INestApplication, Param } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { CurrentPrincipal, StaffRoles } from '../src/common/auth/decorators.js';
import { type Principal, STAFF_ROLES } from '../src/common/auth/principal.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { TenancyModule } from '../src/modules/tenancy/tenancy.module.js';
import { TenancyService } from '../src/modules/tenancy/tenancy.service.js';
import { createApp, problem } from './e2e-app.js';
import { Fixtures } from './int/fixtures.js';

/** Controlador solo de prueba: lee una sede por id con el tenant del token (D5). */
@Controller('test-sites')
class SitesTestController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get(':id')
  @StaffRoles(...STAFF_ROLES)
  get(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.tenancy.findSite(p.tenantId, id);
  }
}

describe('Tenancy (integración)', () => {
  let app: INestApplication<App>;
  let fx: Fixtures;
  let tenancy: TenancyService;

  beforeAll(async () => {
    app = await createApp({
      imports: [TenancyModule],
      controllers: [SitesTestController],
    });
    fx = new Fixtures(app);
    tenancy = app.get(TenancyService);
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  it('R16: una sede de otro tenant responde 404 con el mismo cuerpo que un id inexistente', async () => {
    const a = await fx.tenant('tenancy-a');
    const b = await fx.tenant('tenancy-b');
    const siteB = await tenancy.createSite(b.id, 'DEV-test-sede-b');
    const tokenA = (
      await app.get(TokenService).issueStaff({
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: a.id,
        role: 'ADMIN',
      })
    ).accessToken;
    const tokenB = (
      await app.get(TokenService).issueStaff({
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: b.id,
        role: 'ADMIN',
      })
    ).accessToken;

    const own = await request(app.getHttpServer())
      .get(`/api/v1/test-sites/${siteB.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(own.body).toMatchObject({ id: siteB.id, tenantId: b.id });

    const cross = await request(app.getHttpServer())
      .get(`/api/v1/test-sites/${siteB.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
    const missingId = '00000000-0000-4000-8000-000000000000';
    const missing = await request(app.getHttpServer())
      .get(`/api/v1/test-sites/${missingId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
    const pick = (p: ReturnType<typeof problem>) => ({
      type: p.type,
      title: p.title,
      status: p.status,
      detail: p.detail,
      errors: p.errors,
    });
    const crossBody = pick(problem(cross));
    const missingBody = pick(problem(missing));
    expect(crossBody).toEqual(missingBody);
    expect(JSON.stringify(crossBody)).not.toContain(siteB.id);

    await expect(tenancy.findSite(a.id, siteB.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(tenancy.findSite(a.id, 'no-es-uuid')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('R37: GET /public/tenants lista solo IPS activas ordenadas por nombre, con sus sedes ordenadas y solo id y nombre', async () => {
    const active2 = await fx.tenant('public-zz');
    const active1 = await fx.tenant('public-aa');
    const inactive = await fx.tenant('public-off', false);
    await tenancy.createSite(active1.id, 'DEV-test-sede-z');
    await tenancy.createSite(active1.id, 'DEV-test-sede-a');
    await tenancy.createSite(inactive.id, 'DEV-test-sede-off');

    const res = await request(app.getHttpServer())
      .get('/api/v1/public/tenants')
      .expect(200);
    const list = res.body as {
      id: string;
      name: string;
      sites: { id: string; name: string }[];
    }[];
    const names = list.map((t) => t.name);
    expect(names).not.toContain(inactive.name);
    expect(names.indexOf(active1.name)).toBeLessThan(
      names.indexOf(active2.name),
    );
    for (const t of list) {
      expect(Object.keys(t).sort()).toEqual(['id', 'name', 'sites']);
      for (const s of t.sites)
        expect(Object.keys(s).sort()).toEqual(['id', 'name']);
    }
    const t1 = list.find((t) => t.id === active1.id)!;
    expect(t1.sites.map((s) => s.name)).toEqual([
      'DEV-test-sede-a',
      'DEV-test-sede-z',
    ]);
    expect(list.find((t) => t.id === active2.id)?.sites).toEqual([]);
  });
});
