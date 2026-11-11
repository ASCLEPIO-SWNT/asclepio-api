import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { createApp, problem } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { COMPLAINT, F02Fixtures, type Staff } from './int/f02-fixtures.js';
import { F03Fixtures, type EncounterStatusName } from './int/f03-fixtures.js';

const NOW = new Date('2026-11-09T15:00:00.000Z');
const MIN = 60_000;

interface QueueItemBody {
  encounterId: string;
  siteId: string;
  siteName: string;
  status: string;
  finalLevel: number | null;
  arrivalAt: string;
  waitMinutes: number | null;
  minutesSinceTriage: number | null;
  maxWaitMinutes: number | null;
  overdue: boolean;
  patient: { initials: string | null; ageYears: number | null; sex: string };
}
interface QueueBody {
  serverNow: string;
  waitingTriage: QueueItemBody[];
  triaged: QueueItemBody[];
  inCare: QueueItemBody[];
}

/** Todas las claves y los valores escalares (como texto) de un JSON, a cualquier profundidad. */
function deepEntries(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => deepEntries(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      deepEntries(v, out);
    }
  } else if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    out.push(String(value));
  }
  return out;
}

const ids = (items: QueueItemBody[]) => items.map((i) => i.encounterId);

describe('F-06: GET /queue (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  const clock = new FixedClock(NOW);
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  let t: { id: string; siteId: string; siteName: string };
  let siteB: { id: string; name: string };
  let other: { id: string; siteId: string };
  let rec: Staff;
  let nurse: Staff;
  let physician: Staff;
  let admin: Staff;
  const e: Record<string, string> = {};
  let otherTenantEncounter: string;

  /** Atención registrada `minutesAgo` minutos antes de NOW (arrival_at = reloj del servidor). */
  async function arrive(
    minutesAgo: number,
    siteId = t.siteId,
    tenant: { id: string } = t,
    by: Staff = rec,
  ): Promise<string> {
    clock.set(new Date(NOW.getTime() - minutesAgo * MIN));
    return f3.encounter({ id: tenant.id, siteId }, by);
  }

  async function triage(id: string, level: number): Promise<void> {
    await fx
      .http('post', `/encounters/${id}/triage-decision`, nurse.token)
      .send({ action: 'MANUAL', level })
      .expect(201);
  }

  async function forced(minutesAgo: number, status: EncounterStatusName) {
    const id = await arrive(minutesAgo);
    await f3.setStatus(id, status);
    return id;
  }

  const getQueue = (token: string, query = '') =>
    fx.http('get', `/queue${query}`, token);

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: GROQ_CLIENT, useValue: fake },
        { provide: OPENROUTER_CLIENT, useValue: fake },
      ],
    });
    fx = new F02Fixtures(app);
    f3 = new F03Fixtures(fx);
    t = await fx.tenant('f06-queue');
    siteB = await fx.site(t.id, 'DEV-test Sede Sur');
    other = await fx.tenant('f06-queue-otro');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
    physician = await fx.staff(t.id, 'PHYSICIAN');
    admin = await fx.staff(t.id, 'ADMIN');
    const otherRec = await fx.staff(other.id);

    e.wOld = await arrive(60);
    e.t2Old = await arrive(50);
    await triage(e.t2Old, 2);
    e.t1 = await arrive(40);
    await triage(e.t1, 1);
    e.wNewB = await arrive(30, siteB.id);
    e.t3 = await arrive(20);
    await triage(e.t3, 3);
    e.t2NewB = await arrive(10, siteB.id);
    await triage(e.t2NewB, 2);
    e.inCareOld = await forced(90, 'IN_CARE');
    e.inCareNew = await forced(5, 'IN_CARE');
    e.registered = await forced(70, 'REGISTERED');
    e.closed = await forced(80, 'CLOSED');
    e.cancelled = await forced(85, 'CANCELLED');
    otherTenantEncounter = await arrive(100, other.siteId, other, otherRec);
    clock.set(NOW);
  });
  beforeEach(() => clock.set(NOW));
  afterAll(() => app.close());

  it('R1: PHYSICIAN, NURSE y ADMIN reciben 200 con las tres secciones repartidas y ordenadas', async () => {
    for (const staff of [physician, nurse, admin]) {
      const q = (await getQueue(staff.token).expect(200)).body as QueueBody;
      expect(ids(q.waitingTriage)).toEqual([e.wOld, e.wNewB]);
      // Nivel ascendente y, dentro del nivel II, más tiempo desde la clasificación primero (DT-02-api, R5): los fixtures
      // se clasifican al llegar, así que 50 min antes que 10 min, como en F-06.
      expect(ids(q.triaged)).toEqual([e.t1, e.t2Old, e.t2NewB, e.t3]);
      // IN_CARE forzado en la base con nivel 3: misma prioridad, llegada ascendente.
      expect(ids(q.inCare)).toEqual([e.inCareOld, e.inCareNew]);
    }
  });

  it('R8: no aparecen REGISTERED, CLOSED, CANCELLED ni atenciones de otro tenant', async () => {
    const q = (await getQueue(physician.token).expect(200)).body as QueueBody;
    const all = ids([...q.waitingTriage, ...q.triaged, ...q.inCare]);
    for (const id of [
      e.registered,
      e.closed,
      e.cancelled,
      otherTenantEncounter,
    ]) {
      expect(all).not.toContain(id);
    }
  });

  it('R2: cada elemento tiene la forma de la cola, con sede, nivel, espera, tiempo máximo y paciente reducido', async () => {
    const q = (await getQueue(physician.token).expect(200)).body as QueueBody;
    expect(q.waitingTriage[0]).toEqual({
      encounterId: e.wOld,
      siteId: t.siteId,
      siteName: t.siteName,
      status: 'WAITING_TRIAGE',
      finalLevel: null,
      arrivalAt: new Date(NOW.getTime() - 60 * MIN).toISOString(),
      waitMinutes: 60,
      minutesSinceTriage: null,
      maxWaitMinutes: null,
      overdue: false,
      patient: { initials: 'DR', ageYears: 56, sex: 'M' },
    });
    expect(q.triaged.find((i) => i.encounterId === e.t2NewB)).toEqual({
      encounterId: e.t2NewB,
      siteId: siteB.id,
      siteName: siteB.name,
      status: 'TRIAGED',
      finalLevel: 2,
      arrivalAt: new Date(NOW.getTime() - 10 * MIN).toISOString(),
      waitMinutes: 10,
      minutesSinceTriage: 10,
      maxWaitMinutes: 30,
      overdue: false,
      patient: { initials: 'DR', ageYears: 56, sex: 'M' },
    });
    expect(q.inCare[0]).toMatchObject({
      status: 'IN_CARE',
      finalLevel: 3,
      waitMinutes: null,
      minutesSinceTriage: null,
      maxWaitMinutes: null,
      overdue: false,
    });
  });

  it('R3: serverNow y waitMinutes salen del reloj del servidor, uno por petición; la hora del cliente se ignora', async () => {
    const later = new Date(NOW.getTime() + 7 * MIN + 59_000);
    clock.set(later);
    const res = await getQueue(physician.token)
      .set('Date', 'Mon, 01 Jan 2024 00:00:00 GMT')
      .set('X-Client-Time', '2024-01-01T00:00:00Z')
      .expect(200);
    const q = res.body as QueueBody;
    expect(q.serverNow).toBe(later.toISOString());
    const wait = Object.fromEntries(
      [...q.waitingTriage, ...q.triaged].map((i) => [
        i.encounterId,
        i.waitMinutes,
      ]),
    );
    expect(wait).toMatchObject({
      [e.wOld]: 67,
      [e.wNewB]: 37,
      [e.t1]: 47,
      [e.t2Old]: 57,
      [e.t2NewB]: 17,
      [e.t3]: 27,
    });
    // Un parámetro con la hora del cliente no se acepta (R6).
    await getQueue(physician.token, `?now=${NOW.toISOString()}`).expect(400);
  });

  // Modificado por DT-02-api: overdue con el tiempo exacto desde la clasificación (I > 0, II > 30 min).
  it('R4: overdue en nivel I con más de 0 ms y en nivel II con más de 30 min desde la clasificación, justo en el límite y después; III nunca', async () => {
    const overdue = async (at: Date) => {
      clock.set(at);
      // Token emitido a esa hora del reloj fijo (el de beforeAll caducaría).
      const doc = await fx.staff(t.id, 'PHYSICIAN');
      const q = (await getQueue(doc.token).expect(200)).body as QueueBody;
      return Object.fromEntries(
        [...q.waitingTriage, ...q.triaged, ...q.inCare].map((i) => [
          i.encounterId,
          [i.maxWaitMinutes, i.overdue],
        ]),
      );
    };
    // Nivel I nuevo: llega a NOW y se clasifica en el acto.
    clock.set(NOW);
    const l1 = await f3.encounter(t, rec);
    await triage(l1, 1);
    const atNow = await overdue(NOW);
    expect(atNow[l1]).toEqual([0, false]);
    const at1s = await overdue(new Date(NOW.getTime() + 1000));
    expect(at1s[l1]).toEqual([0, true]);
    // Nivel II clasificado 10 min antes de NOW: vence al pasar de 30 min exactos desde la clasificación.
    const at30 = await overdue(new Date(NOW.getTime() + 20 * MIN));
    expect(at30[e.t2NewB]).toEqual([30, false]);
    const at30s1 = await overdue(new Date(NOW.getTime() + 20 * MIN + 1000));
    expect(at30s1[e.t2NewB]).toEqual([30, true]);
    // III con espera muy larga, WAITING_TRIAGE e IN_CARE: nunca vencen.
    const late = await overdue(new Date(NOW.getTime() + 24 * 60 * MIN));
    expect(late[e.t3]).toEqual([null, false]);
    expect(late[e.wOld]).toEqual([null, false]);
    expect(late[e.inCareOld]).toEqual([null, false]);
    clock.set(NOW);
    await fx
      .http('post', `/encounters/${l1}/cancel`, nurse.token)
      .send({ reason: 'DEV-test fin de la prueba R4' })
      .expect(200);
  });

  it('R5: con siteId la cola se limita a esa sede', async () => {
    const q = (
      await getQueue(physician.token, `?siteId=${siteB.id}`).expect(200)
    ).body as QueueBody;
    expect(ids(q.waitingTriage)).toEqual([e.wNewB]);
    expect(ids(q.triaged)).toEqual([e.t2NewB]);
    expect(q.inCare).toEqual([]);
    const a = (
      await getQueue(physician.token, `?siteId=${t.siteId}`).expect(200)
    ).body as QueueBody;
    expect(ids(a.waitingTriage)).toEqual([e.wOld]);
    expect(ids(a.triaged)).toEqual([e.t1, e.t2Old, e.t3]);
  });

  it('R6: siteId mal formado o un parámetro desconocido → 400; sede de otro tenant o inexistente → 200 vacío', async () => {
    for (const query of [
      '?siteId=zz-no-uuid',
      `?siteId=${siteB.id}&status=TRIAGED`,
      '?limit=10',
    ]) {
      const res = await getQueue(physician.token, query);
      expect([query, res.status]).toEqual([query, 400]);
      expect(JSON.stringify(problem(res))).not.toContain('zz-no-uuid');
    }
    for (const siteId of [
      other.siteId,
      '0d6c1f6a-0000-4000-8000-000000000000',
    ]) {
      const res = await getQueue(physician.token, `?siteId=${siteId}`).expect(
        200,
      );
      expect(res.body).toEqual({
        serverNow: NOW.toISOString(),
        waitingTriage: [],
        triaged: [],
        inCare: [],
      });
    }
  });

  it('R7: la respuesta no contiene nombre completo, documento, fecha de nacimiento, id del paciente ni motivo (búsqueda profunda)', async () => {
    clock.set(NOW);
    const p = await fx.patient(t.id, {
      fullName: 'DEV-test Zacarías Quintero Ybarra',
      birthDate: new Date('1977-07-17T00:00:00Z'),
      sex: 'F',
    });
    const full = await fx.prisma.patient.findUniqueOrThrow({
      where: { id: p.id },
      select: { documentNumber: true, documentType: true },
    });
    const complaint = 'DEV-test dolor xilofónico raro R7';
    const id = (
      (
        await fx
          .http('post', '/encounters', rec.token)
          .send({
            patientId: p.id,
            siteId: t.siteId,
            chiefComplaintText: complaint,
            complaintSource: 'TYPED',
          })
          .expect(201)
      ).body as { id: string }
    ).id;
    await triage(id, 2);
    const q = (await getQueue(physician.token).expect(200)).body as QueueBody;
    const item = q.triaged.find((i) => i.encounterId === id)!;
    expect(item.patient).toEqual({ initials: 'DY', ageYears: 49, sex: 'F' });

    const entries = deepEntries(q);
    const forbiddenValues = [
      'Zacarías',
      'Quintero',
      'Ybarra',
      full.documentNumber!,
      '1977-07-17',
      p.id,
      complaint,
      COMPLAINT,
      'dolor',
    ];
    for (const v of forbiddenValues) {
      expect([v, entries.filter((x) => x.includes(v))]).toEqual([v, []]);
    }
    const forbiddenKeys = [
      'fullName',
      'documentType',
      'documentNumber',
      'birthDate',
      'patientId',
      'id',
      'chiefComplaintText',
      'complaintSource',
      'estimatedAgeYears',
    ];
    const keys = new Set(entries);
    for (const k of forbiddenKeys) expect([k, keys.has(k)]).toEqual([k, false]);
    expect(Object.keys(item.patient).sort()).toEqual([
      'ageYears',
      'initials',
      'sex',
    ]);
  });
});
