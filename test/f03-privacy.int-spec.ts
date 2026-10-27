import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { createApp, problem } from './e2e-app.js';
import { F02Fixtures } from './int/f02-fixtures.js';
import { F03Fixtures, NOTHING } from './int/f03-fixtures.js';
import { CapturingLogger } from './int/fixtures.js';

/** Valores fáciles de buscar como texto en logs, payload y metadata. */
const VITALS = {
  respiratoryRate: 27,
  oxygenSaturation: 91,
  supplementalOxygen: true,
  systolicBp: 173,
  heartRate: 137,
  consciousness: 'V',
  temperatureC: 38.7,
  diastolicBp: 109,
  glucoseMgDl: 247,
};

describe('F-03: privacidad de logs, eventos y auditoría, y 403 sin filas (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  const logger = new CapturingLogger();

  beforeAll(async () => {
    app = await createApp({ logger });
    fx = new F02Fixtures(app);
    f3 = new F03Fixtures(fx);
  });
  afterAll(() => app.close());

  it('R18: los logs, encounter_events.payload y audit_log.metadata de los tres flujos no contienen valores de signos, textos de hallazgos, el motivo ni datos del paciente', async () => {
    const t = await fx.tenant('f03-privacy');
    const rec = await fx.staff(t.id);
    const nurse = await fx.staff(t.id, 'NURSE');
    const physician = await fx.staff(t.id, 'PHYSICIAN');
    const complaint = 'DEV-test zz-motivo-privado dolor abdominal';
    const id = await f3.encounter(t, rec, complaint);
    const texts = [
      'DEV-test zz-sintoma-privado náuseas',
      'DEV-test zz-hallazgo-privado abdomen en tabla',
      'DEV-test zz-nota-privada empezó tras comer',
    ];

    await fx
      .http('post', `/encounters/${id}/vital-signs`, nurse.token)
      .send(VITALS)
      .expect(201);
    await fx
      .http('post', `/encounters/${id}/symptom-findings`, nurse.token)
      .send({
        items: [
          { kind: 'SYMPTOM', description: texts[0] },
          { kind: 'FINDING', description: texts[1] },
          { kind: 'COMPLAINT_NOTE', description: texts[2] },
        ],
      })
      .expect(201);
    await fx
      .http('get', `/encounters/${id}/clinical-capture`, physician.token)
      .expect(200);
    // Un 422 tampoco registra el cuerpo.
    await fx
      .http('post', `/encounters/${id}/vital-signs`, nurse.token)
      .send({ ...VITALS, heartRate: 333 })
      .expect(422);

    // Los ids (uuid) pueden contener por azar los dígitos de un signo: se sustituyen antes de buscar.
    const noIds = (x: string) =>
      x.replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '<id>',
      );
    const logs = noIds(logger.text());
    for (const msg of [
      'vital_signs_recorded',
      'symptom_findings_recorded',
      'clinical_capture_read',
    ]) {
      expect(logs).toContain(msg);
    }

    const events = await fx.prisma.encounterEvent.findMany({
      where: {
        encounterId: id,
        type: { in: ['VITAL_SIGNS_RECORDED', 'SYMPTOM_FINDINGS_RECORDED'] },
      },
    });
    expect(events).toHaveLength(2);
    const audits = await fx.prisma.auditLog.findMany({
      where: {
        tenantId: t.id,
        action: { in: ['VITAL_SIGNS_RECORDED', 'SYMPTOM_FINDINGS_RECORDED'] },
      },
    });
    expect(audits).toHaveLength(2);
    const stored = noIds(
      JSON.stringify([
        events.map((e) => e.payload),
        audits.map((a) => a.metadata),
      ]),
    );

    const sensitive = [
      ...Object.values(VITALS)
        .filter((v) => typeof v === 'number')
        .map(String),
      '333',
      ...texts,
      complaint,
      'zz-',
      'DEV-test Paciente',
    ];
    for (const s of sensitive) {
      expect(['logs', s, logs.includes(s)]).toEqual(['logs', s, false]);
      expect(['stored', s, stored.includes(s)]).toEqual(['stored', s, false]);
    }
    // Solo ids y conteos.
    for (const e of events) {
      expect(Object.keys(e.payload as object).sort()).toEqual(
        e.type === 'VITAL_SIGNS_RECORDED'
          ? ['vitalSignsId']
          : ['count', 'findingIds'],
      );
    }
    for (const a of audits) {
      expect(Object.keys(a.metadata as object)).toEqual(
        a.action === 'VITAL_SIGNS_RECORDED' ? ['encounterId'] : ['count'],
      );
    }
  });

  it('R21: un 403 por rol (RECEPTION, ADMIN, PHYSICIAN en los POST, paciente) no inserta filas, eventos ni auditoría', async () => {
    const t = await fx.tenant('f03-403');
    const rec = await fx.staff(t.id);
    const id = await f3.encounter(t, rec);
    const admin = await fx.staff(t.id, 'ADMIN');
    const physician = await fx.staff(t.id, 'PHYSICIAN');
    const p = await fx.patientUser(t.id);
    for (const token of [rec.token, admin.token, physician.token, p.token]) {
      for (const [path, body] of [
        ['vital-signs', VITALS],
        [
          'symptom-findings',
          { items: [{ kind: 'SYMPTOM', description: 'DEV-test' }] },
        ],
      ] as const) {
        const res = await fx
          .http('post', `/encounters/${id}/${path}`, token)
          .send(body);
        expect([path, res.status]).toEqual([path, 403]);
        expect(problem(res).status).toBe(403);
      }
    }
    for (const token of [rec.token, admin.token, p.token]) {
      await fx
        .http('get', `/encounters/${id}/clinical-capture`, token)
        .expect(403);
    }
    expect(await f3.counts(id)).toEqual(NOTHING);
  });
});
