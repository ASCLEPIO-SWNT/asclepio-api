import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import { createApp, problem } from './e2e-app.js';
import { F02Fixtures } from './int/f02-fixtures.js';

const NOW = new Date('2026-10-26T15:00:00.000Z');

describe('GET/PATCH /api/v1/patient/profile (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let t: { id: string };

  beforeAll(async () => {
    app = await createApp({
      overrides: [{ provide: Clock, useValue: new FixedClock(NOW) }],
    });
    fx = new F02Fixtures(app);
    t = await fx.tenant('f02-profile');
  });
  afterAll(() => app.close());

  const row = (id: string) =>
    fx.prisma.patient.findUniqueOrThrow({ where: { id } });

  it('R1: devuelve el perfil del paciente del token (pid y tenant), con editable = true mientras identity_verified_at sea NULL, e ignora ids de la petición', async () => {
    const p = await fx.patientUser(t.id);
    const other = await fx.patientUser(t.id, { fullName: 'DEV-test Otro' });
    // Un patientId en la query se ignora: siempre es el paciente del token.
    const ignored = await fx
      .http('get', `/patient/profile?patientId=${other.patientId}`, p.token)
      .expect(200);
    expect(ignored.body).toMatchObject({ id: p.patientId });
    const ok = await fx.http('get', '/patient/profile', p.token).expect(200);
    expect(ok.body).toEqual({
      id: p.patientId,
      documentType: 'CC',
      documentNumber: p.documentNumber,
      fullName: 'DEV-test Paciente App',
      birthDate: '1985-03-04',
      sex: 'F',
      editable: true,
    });
    const verified = await fx.patientUser(t.id, { verifiedAt: NOW });
    const v = await fx
      .http('get', '/patient/profile', verified.token)
      .expect(200);
    expect(v.body).toMatchObject({ editable: false });
  });

  it('R2: actualiza solo los campos enviados, audita PATIENT_UPDATED (PATIENT, cuenta, fields) en la misma transacción y responde el perfil', async () => {
    const p = await fx.patientUser(t.id);
    const res = await fx
      .http('patch', '/patient/profile', p.token)
      .send({ fullName: 'DEV-test Nombre Corregido', sex: 'X' })
      .expect(200);
    expect(res.body).toMatchObject({
      id: p.patientId,
      fullName: 'DEV-test Nombre Corregido',
      sex: 'X',
      birthDate: '1985-03-04',
      documentNumber: p.documentNumber,
      editable: true,
    });
    const r = await row(p.patientId);
    expect(r).toMatchObject({
      fullName: 'DEV-test Nombre Corregido',
      sex: 'X',
      documentType: 'CC',
    });
    const audits = await fx.audits({
      entityId: p.patientId,
      action: 'PATIENT_UPDATED',
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: 'PATIENT',
      actorId: p.accountId,
      tenantId: t.id,
      entity: 'patient',
      metadata: { fields: ['fullName', 'sex'] },
    });
    await fx
      .http('patch', '/patient/profile', p.token)
      .send({ birthDate: '1984-12-31' })
      .expect(200)
      .expect((r2) =>
        expect(r2.body).toMatchObject({ birthDate: '1984-12-31' }),
      );
  });

  it('R3: si identity_verified_at no es NULL responde 409 sin modificar filas ni auditar', async () => {
    const p = await fx.patientUser(t.id, { verifiedAt: NOW });
    const before = await row(p.patientId);
    const res = await fx
      .http('patch', '/patient/profile', p.token)
      .send({ fullName: 'DEV-test Cambio' })
      .expect(409);
    expect(problem(res).status).toBe(409);
    expect(await row(p.patientId)).toEqual(before);
    expect(
      await fx.audits({ entityId: p.patientId, action: 'PATIENT_UPDATED' }),
    ).toHaveLength(0);
  });

  it.each([
    ['vacío', {}, 'body'],
    ['con documentType', { documentType: 'CE' }, 'documentType'],
    ['con documentNumber', { documentNumber: '1' }, 'documentNumber'],
    ['con un campo no declarado', { email: 'x@example.test' }, 'email'],
    ['con fullName vacío', { fullName: '' }, 'fullName'],
    ['con fullName de más de 200', { fullName: 'a'.repeat(201) }, 'fullName'],
    ['con fullName null', { fullName: null }, 'fullName'],
    ['con birthDate inválida', { birthDate: '1990-13-01' }, 'birthDate'],
    ['con birthDate en otro formato', { birthDate: '01/02/1990' }, 'birthDate'],
    ['con sex no admitido', { sex: 'H' }, 'sex'],
  ])(
    'R4: PATCH %s responde 400 con el campo en errors[] sin modificar filas',
    async (_l, body, field) => {
      const p = await fx.patientUser(t.id);
      const before = await row(p.patientId);
      const res = await fx
        .http('patch', '/patient/profile', p.token)
        .send(body)
        .expect(400);
      expect(problem(res).errors?.map((e) => e.field)).toContain(field);
      expect(await row(p.patientId)).toEqual(before);
    },
  );

  it('R4: una birthDate de menos de 18 años en Bogotá (incluida una futura) responde 422 sin modificar filas', async () => {
    const p = await fx.patientUser(t.id);
    const before = await row(p.patientId);
    for (const birthDate of ['2008-10-27', '2030-01-01']) {
      const res = await fx
        .http('patch', '/patient/profile', p.token)
        .send({ birthDate })
        .expect(422);
      expect(problem(res).status).toBe(422);
    }
    expect(await row(p.patientId)).toEqual(before);
    await fx
      .http('patch', '/patient/profile', p.token)
      .send({ birthDate: '2008-10-26' })
      .expect(200);
  });
});
