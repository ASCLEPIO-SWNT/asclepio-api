import type { INestApplication } from '@nestjs/common';
import { decodeJwt } from 'jose';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import { createApp, problem } from './e2e-app.js';
import { Fixtures, PASSWORD, WRONG } from './int/fixtures.js';

describe('POST /api/v1/auth/patient/login (integración)', () => {
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

  const login = (b: {
    tenantId: string;
    documentNumber: string;
    password: string;
    documentType?: string;
  }) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/patient/login')
      .send({ documentType: 'CC', ...b });

  it('R3: con IPS, documento y contraseña válidos responde 200 con un JWT de paciente (aud, sub, tid, pid, sin role, 8 h)', async () => {
    const t = await fx.tenant('plogin-ok');
    const { account, patient } = await fx.patientAccount(t.id);
    const res = await login({
      tenantId: t.id,
      documentNumber: patient.documentNumber!,
      password: PASSWORD,
    }).expect(200);
    expect(Object.keys(res.body as object).sort()).toEqual([
      'accessToken',
      'expiresAt',
      'tokenType',
    ]);
    const claims = decodeJwt((res.body as { accessToken: string }).accessToken);
    expect(claims).toMatchObject({
      iss: 'asclepio-api',
      aud: 'asclepio-patient',
      sub: account.id,
      tid: t.id,
      pid: patient.id,
    });
    expect(claims).not.toHaveProperty('role');
    expect(claims.exp! - claims.iat!).toBe(28_800);
  });

  it('R4: documento inexistente, contraseña incorrecta, cuenta inactiva, bloqueada, IPS inactiva, IPS inexistente o de otra IPS responden el mismo 401 genérico', async () => {
    const t = await fx.tenant('plogin-401');
    const other = await fx.tenant('plogin-401-other');
    const { patient: ok } = await fx.patientAccount(t.id);
    const { patient: inactive } = await fx.patientAccount(t.id, {
      active: false,
    });
    const { account: lockedAcc, patient: locked } = await fx.patientAccount(
      t.id,
    );
    await fx.prisma.patientAccount.update({
      where: { id: lockedAcc.id },
      data: { lockedUntil: new Date(clock.now().getTime() + 60_000) },
    });
    const off = await fx.tenant('plogin-401-off', false);
    const { patient: offP } = await fx.patientAccount(off.id);

    const cases = [
      { tenantId: t.id, documentNumber: '0000000001', password: PASSWORD },
      { tenantId: t.id, documentNumber: ok.documentNumber!, password: WRONG },
      {
        tenantId: t.id,
        documentNumber: inactive.documentNumber!,
        password: PASSWORD,
      },
      {
        tenantId: t.id,
        documentNumber: locked.documentNumber!,
        password: PASSWORD,
      },
      {
        tenantId: off.id,
        documentNumber: offP.documentNumber!,
        password: PASSWORD,
      },
      {
        tenantId: '00000000-0000-4000-8000-000000000000',
        documentNumber: ok.documentNumber!,
        password: PASSWORD,
      },
      {
        tenantId: other.id,
        documentNumber: ok.documentNumber!,
        password: PASSWORD,
      },
    ];
    const bodies = new Set<string>();
    for (const c of cases) {
      const res = await login(c).expect(401);
      expect(problem(res)).toMatchObject({
        status: 401,
        detail: 'Credenciales inválidas.',
      });
      expect(res.text).not.toContain('accessToken');
      bodies.add(res.text);
    }
    expect(bodies.size).toBe(1);
  });

  it('R5: al 5º fallo bloquea la cuenta 15 min y pone failed_attempts a 0, con auditoría AUTH_ACCOUNT_LOCKED (R30)', async () => {
    const t = await fx.tenant('plogin-lock');
    const { account, patient } = await fx.patientAccount(t.id);
    clock.set(new Date());
    for (let i = 0; i < 5; i++) {
      await login({
        tenantId: t.id,
        documentNumber: patient.documentNumber!,
        password: WRONG,
      }).expect(401);
    }
    const row = await fx.prisma.patientAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(row.failedAttempts).toBe(0);
    expect(row.lockedUntil?.toISOString()).toBe(
      new Date(clock.now().getTime() + 15 * 60_000).toISOString(),
    );
    const locks = await fx.audits({
      entityId: account.id,
      action: 'AUTH_ACCOUNT_LOCKED',
    });
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({
      entity: 'patient_account',
      tenantId: t.id,
      metadata: { lockedUntil: row.lockedUntil!.toISOString() },
    });
  });

  it('R6: bloqueada rechaza la contraseña correcta sin incrementar el contador; al vencer el bloqueo admite el login', async () => {
    const t = await fx.tenant('plogin-locked');
    const { account, patient } = await fx.patientAccount(t.id);
    const creds = { tenantId: t.id, documentNumber: patient.documentNumber! };
    clock.set(new Date());
    for (let i = 0; i < 5; i++)
      await login({ ...creds, password: WRONG }).expect(401);
    clock.advance(10 * 60_000);
    await login({ ...creds, password: PASSWORD }).expect(401);
    await login({ ...creds, password: WRONG }).expect(401);
    const row = await fx.prisma.patientAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(row.failedAttempts).toBe(0);
    clock.advance(5 * 60_000);
    await login({ ...creds, password: PASSWORD }).expect(200);
  });

  it('R7: el login exitoso reinicia failed_attempts y locked_until', async () => {
    const t = await fx.tenant('plogin-reset');
    const { account, patient } = await fx.patientAccount(t.id);
    const creds = { tenantId: t.id, documentNumber: patient.documentNumber! };
    await login({ ...creds, password: WRONG }).expect(401);
    await login({ ...creds, password: PASSWORD }).expect(200);
    const row = await fx.prisma.patientAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(row).toMatchObject({ failedAttempts: 0, lockedUntil: null });
  });

  it('R28: el login exitoso inserta AUTH_LOGIN_SUCCEEDED con actor PATIENT y entidad patient_account', async () => {
    const t = await fx.tenant('plogin-audit-ok');
    const { account, patient } = await fx.patientAccount(t.id);
    await login({
      tenantId: t.id,
      documentNumber: patient.documentNumber!,
      password: PASSWORD,
    }).expect(200);
    const rows = await fx.audits({
      entityId: account.id,
      action: 'AUTH_LOGIN_SUCCEEDED',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: 'PATIENT',
      actorId: account.id,
      tenantId: t.id,
      entity: 'patient_account',
      entityId: account.id,
      occurredAt: clock.now(),
    });
  });

  it('R29: los fallos se auditan con AUTH_LOGIN_FAILED, actor NULL y el motivo; sin documento ni contraseña (R32)', async () => {
    const t = await fx.tenant('plogin-audit-fail');
    const { account: bad, patient: badP } = await fx.patientAccount(t.id);
    const { account: inactive, patient: inactiveP } = await fx.patientAccount(
      t.id,
      { active: false },
    );
    await login({
      tenantId: t.id,
      documentNumber: badP.documentNumber!,
      password: WRONG,
    }).expect(401);
    await login({
      tenantId: t.id,
      documentNumber: inactiveP.documentNumber!,
      password: PASSWORD,
    }).expect(401);
    for (const [acc, reason] of [
      [bad, 'BAD_PASSWORD'],
      [inactive, 'INACTIVE'],
    ] as const) {
      const rows = await fx.audits({
        entityId: acc.id,
        action: 'AUTH_LOGIN_FAILED',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: null,
        entity: 'patient_account',
        tenantId: t.id,
        metadata: { reason },
      });
    }
    const marker = new Date(
      Date.UTC(2032, 0, 1, 0, 0, 0, Math.floor(Math.random() * 1e6)),
    );
    clock.set(marker);
    await login({
      tenantId: t.id,
      documentNumber: '0000000002',
      password: PASSWORD,
    }).expect(401);
    const unknown = await fx.prisma.auditLog.findMany({
      where: { action: 'AUTH_LOGIN_FAILED', occurredAt: marker },
    });
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({
      entity: 'patient_account',
      entityId: null,
      tenantId: null,
      metadata: { reason: 'UNKNOWN_ACCOUNT' },
    });
    clock.set(new Date());
    const dump = JSON.stringify(
      await fx.audits({ tenantId: t.id }),
      (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
    );
    for (const pii of [
      badP.documentNumber!,
      inactiveP.documentNumber!,
      PASSWORD,
      WRONG,
    ]) {
      expect(dump).not.toContain(pii);
    }
  });
});
