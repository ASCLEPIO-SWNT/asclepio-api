import type { INestApplication } from '@nestjs/common';
import type { Subscription } from 'rxjs';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import {
  type EncounterChange,
  EncountersService,
} from '../src/modules/encounters/encounters.service.js';
import { createApp } from './e2e-app.js';
import { FailingAuditService } from './int/failing-audit.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { F02Fixtures, type Staff } from './int/f02-fixtures.js';
import { F03Fixtures } from './int/f03-fixtures.js';

const T = new Date('2026-11-18T15:00:00.000Z');

/**
 * F-10-api (T3): EncountersService.changes$ emite { tenantId, siteId } después del commit de crear, clasificar y
 * transicionar una atención; una transacción revertida no emite (R8).
 */
describe('F-10: bus de cambios de encounters (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  let encounters: EncountersService;
  const clock = new FixedClock(T);
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  let t: { id: string; siteId: string; siteName: string };
  let rec: Staff;
  let nurse: Staff;
  let doc: Staff;
  let sub: Subscription;
  /** Cada cambio con el estado de la atención leído al recibirlo (en otra conexión: ya confirmado). */
  let seen: Promise<EncounterChange & { statuses: string[] }>[] = [];

  const drain = async () => {
    const out = await Promise.all(seen);
    seen = [];
    return out;
  };

  beforeAll(async () => {
    FailingAuditService.failOn = new Set();
    app = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: GROQ_CLIENT, useValue: fake },
        { provide: OPENROUTER_CLIENT, useValue: fake },
        { provide: AuditService, useClass: FailingAuditService },
      ],
    });
    fx = new F02Fixtures(app);
    f3 = new F03Fixtures(fx);
    encounters = app.get(EncountersService);
    t = await fx.tenant('f10-changes');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
    doc = await fx.staff(t.id, 'PHYSICIAN');
    sub = encounters.changes$.subscribe((c) => {
      seen.push(
        fx.prisma.encounter
          .findMany({
            where: { tenantId: c.tenantId, siteId: c.siteId },
            orderBy: { arrivalAt: 'asc' },
            select: { status: true },
          })
          .then((rows) => ({ ...c, statuses: rows.map((r) => r.status) })),
      );
    });
  });
  beforeEach(async () => {
    clock.set(T);
    await drain();
  });
  afterAll(async () => {
    sub.unsubscribe();
    FailingAuditService.failOn = new Set([
      'AUTH_LOGIN_SUCCEEDED',
      'PATIENT_ACCOUNT_CREATED',
    ]);
    await app.close();
  });

  it('R8: crear (POST /encounters), clasificar, start-care, close y cancel emiten { tenantId, siteId } tras el commit', async () => {
    const site = { tenantId: t.id, siteId: t.siteId };
    const id = await f3.encounter(t, rec);
    expect(await drain()).toEqual([{ ...site, statuses: ['WAITING_TRIAGE'] }]);

    await fx
      .http('post', `/encounters/${id}/triage-decision`, nurse.token)
      .send({ action: 'MANUAL', level: 3 })
      .expect(201);
    expect(await drain()).toEqual([{ ...site, statuses: ['TRIAGED'] }]);

    await fx
      .http('post', `/encounters/${id}/start-care`, doc.token)
      .expect(200);
    expect(await drain()).toEqual([{ ...site, statuses: ['IN_CARE'] }]);

    await fx.http('post', `/encounters/${id}/close`, doc.token).expect(200);
    expect(await drain()).toEqual([{ ...site, statuses: ['CLOSED'] }]);

    clock.advance(1000); // llega después: orden estable por arrival_at
    const other = await f3.encounter(t, rec);
    await drain();
    await fx
      .http('post', `/encounters/${other}/cancel`, nurse.token)
      .send({ reason: 'DEV-test fin de la prueba' })
      .expect(200);
    expect(await drain()).toEqual([
      { ...site, statuses: ['CLOSED', 'CANCELLED'] },
    ]);
  });

  it('R8: confirmar un pre-registro (createInTx) emite el cambio de su sede', async () => {
    const south = await fx.site(t.id, 'DEV-test Sede Sur');
    const p = await fx.patientUser(t.id);
    const pre = await fx.preRegister(p, south.id);
    expect(await drain()).toEqual([]);
    await fx
      .http('post', `/pre-registrations/${pre.id}/confirm`, rec.token)
      .send({ identityVerified: true })
      .expect(201);
    expect(await drain()).toEqual([
      { tenantId: t.id, siteId: south.id, statuses: ['WAITING_TRIAGE'] },
    ]);
  });

  it('R8: un rechazo de la transacción (409 o rollback por fallo de la auditoría) no emite nada', async () => {
    const id = await f3.encounter(t, rec);
    await drain();
    // 409: start-care desde WAITING_TRIAGE.
    await fx
      .http('post', `/encounters/${id}/start-care`, doc.token)
      .expect(409);
    // Rollback después de createInTx: falla la auditoría PRE_REGISTRATION_CONFIRMED.
    const p = await fx.patientUser(t.id);
    const pre = await fx.preRegister(p, t.siteId);
    FailingAuditService.failOn = new Set(['PRE_REGISTRATION_CONFIRMED']);
    try {
      await fx
        .http('post', `/pre-registrations/${pre.id}/confirm`, rec.token)
        .send({ identityVerified: true })
        .expect(500);
    } finally {
      FailingAuditService.failOn = new Set();
    }
    expect(
      await fx.prisma.encounter.count({ where: { patientId: p.patientId } }),
    ).toBe(0);
    expect(await drain()).toEqual([]);
  });
});
