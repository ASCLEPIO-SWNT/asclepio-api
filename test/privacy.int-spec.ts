import { spawnSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { createApp } from './e2e-app.js';
import { testName } from './int/db.js';
import { FailingAuditService } from './int/failing-audit.js';
import {
  CapturingLogger,
  Fixtures,
  PASSWORD,
  randomDoc,
  WRONG,
} from './int/fixtures.js';

describe('Privacidad de logs y errores (integración)', () => {
  let app: INestApplication<App>;
  let fx: Fixtures;
  const logger = new CapturingLogger();

  beforeAll(async () => {
    app = await createApp({ logger });
    fx = new Fixtures(app);
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  it('R35: los logs de logins (éxito y fallo), del alta de paciente y de users:create no contienen contraseñas, hashes, emails, documentos, nombres, fechas de nacimiento ni tokens', async () => {
    const server = app.getHttpServer();
    const t = await fx.tenant('privacy-logs');
    const user = await fx.user(t.id);
    const sensitive: string[] = [
      PASSWORD,
      WRONG,
      user.email,
      user.passwordHash,
      user.fullName,
    ];

    const ok = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    sensitive.push((ok.body as { accessToken: string }).accessToken);
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: WRONG })
      .expect(401);
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'dev-test-privado@example.test', password: PASSWORD })
      .expect(401);
    sensitive.push('dev-test-privado@example.test');

    const doc = randomDoc();
    const signup = {
      tenantId: t.id,
      documentType: 'CC',
      documentNumber: doc,
      fullName: 'DEV-test Paciente Privado',
      birthDate: '1991-07-13',
      sex: 'F',
      password: PASSWORD,
      consentAccepted: true,
      consentVersion: '2026-10-v1',
    };
    sensitive.push(doc, signup.fullName, signup.birthDate);
    await request(server)
      .post('/api/v1/auth/patient/accounts')
      .send(signup)
      .expect(201);
    await request(server)
      .post('/api/v1/auth/patient/accounts')
      .send(signup)
      .expect(409);
    await request(server)
      .post('/api/v1/auth/patient/accounts')
      .send({ ...signup, birthDate: '2015-01-01' })
      .expect(422);
    const plogin = await request(server)
      .post('/api/v1/auth/patient/login')
      .send({
        tenantId: t.id,
        documentType: 'CC',
        documentNumber: doc,
        password: PASSWORD,
      })
      .expect(200);
    sensitive.push((plogin.body as { accessToken: string }).accessToken);
    await request(server)
      .post('/api/v1/auth/patient/login')
      .send({
        tenantId: t.id,
        documentType: 'CC',
        documentNumber: doc,
        password: WRONG,
      })
      .expect(401);

    // Un 500 (auditoría caída) también se registra sin datos de la petición.
    const failing = await createApp({
      logger,
      overrides: [{ provide: AuditService, useClass: FailingAuditService }],
    });
    await request(failing.getHttpServer())
      .post('/api/v1/auth/patient/accounts')
      .send({ ...signup, documentNumber: randomDoc() })
      .expect(500);
    await failing.close();

    const logs = logger.text();
    expect(logs).toContain('login_succeeded');
    expect(logs).toContain('login_failed');
    expect(logs).toContain('patient_account_created');
    expect(logs).toContain('unhandled_error');
    for (const s of sensitive) expect(logs).not.toContain(s);

    // users:create (proceso hijo): su salida tampoco contiene datos personales.
    const email = `DEV-test-${Date.now()}@example.test`;
    const tenant = testName('privacy-cli');
    const r = spawnSync(
      'node',
      [
        'dist/scripts/users-create.js',
        '--email',
        email,
        '--full-name',
        'DEV-test Nombre Privado',
        '--role',
        'NURSE',
        '--tenant',
        tenant,
      ],
      {
        input: PASSWORD,
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'test' },
      },
    );
    expect(r.status).toBe(0);
    const created = await fx.prisma.tenant.findUnique({
      where: { name: tenant },
    });
    if (created) fx.track(created.id);
    const cliOut = `${r.stdout}${r.stderr}`;
    for (const s of [
      email,
      email.toLowerCase(),
      'DEV-test Nombre Privado',
      PASSWORD,
      'scrypt$',
    ]) {
      expect(cliOut).not.toContain(s);
    }
  });

  it('R36: los errores de F-01 son application/problem+json y no repiten en detail ni en errors[].message los valores enviados', async () => {
    const server = app.getHttpServer();
    const t = await fx.tenant('privacy-errors');
    const marker = 'zzSecretoClienteZZ';
    const doc = randomDoc();
    const valid = {
      tenantId: t.id,
      documentType: 'CC',
      documentNumber: doc,
      fullName: `DEV-test ${marker}`,
      birthDate: '1990-01-01',
      sex: 'M',
      password: `${marker}-clave`,
      consentAccepted: true,
      consentVersion: '2026-10-v1',
    };
    await request(server)
      .post('/api/v1/auth/patient/accounts')
      .send(valid)
      .expect(201);

    const responses = [
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: `${marker}@example.test`, password: marker }),
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: marker, password: marker }),
      await request(server)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send(`{"email": ${marker}@example.test}`),
      await request(server).post('/api/v1/auth/patient/login').send({
        tenantId: marker,
        documentType: marker,
        documentNumber: marker,
        password: marker,
      }),
      await request(server)
        .post('/api/v1/auth/patient/login')
        .send({
          tenantId: t.id,
          documentType: 'CC',
          documentNumber: `${doc}9`,
          password: marker,
        }),
      await request(server)
        .post('/api/v1/auth/patient/accounts')
        .send({
          ...valid,
          documentType: marker,
          sex: marker,
          birthDate: marker,
          tenantId: marker,
          [marker]: marker,
        }),
      await request(server).post('/api/v1/auth/patient/accounts').send(valid), // 409
      await request(server)
        .post('/api/v1/auth/patient/accounts')
        .send({
          ...valid,
          documentNumber: randomDoc(),
          consentVersion: marker,
        }), // 422
      await request(server)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${marker}`),
    ];
    expect(responses.map((r) => r.status)).toEqual([
      401, 400, 400, 400, 401, 400, 409, 422, 401,
    ]);
    for (const res of responses) {
      expect(res.headers['content-type']).toMatch(
        /^application\/problem\+json/,
      );
      const body = JSON.parse(res.text) as {
        detail?: string;
        errors?: { field: string; message: string }[];
      };
      expect(body.detail ?? '').not.toContain(marker);
      expect(body.detail ?? '').not.toContain(doc);
      for (const e of body.errors ?? [])
        expect(e.message).not.toContain(marker);
    }
  });
});
