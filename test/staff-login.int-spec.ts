import type { INestApplication } from '@nestjs/common';
import { decodeJwt } from 'jose';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { createApp, problem } from './e2e-app.js';
import { FailingAuditService } from './int/failing-audit.js';
import { Fixtures, PASSWORD, WRONG } from './int/fixtures.js';

describe('POST /api/v1/auth/login (integración)', () => {
  let app: INestApplication<App>;
  let fx: Fixtures;
  const clock = new FixedClock(new Date());

  beforeAll(async () => {
    app = await createApp({ overrides: [{ provide: Clock, useValue: clock }] });
    fx = new Fixtures(app);
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  const login = (email: string, password: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password });

  it('R1: con credenciales válidas responde 200 con un JWT de personal de 8 h, sin distinguir mayúsculas en el email', async () => {
    const t = await fx.tenant('login-ok');
    const user = await fx.user(t.id, { role: 'PHYSICIAN' });
    clock.set(new Date());
    const res = await login(user.email.toUpperCase(), PASSWORD).expect(200);
    expect(res.body).toMatchObject({ tokenType: 'Bearer' });
    const claims = decodeJwt((res.body as { accessToken: string }).accessToken);
    expect(claims).toMatchObject({
      iss: 'asclepio-api',
      aud: 'asclepio-staff',
      sub: user.id,
      tid: t.id,
      role: 'PHYSICIAN',
    });
    expect(claims.exp! - claims.iat!).toBe(28_800);
    expect((res.body as { expiresAt: string }).expiresAt).toBe(
      new Date(claims.exp! * 1000).toISOString(),
    );
  });

  it('R2: la respuesta de login no contiene refresh token', async () => {
    const t = await fx.tenant('login-norefresh');
    const user = await fx.user(t.id);
    const res = await login(user.email, PASSWORD).expect(200);
    expect(Object.keys(res.body as object).sort()).toEqual([
      'accessToken',
      'expiresAt',
      'tokenType',
    ]);
  });

  it('R4: cuenta inexistente, contraseña incorrecta, usuario inactivo, cuenta bloqueada e IPS inactiva responden el mismo 401 genérico sin token', async () => {
    const t = await fx.tenant('login-401');
    const ok = await fx.user(t.id);
    const inactive = await fx.user(t.id, { active: false });
    const locked = await fx.user(t.id);
    await fx.prisma.user.update({
      where: { id: locked.id },
      data: { lockedUntil: new Date(clock.now().getTime() + 60_000) },
    });
    const off = await fx.tenant('login-401-off', false);
    const offUser = await fx.user(off.id);

    const bodies: string[] = [];
    for (const [email, password] of [
      ['dev-test-no-existe@example.test', PASSWORD],
      [ok.email, WRONG],
      [inactive.email, PASSWORD],
      [locked.email, PASSWORD],
      [offUser.email, PASSWORD],
    ]) {
      const res = await login(email, password).expect(401);
      const body = problem(res);
      expect(body).not.toHaveProperty('accessToken');
      expect(body).toMatchObject({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'Credenciales inválidas.',
      });
      bodies.push(res.text);
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('R5: al 5º fallo consecutivo fija locked_until = ahora + 15 min y pone failed_attempts a 0', async () => {
    const t = await fx.tenant('login-lock');
    const user = await fx.user(t.id);
    clock.set(new Date());
    for (let i = 1; i <= 4; i++) {
      await login(user.email, WRONG).expect(401);
      const row = await fx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.failedAttempts).toBe(i);
      expect(row.lockedUntil).toBeNull();
    }
    await login(user.email, WRONG).expect(401);
    const row = await fx.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(row.failedAttempts).toBe(0);
    expect(row.lockedUntil?.toISOString()).toBe(
      new Date(clock.now().getTime() + 15 * 60_000).toISOString(),
    );
  });

  it('R30: el bloqueo inserta AUTH_ACCOUNT_LOCKED con la entidad, el tenant y metadata.lockedUntil', async () => {
    const t = await fx.tenant('login-lock-audit');
    const user = await fx.user(t.id);
    clock.set(new Date());
    for (let i = 0; i < 5; i++) await login(user.email, WRONG).expect(401);
    const row = await fx.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    const locks = await fx.audits({
      entityId: user.id,
      action: 'AUTH_ACCOUNT_LOCKED',
    });
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({
      entity: 'user',
      entityId: user.id,
      tenantId: t.id,
      metadata: { lockedUntil: row.lockedUntil!.toISOString() },
    });
  });

  it('R6: mientras locked_until sea futuro rechaza la contraseña correcta sin incrementar failed_attempts; al vencer, admite el login', async () => {
    const t = await fx.tenant('login-locked');
    const user = await fx.user(t.id);
    clock.set(new Date());
    for (let i = 0; i < 5; i++) await login(user.email, WRONG).expect(401);
    clock.advance(15 * 60_000 - 1000);
    await login(user.email, PASSWORD).expect(401);
    await login(user.email, WRONG).expect(401);
    const row = await fx.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(row.failedAttempts).toBe(0);
    clock.advance(1000);
    await login(user.email, PASSWORD).expect(200);
  });

  it('R7: un login exitoso pone failed_attempts a 0 y locked_until a NULL', async () => {
    const t = await fx.tenant('login-reset');
    const user = await fx.user(t.id);
    clock.set(new Date());
    await login(user.email, WRONG).expect(401);
    await login(user.email, WRONG).expect(401);
    await fx.prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(clock.now().getTime() - 1000) },
    });
    await login(user.email, PASSWORD).expect(200);
    const row = await fx.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(row.failedAttempts).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it('R28: el login exitoso inserta AUTH_LOGIN_SUCCEEDED con actor STAFF, tenant, entidad user y hora del servidor', async () => {
    const t = await fx.tenant('login-audit-ok');
    const user = await fx.user(t.id);
    clock.set(new Date('2026-10-26T15:00:00.123Z'));
    await login(user.email, PASSWORD).expect(200);
    const rows = await fx.audits({
      entityId: user.id,
      action: 'AUTH_LOGIN_SUCCEEDED',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: 'STAFF',
      actorId: user.id,
      tenantId: t.id,
      entity: 'user',
      entityId: user.id,
      occurredAt: new Date('2026-10-26T15:00:00.123Z'),
    });
    clock.set(new Date());
  });

  it('R29: cada login fallido inserta AUTH_LOGIN_FAILED con actor NULL y metadata.reason', async () => {
    const t = await fx.tenant('login-audit-fail');
    const bad = await fx.user(t.id);
    const inactive = await fx.user(t.id, { active: false });
    const locked = await fx.user(t.id);
    await fx.prisma.user.update({
      where: { id: locked.id },
      data: { lockedUntil: new Date(clock.now().getTime() + 60_000) },
    });
    await login(bad.email, WRONG).expect(401);
    await login(inactive.email, PASSWORD).expect(401);
    await login(locked.email, PASSWORD).expect(401);
    for (const [u, reason] of [
      [bad, 'BAD_PASSWORD'],
      [inactive, 'INACTIVE'],
      [locked, 'LOCKED'],
    ] as const) {
      const rows = await fx.audits({
        entityId: u.id,
        action: 'AUTH_LOGIN_FAILED',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: null,
        actorType: null,
        entity: 'user',
        entityId: u.id,
        tenantId: t.id,
        metadata: { reason },
        occurredAt: clock.now(),
      });
    }
    // Cuenta inexistente: entity_id y tenant_id NULL.
    const marker = new Date(
      Date.UTC(2031, 0, 1, 0, 0, 0, Math.floor(Math.random() * 1e6)),
    );
    clock.set(marker);
    await login('dev-test-nadie@example.test', PASSWORD).expect(401);
    const unknown = await fx.prisma.auditLog.findMany({
      where: { action: 'AUTH_LOGIN_FAILED', occurredAt: marker },
    });
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({
      entity: 'user',
      entityId: null,
      tenantId: null,
      actorId: null,
      metadata: { reason: 'UNKNOWN_ACCOUNT' },
    });
    clock.set(new Date());
  });

  it('R32: la auditoría del login no guarda contraseña, hash ni email', async () => {
    const t = await fx.tenant('login-audit-privacy');
    const user = await fx.user(t.id);
    await login(user.email, WRONG).expect(401);
    await login(user.email, PASSWORD).expect(200);
    const rows = await fx.audits({ tenantId: t.id });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const dump = JSON.stringify(rows, (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    for (const secret of [
      PASSWORD,
      WRONG,
      user.email,
      user.passwordHash,
      'scrypt$',
    ]) {
      expect(dump).not.toContain(secret);
    }
  });

  describe('si falla la auditoría del login exitoso', () => {
    let failing: INestApplication<App>;
    let ffx: Fixtures;
    beforeAll(async () => {
      failing = await createApp({
        overrides: [{ provide: AuditService, useClass: FailingAuditService }],
      });
      ffx = new Fixtures(failing);
    });
    afterAll(async () => {
      await ffx.cleanup();
      await failing.close();
    });

    it('R33: revierte la transacción, no emite token y responde 500 problem+json', async () => {
      const t = await ffx.tenant('login-audit-down');
      const user = await ffx.user(t.id);
      await ffx.prisma.user.update({
        where: { id: user.id },
        data: { failedAttempts: 2 },
      });
      const res = await request(failing.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(500);
      expect(problem(res)).toMatchObject({
        status: 500,
        detail: 'Error interno.',
      });
      expect(res.text).not.toContain('accessToken');
      const row = await ffx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.failedAttempts).toBe(2);
      expect(
        await ffx.audits({ entityId: user.id, action: 'AUTH_LOGIN_SUCCEEDED' }),
      ).toHaveLength(0);
    });
  });
});
