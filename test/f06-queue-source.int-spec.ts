import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { EncountersService } from '../src/modules/encounters/encounters.service.js';
import { createApp } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { F02Fixtures, type Staff } from './int/f02-fixtures.js';
import { F03Fixtures, type EncounterStatusName } from './int/f03-fixtures.js';

/** F-06 (T3): EncountersService.listActiveForQueue, la fuente de la cola (D2). */
describe('F-06: listActiveForQueue (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  let encounters: EncountersService;
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  let a: { id: string; siteId: string; siteName: string };
  let site2: { id: string; name: string };
  let b: { id: string; siteId: string };
  let recA: Staff;
  const byStatus = new Map<EncounterStatusName, string>();
  let inSite2: string;
  let otherTenant: string;

  async function encounterIn(
    tenant: { id: string; siteId: string },
    rec: Staff,
    status: EncounterStatusName,
  ): Promise<string> {
    const id = await f3.encounter(tenant, rec);
    if (status !== 'WAITING_TRIAGE') await f3.setStatus(id, status);
    return id;
  }

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: GROQ_CLIENT, useValue: fake },
        { provide: OPENROUTER_CLIENT, useValue: fake },
      ],
    });
    fx = new F02Fixtures(app);
    f3 = new F03Fixtures(fx);
    encounters = app.get(EncountersService);
    a = await fx.tenant('f06-src-a');
    site2 = await fx.site(a.id, 'DEV-test Sede Sur');
    b = await fx.tenant('f06-src-b');
    recA = await fx.staff(a.id);
    const recB = await fx.staff(b.id);
    for (const s of [
      'REGISTERED',
      'WAITING_TRIAGE',
      'TRIAGED',
      'IN_CARE',
      'CLOSED',
      'CANCELLED',
    ] as EncounterStatusName[]) {
      byStatus.set(s, await encounterIn(a, recA, s));
    }
    inSite2 = await encounterIn(
      { id: a.id, siteId: site2.id },
      recA,
      'WAITING_TRIAGE',
    );
    otherTenant = await encounterIn(b, recB, 'TRIAGED');
  });
  afterAll(() => app.close());

  it('R8: devuelve solo WAITING_TRIAGE, TRIAGED e IN_CARE del tenant (sin REGISTERED, CLOSED, CANCELLED ni otros tenants)', async () => {
    const rows = await encounters.listActiveForQueue(a.id);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(
      [
        byStatus.get('WAITING_TRIAGE')!,
        byStatus.get('TRIAGED')!,
        byStatus.get('IN_CARE')!,
        inSite2,
      ].sort(),
    );
    expect(ids).not.toContain(otherTenant);
    const other = await encounters.listActiveForQueue(b.id);
    expect(other.map((r) => r.id)).toEqual([otherTenant]);
  });

  it('R5: con siteId limita a esa sede; con una sede de otro tenant no devuelve nada', async () => {
    const s2 = await encounters.listActiveForQueue(a.id, site2.id);
    expect(s2.map((r) => r.id)).toEqual([inSite2]);
    expect(s2[0]).toMatchObject({ siteId: site2.id, siteName: site2.name });
    const s1 = await encounters.listActiveForQueue(a.id, a.siteId);
    expect(s1.map((r) => r.id)).not.toContain(inSite2);
    expect(s1).toHaveLength(3);
    expect(await encounters.listActiveForQueue(a.id, b.siteId)).toEqual([]);
  });

  it('R1: cada fila trae solo los campos de D2 (sin id del paciente, documento ni motivo)', async () => {
    const rows = await encounters.listActiveForQueue(a.id, a.siteId);
    const triaged = rows.find((r) => r.id === byStatus.get('TRIAGED'))!;
    expect(Object.keys(triaged).sort()).toEqual([
      'arrivalAt',
      'finalLevel',
      'id',
      'patient',
      'siteId',
      'siteName',
      'status',
    ]);
    expect(Object.keys(triaged.patient).sort()).toEqual([
      'birthDate',
      'estimatedAgeYears',
      'fullName',
      'sex',
    ]);
    expect(triaged).toMatchObject({
      siteId: a.siteId,
      siteName: a.siteName,
      status: 'TRIAGED',
      finalLevel: 3,
      patient: {
        fullName: 'DEV-test Paciente Recepción',
        birthDate: '1970-01-01',
        estimatedAgeYears: null,
        sex: 'M',
      },
    });
    expect(triaged.arrivalAt).toBeInstanceOf(Date);
  });
});
