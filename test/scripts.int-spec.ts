import { spawnSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { createApp } from './e2e-app.js';
import { testName } from './int/db.js';
import { Fixtures, PASSWORD } from './int/fixtures.js';

// Los scripts se prueban compilados (scripts/test-int.sh ejecuta npm run build antes de Jest):
// npm run users:create = npm run build + node dist/scripts/users-create.js.
function run(
  script: 'users-create' | 'sites-create',
  args: string[],
  opts: { stdin?: string; env?: Record<string, string> } = {},
) {
  const res = spawnSync('node', [`dist/scripts/${script}.js`, ...args], {
    input: opts.stdin ?? '',
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', ...opts.env },
    timeout: 60_000,
  });
  return { code: res.status, output: `${res.stdout}\n${res.stderr}` };
}

describe('Scripts CLI (integración, proceso hijo contra Docker)', () => {
  let app: INestApplication<App>;
  let fx: Fixtures;

  beforeAll(async () => {
    app = await createApp();
    fx = new Fixtures(app);
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  const uniqueEmail = () =>
    `DEV-Test-${Date.now()}-${Math.random().toString(36).slice(2)}@Example.Test`;
  const tenantByName = async (name: string) => {
    const t = await fx.prisma.tenant.findUnique({ where: { name } });
    if (t) fx.track(t.id);
    return t;
  };

  describe('npm run users:create', () => {
    it('R40: crea la IPS si no existe y el usuario con email en minúsculas, hash scrypt, active = true y auditoría USER_CREATED (SYSTEM); código 0', async () => {
      const email = uniqueEmail();
      const tenant = testName('cli-users');
      const r = run(
        'users-create',
        [
          '--email',
          email,
          '--full-name',
          'DEV-test Admin CLI',
          '--role',
          'ADMIN',
          '--tenant',
          tenant,
        ],
        { stdin: `${PASSWORD}\n` },
      );
      expect(r.code).toBe(0);
      const t = await tenantByName(tenant);
      expect(t).not.toBeNull();
      const user = await fx.prisma.user.findUniqueOrThrow({
        where: { email: email.toLowerCase() },
      });
      expect(user).toMatchObject({
        tenantId: t!.id,
        fullName: 'DEV-test Admin CLI',
        role: 'ADMIN',
        active: true,
      });
      expect(user.passwordHash).toMatch(/^scrypt\$/);
      const audits = await fx.audits({
        entityId: user.id,
        action: 'USER_CREATED',
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actorType: 'SYSTEM',
        actorId: null,
        tenantId: t!.id,
        entity: 'user',
      });
      // R27, R35: la salida no contiene la contraseña, el hash, el email ni el nombre.
      for (const secret of [
        PASSWORD,
        user.passwordHash,
        email,
        email.toLowerCase(),
        'DEV-test Admin CLI',
      ]) {
        expect(r.output).not.toContain(secret);
      }
    });

    it('R40: si la IPS ya existe la reutiliza', async () => {
      const t = await fx.tenant('cli-users-existing');
      const email = uniqueEmail();
      const r = run(
        'users-create',
        [
          '--email',
          email,
          '--full-name',
          'DEV-test Enfermera',
          '--role',
          'NURSE',
          '--tenant',
          t.name,
        ],
        { stdin: PASSWORD },
      );
      expect(r.code).toBe(0);
      const user = await fx.prisma.user.findUniqueOrThrow({
        where: { email: email.toLowerCase() },
      });
      expect(user.tenantId).toBe(t.id);
      expect(await fx.prisma.tenant.count({ where: { name: t.name } })).toBe(1);
    });

    it('R41: si ya existe un usuario con ese email termina con código 0 sin crear ni modificar filas', async () => {
      const t = await fx.tenant('cli-users-dup');
      const existing = await fx.user(t.id, { role: 'NURSE' });
      const otherTenant = testName('cli-users-dup-other');
      const r = run(
        'users-create',
        [
          '--email',
          existing.email.toUpperCase(),
          '--full-name',
          'DEV-test Otro',
          '--role',
          'ADMIN',
          '--tenant',
          otherTenant,
        ],
        { stdin: 'otra-clave-distinta-1' },
      );
      expect(r.code).toBe(0);
      expect(r.output).toMatch(/ya existe/);
      expect(
        await fx.prisma.user.findUniqueOrThrow({ where: { id: existing.id } }),
      ).toEqual(existing);
      expect(await tenantByName(otherTenant)).toBeNull();
      expect(
        await fx.audits({ entityId: existing.id, action: 'USER_CREATED' }),
      ).toHaveLength(0);
    });

    it.each([
      [
        'falta --email',
        (e: string, t: string) => [
          '--full-name',
          'DEV-x',
          '--role',
          'NURSE',
          '--tenant',
          t,
        ],
        PASSWORD,
      ],
      [
        'falta --full-name',
        (e: string, t: string) => [
          '--email',
          e,
          '--role',
          'NURSE',
          '--tenant',
          t,
        ],
        PASSWORD,
      ],
      [
        'falta --role',
        (e: string, t: string) => [
          '--email',
          e,
          '--full-name',
          'DEV-x',
          '--tenant',
          t,
        ],
        PASSWORD,
      ],
      [
        'falta --tenant',
        (e: string) => [
          '--email',
          e,
          '--full-name',
          'DEV-x',
          '--role',
          'NURSE',
        ],
        PASSWORD,
      ],
      [
        'email inválido',
        (_e: string, t: string) => [
          '--email',
          'no-es-email',
          '--full-name',
          'DEV-x',
          '--role',
          'NURSE',
          '--tenant',
          t,
        ],
        PASSWORD,
      ],
      [
        'rol inválido',
        (e: string, t: string) => [
          '--email',
          e,
          '--full-name',
          'DEV-x',
          '--role',
          'SUPERUSER',
          '--tenant',
          t,
        ],
        PASSWORD,
      ],
      [
        'contraseña de 9 caracteres',
        (e: string, t: string) => [
          '--email',
          e,
          '--full-name',
          'DEV-x',
          '--role',
          'NURSE',
          '--tenant',
          t,
        ],
        'a'.repeat(9),
      ],
      [
        'contraseña de 129 caracteres',
        (e: string, t: string) => [
          '--email',
          e,
          '--full-name',
          'DEV-x',
          '--role',
          'NURSE',
          '--tenant',
          t,
        ],
        'a'.repeat(129),
      ],
    ])(
      'R42: %s → código distinto de 0 sin crear filas',
      async (_l, args, password) => {
        const email = uniqueEmail();
        const tenant = testName('cli-users-bad');
        const r = run('users-create', args(email, tenant), { stdin: password });
        expect(r.code).not.toBe(0);
        expect(
          await fx.prisma.user.count({ where: { email: email.toLowerCase() } }),
        ).toBe(0);
        expect(await tenantByName(tenant)).toBeNull();
        expect(r.output).not.toContain(password);
      },
    );

    it('R43: mientras NODE_ENV no sea production rechaza --full-name o --tenant sin prefijo DEV- (código ≠ 0, sin filas)', async () => {
      for (const [fullName, tenant] of [
        ['Nombre Real', testName('cli-users-prefix')],
        ['DEV-test Nombre', `IPS Real ${Date.now()}`],
      ]) {
        const email = uniqueEmail();
        for (const nodeEnv of ['development', 'test']) {
          const r = run(
            'users-create',
            [
              '--email',
              email,
              '--full-name',
              fullName,
              '--role',
              'NURSE',
              '--tenant',
              tenant,
            ],
            { stdin: PASSWORD, env: { NODE_ENV: nodeEnv } },
          );
          expect(r.code).not.toBe(0);
        }
        expect(
          await fx.prisma.user.count({ where: { email: email.toLowerCase() } }),
        ).toBe(0);
        expect(await tenantByName(tenant)).toBeNull();
      }
    });
  });

  describe('npm run sites:create', () => {
    it('R48: crea la IPS si no existe y la sede, con auditoría SITE_CREATED (SYSTEM, entity site, entity_id, tenant_id); código 0', async () => {
      const tenant = testName('cli-sites');
      const r = run('sites-create', [
        '--tenant',
        tenant,
        '--name',
        'DEV-test Sede Norte',
      ]);
      expect(r.code).toBe(0);
      const t = await tenantByName(tenant);
      expect(t).not.toBeNull();
      const site = await fx.prisma.site.findUniqueOrThrow({
        where: {
          tenantId_name: { tenantId: t!.id, name: 'DEV-test Sede Norte' },
        },
      });
      const audits = await fx.audits({
        entityId: site.id,
        action: 'SITE_CREATED',
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actorType: 'SYSTEM',
        actorId: null,
        entity: 'site',
        entityId: site.id,
        tenantId: t!.id,
      });
    });

    it('R48: si la IPS ya existe crea la sede en ella', async () => {
      const t = await fx.tenant('cli-sites-existing');
      const r = run('sites-create', [
        '--tenant',
        t.name,
        '--name',
        'DEV-test Sede Sur',
      ]);
      expect(r.code).toBe(0);
      expect(await fx.prisma.site.count({ where: { tenantId: t.id } })).toBe(1);
      expect(await fx.prisma.tenant.count({ where: { name: t.name } })).toBe(1);
    });

    it('R49: si la sede ya existe en esa IPS termina con código 0 sin crear ni modificar filas', async () => {
      const t = await fx.tenant('cli-sites-dup');
      expect(
        run('sites-create', ['--tenant', t.name, '--name', 'DEV-test Sede'])
          .code,
      ).toBe(0);
      const before = await fx.prisma.site.findMany({
        where: { tenantId: t.id },
      });
      const auditsBefore = await fx.audits({
        tenantId: t.id,
        action: 'SITE_CREATED',
      });
      const r = run('sites-create', [
        '--tenant',
        t.name,
        '--name',
        'DEV-test Sede',
      ]);
      expect(r.code).toBe(0);
      expect(r.output).toMatch(/ya existe/);
      expect(
        await fx.prisma.site.findMany({ where: { tenantId: t.id } }),
      ).toEqual(before);
      expect(
        await fx.audits({ tenantId: t.id, action: 'SITE_CREATED' }),
      ).toHaveLength(auditsBefore.length);
    });

    it.each([
      ['falta --tenant', () => ['--name', 'DEV-test Sede'], ''],
      ['falta --name', (t: string) => ['--tenant', t], ''],
      ['--tenant vacío', () => ['--tenant', '', '--name', 'DEV-test Sede'], ''],
      ['--name vacío', (t: string) => ['--tenant', t, '--name', '  '], ''],
    ])('R50: %s → código distinto de 0 sin crear filas', async (_l, args) => {
      const tenant = testName('cli-sites-bad');
      const r = run('sites-create', args(tenant));
      expect(r.code).not.toBe(0);
      expect(await tenantByName(tenant)).toBeNull();
    });

    it('R51: mientras NODE_ENV no sea production rechaza --tenant o --name sin prefijo DEV- (código ≠ 0, sin filas)', async () => {
      const devTenant = await fx.tenant('cli-sites-prefix');
      const realTenant = `IPS Real ${Date.now()}`;
      const r1 = run('sites-create', [
        '--tenant',
        realTenant,
        '--name',
        'DEV-test Sede',
      ]);
      expect(r1.code).not.toBe(0);
      expect(await tenantByName(realTenant)).toBeNull();
      const r2 = run(
        'sites-create',
        ['--tenant', devTenant.name, '--name', 'Sede Real'],
        {
          env: { NODE_ENV: 'development' },
        },
      );
      expect(r2.code).not.toBe(0);
      expect(
        await fx.prisma.site.count({ where: { tenantId: devTenant.id } }),
      ).toBe(0);
    });
  });
});
