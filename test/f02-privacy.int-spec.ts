import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { createApp } from './e2e-app.js';
import { F02Fixtures } from './int/f02-fixtures.js';
import { CapturingLogger, randomDoc } from './int/fixtures.js';

describe('F-02: privacidad de logs, eventos, auditoría y errores (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  const logger = new CapturingLogger();

  beforeAll(async () => {
    app = await createApp({ logger });
    fx = new F02Fixtures(app);
  });
  afterAll(() => app.close());

  it('R48: los logs de perfil, pre-registro, bandeja, confirmación, rechazo, alta de paciente, registro directo, cancelación y consulta no contienen datos personales ni tokens', async () => {
    const t = await fx.tenant('f02-privacy');
    const rec = await fx.staff(t.id);
    const nurse = await fx.staff(t.id, 'NURSE');
    const name = 'DEV-test Zacarías Privadísimo';
    const p = await fx.patientUser(t.id, { fullName: name });
    const complaint = 'DEV-test dolor privado en el pecho zz-motivo';
    const rejection = 'DEV-test zz-rechazo documento no coincide';
    const cancellation = 'DEV-test zz-cancelacion se fue a otra IPS';
    const doc = randomDoc();
    const sensitive = [
      name,
      p.documentNumber,
      '1985-03-04',
      complaint,
      rejection,
      cancellation,
      doc,
      '1999-09-19',
      rec.token,
      nurse.token,
      p.token,
    ];

    await fx.http('get', '/patient/profile', p.token).expect(200);
    await fx
      .http('patch', '/patient/profile', p.token)
      .send({ birthDate: '1985-03-04', sex: 'F' })
      .expect(200);
    const first = await fx.preRegister(p, t.siteId, {
      chiefComplaintText: complaint,
    });
    await fx.http('get', '/patient/pre-registrations', p.token).expect(200);
    await fx
      .http('get', `/patient/pre-registrations/${first.id}`, p.token)
      .expect(200);
    await fx.http('get', '/pre-registrations', rec.token).expect(200);
    await fx
      .http('post', `/pre-registrations/${first.id}/reject`, rec.token)
      .send({ reason: rejection })
      .expect(200);
    const second = await fx.preRegister(p, t.siteId, {
      chiefComplaintText: complaint,
    });
    const confirmed = await fx
      .http('post', `/pre-registrations/${second.id}/confirm`, rec.token)
      .send({ identityVerified: true })
      .expect(201);
    const encId = (confirmed.body as { id: string }).id;
    await fx
      .http('post', `/encounters/${encId}/cancel`, nurse.token)
      .send({ reason: cancellation })
      .expect(200);

    await fx
      .http('post', '/patients', rec.token)
      .send({
        documentType: 'TI',
        documentNumber: doc,
        fullName: name,
        birthDate: '1999-09-19',
        sex: 'M',
      })
      .expect(201);
    await fx
      .http('get', `/patients?documentType=TI&documentNumber=${doc}`, rec.token)
      .expect(200);
    const nn = await fx
      .http('post', '/patients', rec.token)
      .send({ sex: 'X', estimatedAgeYears: 37 })
      .expect(201);
    const direct = await fx
      .http('post', '/encounters', rec.token)
      .send({
        patientId: (nn.body as { id: string }).id,
        siteId: t.siteId,
        chiefComplaintText: complaint,
        complaintSource: 'VOICE_ON_DEVICE',
      })
      .expect(201);
    await fx
      .http(
        'get',
        `/encounters/${(direct.body as { id: string }).id}`,
        nurse.token,
      )
      .expect(200);
    await fx.http('get', '/encounters', nurse.token).expect(200);

    const logs = logger.text();
    for (const msg of [
      'patient_profile_updated',
      'pre_registration_created',
      'pre_registrations_listed',
      'pre_registration_rejected',
      'pre_registration_confirmed',
      'encounter_status_changed',
      'patient_created',
      'encounter_created',
    ]) {
      expect(logs).toContain(msg);
    }
    for (const s of sensitive) expect(logs).not.toContain(s);
  });

  it('R41: encounter_events.payload y audit_log.metadata del tenant no contienen nombre, documento, fecha de nacimiento, edad estimada, sexo, motivo de consulta ni motivos de cancelación o rechazo', async () => {
    const t = await fx.tenant('f02-privacy-store');
    const rec = await fx.staff(t.id);
    const name = 'DEV-test Eulalia Reservada';
    const p = await fx.patientUser(t.id, { fullName: name });
    const complaint = 'DEV-test zz-motivo-guardado fiebre alta';
    const rejection = 'DEV-test zz-rechazo-guardado';
    const cancellation = 'DEV-test zz-cancelacion-guardada';
    const a = await fx.preRegister(p, t.siteId, {
      chiefComplaintText: complaint,
    });
    await fx
      .http('post', `/pre-registrations/${a.id}/reject`, rec.token)
      .send({ reason: rejection })
      .expect(200);
    const b = await fx.preRegister(p, t.siteId, {
      chiefComplaintText: complaint,
    });
    const enc = await fx
      .http('post', `/pre-registrations/${b.id}/confirm`, rec.token)
      .send({ identityVerified: true })
      .expect(201);
    await fx
      .http(
        'post',
        `/encounters/${(enc.body as { id: string }).id}/cancel`,
        rec.token,
      )
      .send({ reason: cancellation })
      .expect(200);
    const nn = await fx
      .http('post', '/patients', rec.token)
      .send({ sex: 'F', estimatedAgeYears: 63, fullName: name })
      .expect(201);
    await fx
      .http('post', '/encounters', rec.token)
      .send({
        patientId: (nn.body as { id: string }).id,
        siteId: t.siteId,
        chiefComplaintText: complaint,
        complaintSource: 'TYPED',
      })
      .expect(201);

    const events = await fx.prisma.encounterEvent.findMany({
      where: { tenantId: t.id },
    });
    const audits = await fx.audits({ tenantId: t.id });
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(audits.length).toBeGreaterThanOrEqual(8);
    const stored = JSON.stringify([
      ...events.map((e) => e.payload),
      ...audits.map((x) => x.metadata),
    ]);
    for (const s of [
      name,
      p.documentNumber,
      '1985-03-04',
      complaint,
      rejection,
      cancellation,
      'fiebre',
    ]) {
      expect(stored).not.toContain(s);
    }
    for (const key of [
      'fullName',
      'documentNumber',
      'birthDate',
      'estimatedAgeYears',
      'sex',
      'chiefComplaintText',
      'reason',
      'cancellationReason',
      'rejectionReason',
    ]) {
      expect(stored).not.toContain(`"${key}"`);
    }
  });

  it('R49: los errores de F-02 son application/problem+json y no repiten en detail ni en errors[].message los valores enviados', async () => {
    const t = await fx.tenant('f02-privacy-errors');
    const rec = await fx.staff(t.id);
    const p = await fx.patientUser(t.id);
    const marker = 'zzValorClienteZZ';
    const doc = randomDoc();
    await fx
      .http('post', '/patients', rec.token)
      .send({
        documentType: 'CC',
        documentNumber: doc,
        fullName: marker,
        birthDate: '1990-01-01',
        sex: 'M',
      })
      .expect(201);
    const pre = await fx.preRegister(p, t.siteId);

    const responses = [
      await fx
        .http('patch', '/patient/profile', p.token)
        .send({ fullName: marker.repeat(20), sex: marker, [marker]: marker }),
      await fx
        .http('patch', '/patient/profile', p.token)
        .send({ birthDate: '2020-01-01' }), // 422
      await fx.http('post', '/patient/pre-registrations', p.token).send({
        siteId: marker,
        chiefComplaintText: marker.repeat(200),
        complaintSource: marker,
      }),
      await fx.http('post', '/patient/pre-registrations', p.token).send({
        siteId: t.siteId,
        chiefComplaintText: marker,
        complaintSource: 'TYPED',
      }), // 409
      await fx.http('get', `/patient/pre-registrations/${marker}`, p.token), // 404
      await fx.http(
        'get',
        `/patients?documentType=${marker}&documentNumber=${marker}`,
        rec.token,
      ),
      await fx.http('post', '/patients', rec.token).send({
        documentType: marker,
        documentNumber: marker,
        fullName: marker,
        birthDate: marker,
        sex: marker,
        estimatedAgeYears: marker,
      }),
      await fx.http('post', '/patients', rec.token).send({
        documentType: 'CC',
        documentNumber: doc,
        fullName: marker,
        birthDate: '1990-01-01',
        sex: 'M',
      }), // 409
      await fx
        .http('post', '/patients', rec.token)
        .send({ sex: 'M', birthDate: '2099-01-01', fullName: marker }), // 422
      await fx.http('get', `/pre-registrations?siteId=${marker}`, rec.token),
      await fx
        .http('post', `/pre-registrations/${pre.id}/confirm`, rec.token)
        .send({ identityVerified: marker }), // 422
      await fx
        .http('post', `/pre-registrations/${pre.id}/reject`, rec.token)
        .send({ reason: marker.repeat(40) }),
      await fx.http('post', '/encounters', rec.token).send({
        patientId: marker,
        siteId: marker,
        chiefComplaintText: marker.repeat(200),
        complaintSource: marker,
      }),
      await fx
        .http('post', `/encounters/${marker}/cancel`, rec.token)
        .send({ reason: marker }), // 404
      await fx.http(
        'get',
        `/encounters?status=${marker}&limit=${marker}`,
        rec.token,
      ),
    ];
    expect(responses.map((r) => r.status)).toEqual([
      400, 422, 400, 409, 404, 400, 400, 409, 422, 400, 422, 400, 400, 404, 400,
    ]);
    for (const res of responses) {
      expect(res.headers['content-type']).toMatch(
        /^application\/problem\+json/,
      );
      const body = JSON.parse(res.text) as {
        detail?: string;
        errors?: { message: string }[];
      };
      expect(body.detail ?? '').not.toContain(marker);
      expect(body.detail ?? '').not.toContain(doc);
      for (const e of body.errors ?? [])
        expect(e.message).not.toContain(marker);
    }
  });
});
