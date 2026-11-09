import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { buildOpenApiDocument } from '../src/app.setup.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { ClinicalCaptureService } from '../src/modules/encounters/clinical-capture.service.js';
import { createApp, problem } from './e2e-app.js';
import { FailingAuditService } from './int/failing-audit.js';
import { COMPLAINT, F02Fixtures, type Staff } from './int/f02-fixtures.js';
import { F03Fixtures, NOTHING } from './int/f03-fixtures.js';

const NOW = new Date('2026-10-27T12:45:00.000Z');

const ITEMS = [
  { kind: 'SYMPTOM', description: 'DEV-test dolor torácico opresivo' },
  { kind: 'FINDING', description: 'DEV-test diaforesis y palidez' },
  { kind: 'COMPLAINT_NOTE', description: 'DEV-test el dolor irradia a brazo' },
];

describe('F-03: síntomas, hallazgos y notas del motivo (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  const clock = new FixedClock(NOW);
  let t: { id: string; siteId: string };
  let other: { id: string; siteId: string };
  let rec: Staff;
  let nurse: Staff;
  let otherRec: Staff;

  beforeAll(async () => {
    app = await createApp({ overrides: [{ provide: Clock, useValue: clock }] });
    fx = new F02Fixtures(app);
    f3 = new F03Fixtures(fx);
    t = await fx.tenant('f03-sf');
    other = await fx.tenant('f03-sf-other');
    rec = await fx.staff(t.id);
    nurse = await fx.staff(t.id, 'NURSE');
    otherRec = await fx.staff(other.id);
  });
  beforeEach(() => clock.set(NOW));
  afterAll(() => app.close());

  const post = (id: string, body: object, token = nurse.token) =>
    fx.http('post', `/encounters/${id}/symptom-findings`, token).send(body);

  type Item = { id: string; kind: string; description: string };

  it('R7: inserta una fila por elemento en el orden recibido, con la misma recorded_at del servidor, recorded_by y tenant del token, y responde 201', async () => {
    const id = await f3.encounter(t, rec);
    const res = await post(id, {
      items: [
        ...ITEMS,
        { kind: 'SYMPTOM', description: '   DEV-test con espacios   ' },
      ],
    }).expect(201);
    const items = (res.body as { items: Item[] }).items;
    expect(items.map((i) => [i.kind, i.description])).toEqual([
      ...ITEMS.map((i) => [i.kind, i.description]),
      ['SYMPTOM', 'DEV-test con espacios'],
    ]);
    for (const i of items) {
      expect(i).toEqual({
        id: i.id,
        encounterId: id,
        kind: i.kind,
        description: i.description,
        recordedAt: NOW.toISOString(),
        recordedBy: { id: nurse.id, fullName: nurse.fullName },
      });
    }
    const rows = await fx.prisma.symptomFinding.findMany({
      where: { encounterId: id },
    });
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r).toMatchObject({
        tenantId: t.id,
        recordedAt: NOW,
        recordedBy: nurse.id,
      });
    }
  });

  it('R8: items vacío, con 21 elementos, kind inválido o description en blanco responde 400 sin filas', async () => {
    const id = await f3.encounter(t, rec);
    for (const body of [
      { items: [] },
      { items: Array.from({ length: 21 }, () => ITEMS[0]) },
      { items: [{ kind: 'DIAGNOSIS', description: 'DEV-test' }] },
      { items: [ITEMS[0], { kind: 'SYMPTOM', description: '  ' }] },
    ]) {
      expect(problem(await post(id, body).expect(400)).status).toBe(400);
    }
    expect(await f3.counts(id)).toEqual(NOTHING);
  });

  it('R9: una captura nueva no modifica ni borra los hallazgos previos', async () => {
    const id = await f3.encounter(t, rec);
    await post(id, { items: ITEMS }).expect(201);
    const before = await fx.prisma.symptomFinding.findMany({
      where: { encounterId: id },
      orderBy: { id: 'asc' },
    });
    clock.advance(5 * 60_000);
    await post(id, { items: [ITEMS[1]] }).expect(201);
    const after = await fx.prisma.symptomFinding.findMany({
      where: { encounterId: id },
      orderBy: { id: 'asc' },
    });
    expect(after).toHaveLength(4);
    expect(after.filter((a) => before.some((b) => b.id === a.id))).toEqual(
      before,
    );
  });

  it('R10: un COMPLAINT_NOTE no cambia chief_complaint_text ni complaint_source, y no hay endpoint ni método exportado que los modifique', async () => {
    const id = await f3.encounter(t, rec, COMPLAINT);
    const before = await fx.prisma.encounter.findUniqueOrThrow({
      where: { id },
      select: { chiefComplaintText: true, complaintSource: true },
    });
    await post(id, {
      items: [
        {
          kind: 'COMPLAINT_NOTE',
          description: 'DEV-test precisión: el dolor empezó al subir escaleras',
        },
      ],
    }).expect(201);
    expect(
      await fx.prisma.encounter.findUniqueOrThrow({
        where: { id },
        select: { chiefComplaintText: true, complaintSource: true },
      }),
    ).toEqual(before);
    expect(before.chiefComplaintText).toBe(COMPLAINT);

    // Ninguna ruta PATCH/PUT bajo /encounters ni ningún cuerpo de petición que declare el motivo, salvo el alta.
    const doc = buildOpenApiDocument(app);
    for (const [path, ops] of Object.entries(doc.paths)) {
      if (!path.startsWith('/api/v1/encounters')) continue;
      expect([path, ops.patch, ops.put]).toEqual([path, undefined, undefined]);
    }
    await fx
      .http('patch', `/encounters/${id}`, nurse.token)
      .send({ chiefComplaintText: 'x' })
      .expect(404);
    // El service de captura solo inserta y lee (getForSuggestion: lectura para F-04, D1 de specs/F-04-api).
    expect(
      Object.getOwnPropertyNames(ClinicalCaptureService.prototype).sort(),
    ).toEqual([
      'constructor',
      'getCapture',
      'getForSuggestion',
      'recordSymptomFindings',
      'recordVitalSigns',
    ]);
  });

  it('R11: fuera de WAITING_TRIAGE responde 409 sin filas, eventos ni auditoría', async () => {
    for (const status of [
      'REGISTERED',
      'TRIAGED',
      'IN_CARE',
      'CLOSED',
      'CANCELLED',
    ] as const) {
      const id = await f3.encounter(t, rec);
      await f3.setStatus(id, status);
      const res = await post(id, { items: ITEMS });
      expect([status, res.status]).toEqual([status, 409]);
      expect(await f3.counts(id)).toEqual(NOTHING);
    }
  });

  it('R12: atención de otro tenant, inexistente o mal formada → el mismo 404, sin filas', async () => {
    const foreign = await f3.encounter(other, otherRec);
    const seen = new Set<string>();
    for (const id of [
      foreign,
      '00000000-0000-4000-8000-000000000000',
      'zz-mal-formado',
    ]) {
      const p = problem(await post(id, { items: ITEMS }).expect(404));
      seen.add(JSON.stringify([p.title, p.detail, p.status]));
    }
    expect(seen.size).toBe(1);
    expect(await f3.counts(foreign)).toEqual(NOTHING);
  });

  it('R15: inserta un único SYMPTOM_FINDINGS_RECORDED (findingIds, count) y una única auditoría con metadata { count }', async () => {
    const id = await f3.encounter(t, rec);
    const res = await post(id, { items: ITEMS }).expect(201);
    const ids = (res.body as { items: Item[] }).items.map((i) => i.id);
    const events = await fx.prisma.encounterEvent.findMany({
      where: { encounterId: id, type: 'SYMPTOM_FINDINGS_RECORDED' },
    });
    expect(events).toEqual([
      expect.objectContaining({
        tenantId: t.id,
        fromStatus: null,
        toStatus: null,
        payload: { findingIds: ids, count: 3 },
        actorType: 'STAFF',
        actorId: nurse.id,
        occurredAt: NOW,
      }),
    ]);
    const audits = await fx.audits({
      entityId: id,
      action: 'SYMPTOM_FINDINGS_RECORDED',
    });
    expect(audits).toEqual([
      expect.objectContaining({
        actorType: 'STAFF',
        actorId: nurse.id,
        tenantId: t.id,
        entity: 'encounter',
        entityId: id,
        metadata: { count: 3 },
      }),
    ]);
  });

  it('R16: si falla la auditoría se revierte todo (sin filas en symptom_findings ni evento) y responde 500', async () => {
    const failing = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: AuditService, useClass: FailingAuditService },
      ],
    });
    FailingAuditService.failOn.add('SYMPTOM_FINDINGS_RECORDED');
    try {
      const id = await f3.encounter(t, rec);
      const res = await request(failing.getHttpServer())
        .post(`/api/v1/encounters/${id}/symptom-findings`)
        .set('Authorization', `Bearer ${nurse.token}`)
        .send({ items: ITEMS })
        .expect(500);
      expect(problem(res).detail).toBe('Error interno.');
      expect(await f3.counts(id)).toEqual(NOTHING);
    } finally {
      FailingAuditService.failOn.delete('SYMPTOM_FINDINGS_RECORDED');
      await failing.close();
    }
  });
});
