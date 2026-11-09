import pg from 'pg';
import { appClient, pgErrorCode, testName } from './int/db.js';

/**
 * F-02-api · restricciones, índices parciales y permisos de la base, conectado como asclepio_app.
 * Las filas de encounters, pre_registrations y encounter_events no se borran (sin DELETE para asclepio_app y RESTRICT).
 */
describe('F-02: restricciones y permisos de la base (como asclepio_app)', () => {
  let db: pg.Client;
  let tenantId: string;
  let siteId: string;
  let userId: string;

  const one = async <T extends pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T> => (await db.query<T>(sql, params)).rows[0];

  const newTenant = async (label: string) =>
    (
      await one<{ id: string }>(
        'INSERT INTO asclepio.tenants (name) VALUES ($1) RETURNING id',
        [testName(label)],
      )
    ).id;

  const patient = async (
    tenant: string,
    doc: string | null = String(Math.floor(1e9 + Math.random() * 9e9)),
  ) =>
    (
      await one<{ id: string }>(
        `INSERT INTO asclepio.patients (tenant_id, document_type, document_number, full_name, birth_date, sex)
         VALUES ($1, $2, $3, 'DEV-test', '1980-01-01', 'F') RETURNING id`,
        [tenant, doc === null ? null : 'CC', doc],
      )
    ).id;

  // En TRIAGED, IN_CARE y CLOSED fija también el nivel final que exige el CHECK de F-05 (R11).
  const encounter = (patientId: string, status = 'WAITING_TRIAGE') =>
    db.query<{ id: string }>(
      `INSERT INTO asclepio.encounters
         (tenant_id, site_id, patient_id, status, origin, arrival_at, chief_complaint_text, complaint_source, registered_by,
          final_level, triaged_at, triaged_by)
       SELECT $1, $2, $3, s, 'DIRECT', now(), 'DEV-test', 'TYPED', $5,
              CASE WHEN f THEN 3 END, CASE WHEN f THEN now() END, CASE WHEN f THEN $5::uuid END
       FROM (SELECT $4::asclepio.encounter_status AS s) x,
            LATERAL (SELECT x.s IN ('TRIAGED', 'IN_CARE', 'CLOSED') AS f) y
       RETURNING id`,
      [tenantId, siteId, patientId, status, userId],
    );

  const preRegistration = (patientId: string, status = 'PENDING') =>
    db.query(
      `INSERT INTO asclepio.pre_registrations
         (tenant_id, patient_id, site_id, chief_complaint_text, complaint_source, status, pre_registered_at, expires_at)
       VALUES ($1, $2, $3, 'DEV-test', 'TYPED', $4::asclepio.pre_registration_status, now(), now() + interval '6 hours')`,
      [tenantId, patientId, siteId, status],
    );

  const event = (
    encounterId: string,
    actorType: string,
    actorId: string | null,
    tenant = tenantId,
  ) =>
    db.query<{ id: string }>(
      `INSERT INTO asclepio.encounter_events (tenant_id, encounter_id, type, to_status, actor_type, actor_id, occurred_at)
       VALUES ($1, $2, 'STATUS_CHANGED', 'WAITING_TRIAGE', $3::asclepio.actor_type, $4, now()) RETURNING id`,
      [tenant, encounterId, actorType, actorId],
    );

  beforeAll(async () => {
    db = await appClient();
    tenantId = await newTenant('f02-db');
    siteId = (
      await one<{ id: string }>(
        `INSERT INTO asclepio.sites (tenant_id, name) VALUES ($1, 'DEV-test sede') RETURNING id`,
        [tenantId],
      )
    ).id;
    userId = (
      await one<{ id: string }>(
        `INSERT INTO asclepio.users (tenant_id, email, password_hash, full_name, role)
         VALUES ($1, $2, 'x', 'DEV-test', 'RECEPTION') RETURNING id`,
        [tenantId, `dev-test-${Date.now()}-${Math.random()}@example.test`],
      )
    ).id;
  });

  afterAll(() => db.end());

  it('R40: asclepio_app puede INSERT y SELECT en encounter_events, pero UPDATE, DELETE y TRUNCATE fallan con 42501', async () => {
    const enc = (await encounter(await patient(tenantId))).rows[0].id;
    const id = (await event(enc, 'STAFF', userId)).rows[0].id;
    const sel = await db.query(
      'SELECT id FROM asclepio.encounter_events WHERE id = $1',
      [id],
    );
    expect(sel.rowCount).toBe(1);
    expect(
      await pgErrorCode(
        db.query(
          `UPDATE asclepio.encounter_events SET type = 'X' WHERE id = $1`,
          [id],
        ),
      ),
    ).toBe('42501');
    expect(
      await pgErrorCode(
        db.query('DELETE FROM asclepio.encounter_events WHERE id = $1', [id]),
      ),
    ).toBe('42501');
    expect(
      await pgErrorCode(db.query('TRUNCATE asclepio.encounter_events')),
    ).toBe('42501');
    // D13: tampoco se borran atenciones ni pre-registros.
    expect(
      await pgErrorCode(
        db.query('DELETE FROM asclepio.encounters WHERE id = $1', [enc]),
      ),
    ).toBe('42501');
    expect(
      await pgErrorCode(
        db.query('DELETE FROM asclepio.pre_registrations WHERE id = $1', [
          '00000000-0000-4000-8000-000000000000',
        ]),
      ),
    ).toBe('42501');
  });

  it('R40: borrar o cambiar el id de la atención o del tenant con eventos falla por FK y los eventos quedan intactos', async () => {
    const tid = await newTenant('f02-db-fk');
    const sid = (
      await one<{ id: string }>(
        `INSERT INTO asclepio.sites (tenant_id, name) VALUES ($1, 'DEV-test sede') RETURNING id`,
        [tid],
      )
    ).id;
    const uid = (
      await one<{ id: string }>(
        `INSERT INTO asclepio.users (tenant_id, email, password_hash, full_name, role)
         VALUES ($1, $2, 'x', 'DEV-test', 'RECEPTION') RETURNING id`,
        [tid, `dev-test-${Date.now()}-${Math.random()}@example.test`],
      )
    ).id;
    const pid = await patient(tid);
    const enc = (
      await one<{ id: string }>(
        `INSERT INTO asclepio.encounters
           (tenant_id, site_id, patient_id, status, origin, arrival_at, chief_complaint_text, complaint_source, registered_by)
         VALUES ($1, $2, $3, 'WAITING_TRIAGE', 'DIRECT', now(), 'DEV-test', 'TYPED', $4) RETURNING id`,
        [tid, sid, pid, uid],
      )
    ).id;
    const ev = (await event(enc, 'STAFF', uid, tid)).rows[0].id;
    const snapshot = () =>
      db.query('SELECT * FROM asclepio.encounter_events WHERE id = $1', [ev]);
    const before = (await snapshot()).rows;

    expect(
      await pgErrorCode(
        db.query(
          'UPDATE asclepio.encounters SET id = gen_random_uuid() WHERE id = $1',
          [enc],
        ),
      ),
    ).toBe('23503');
    expect(
      await pgErrorCode(
        db.query('DELETE FROM asclepio.tenants WHERE id = $1', [tid]),
      ),
    ).toBe('23503');
    expect(
      await pgErrorCode(
        db.query(
          'UPDATE asclepio.tenants SET id = gen_random_uuid() WHERE id = $1',
          [tid],
        ),
      ),
    ).toBe('23503');
    expect((await snapshot()).rows).toEqual(before);

    // Las dos FKs de encounter_events son RESTRICT/RESTRICT (nunca CASCADE ni SET NULL).
    const fks = await db.query<{ conname: string; del: string; upd: string }>(
      `SELECT conname, confdeltype AS del, confupdtype AS upd FROM pg_constraint
       WHERE conrelid = 'asclepio.encounter_events'::regclass AND contype = 'f' ORDER BY conname`,
    );
    expect(fks.rows).toEqual([
      {
        conname: 'encounter_events_encounter_id_tenant_id_fkey',
        del: 'r',
        upd: 'r',
      },
      { conname: 'encounter_events_tenant_id_fkey', del: 'r', upd: 'r' },
    ]);
  });

  // Corrección 1 de F-02 (observación del reviewer): con ON UPDATE CASCADE, cambiar el id de la sede, el paciente,
  // el usuario o el tenant reescribía encounters y pre_registrations sin evento ni auditoría.
  it('R40: cambiar el id de la sede, el paciente, el usuario o el tenant referenciados por atenciones y pre-registros falla con 23503 y las filas quedan intactas', async () => {
    const tid = await newTenant('f02-db-fk-upd');
    const sid = (
      await one<{ id: string }>(
        `INSERT INTO asclepio.sites (tenant_id, name) VALUES ($1, 'DEV-test sede') RETURNING id`,
        [tid],
      )
    ).id;
    const uid = (
      await one<{ id: string }>(
        `INSERT INTO asclepio.users (tenant_id, email, password_hash, full_name, role)
         VALUES ($1, $2, 'x', 'DEV-test', 'RECEPTION') RETURNING id`,
        [tid, `dev-test-${Date.now()}-${Math.random()}@example.test`],
      )
    ).id;
    const encPatient = await patient(tid);
    const prePatient = await patient(tid);
    const enc = (
      await one<{ id: string }>(
        `INSERT INTO asclepio.encounters
           (tenant_id, site_id, patient_id, status, origin, arrival_at, chief_complaint_text, complaint_source, registered_by)
         VALUES ($1, $2, $3, 'WAITING_TRIAGE', 'DIRECT', now(), 'DEV-test', 'TYPED', $4) RETURNING id`,
        [tid, sid, encPatient, uid],
      )
    ).id;
    const pre = (
      await one<{ id: string }>(
        `INSERT INTO asclepio.pre_registrations
           (tenant_id, patient_id, site_id, chief_complaint_text, complaint_source, status,
            pre_registered_at, expires_at, resolved_at, resolved_by, rejection_reason)
         VALUES ($1, $2, $3, 'DEV-test', 'TYPED', 'REJECTED', now(), now() + interval '6 hours', now(), $4, 'DEV-test')
         RETURNING id`,
        [tid, prePatient, sid, uid],
      )
    ).id;
    const snapshot = async () => ({
      encounter: (
        await db.query('SELECT * FROM asclepio.encounters WHERE id = $1', [enc])
      ).rows,
      preRegistration: (
        await db.query(
          'SELECT * FROM asclepio.pre_registrations WHERE id = $1',
          [pre],
        )
      ).rows,
    });
    const before = await snapshot();
    expect(before.encounter).toHaveLength(1);
    expect(before.preRegistration).toHaveLength(1);

    for (const [table, id] of [
      ['sites', sid],
      ['patients', encPatient],
      ['patients', prePatient],
      ['users', uid],
      ['tenants', tid],
    ]) {
      const code = await pgErrorCode(
        db.query(
          `UPDATE asclepio.${table} SET id = gen_random_uuid() WHERE id = $1`,
          [id],
        ),
      );
      expect([table, code]).toEqual([table, '23503']);
    }
    expect(await snapshot()).toEqual(before);

    // Ninguna FK del esquema asclepio queda con CASCADE, SET NULL ni SET DEFAULT (r = RESTRICT).
    const loose = await db.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE contype = 'f' AND connamespace = 'asclepio'::regnamespace
         AND (confupdtype <> 'r' OR confdeltype <> 'r')`,
    );
    expect(loose.rows).toEqual([]);
  });

  it('R40: el CHECK de encounter_events exige actor_id NULL si y solo si el actor es SYSTEM', async () => {
    const enc = (await encounter(await patient(tenantId))).rows[0].id;
    expect(await pgErrorCode(event(enc, 'SYSTEM', userId))).toBe('23514');
    expect(await pgErrorCode(event(enc, 'STAFF', null))).toBe('23514');
    await expect(event(enc, 'SYSTEM', null)).resolves.toBeDefined();
  });

  it('R8: el índice único parcial admite un solo pre-registro PENDING por paciente', async () => {
    const p = await patient(tenantId);
    await preRegistration(p);
    expect(await pgErrorCode(preRegistration(p))).toBe('23505');
    // Los no pendientes no cuentan.
    await expect(preRegistration(p, 'EXPIRED')).resolves.toBeDefined();
    await expect(preRegistration(p, 'REJECTED')).resolves.toBeDefined();
  });

  it('R9: el índice único parcial admite una sola atención activa por paciente; las terminales no cuentan', async () => {
    const p = await patient(tenantId);
    await encounter(p, 'CANCELLED');
    await encounter(p, 'CLOSED');
    await encounter(p, 'WAITING_TRIAGE');
    expect(await pgErrorCode(encounter(p, 'REGISTERED'))).toBe('23505');
    expect(await pgErrorCode(encounter(p, 'IN_CARE'))).toBe('23505');
  });

  it('R32: dos atenciones activas simultáneas del mismo paciente: la base solo admite una', async () => {
    const p = await patient(tenantId);
    const other = await appClient();
    try {
      const insert = (c: pg.Client) =>
        c.query(
          `INSERT INTO asclepio.encounters
             (tenant_id, site_id, patient_id, status, origin, arrival_at, chief_complaint_text, complaint_source, registered_by)
           VALUES ($1, $2, $3, 'WAITING_TRIAGE', 'DIRECT', now(), 'DEV-test', 'TYPED', $4)`,
          [tenantId, siteId, p, userId],
        );
      const codes = await Promise.all([
        pgErrorCode(insert(db)),
        pgErrorCode(insert(other)),
      ]);
      expect(codes.sort()).toEqual(['23505', 'no-error']);
    } finally {
      await other.end();
    }
  });

  it('R27: se admiten varios pacientes NN en el mismo tenant y los CHECK de documento y edad estimada se cumplen', async () => {
    const nn = () =>
      db.query(
        `INSERT INTO asclepio.patients (tenant_id, sex, estimated_age_years) VALUES ($1, 'M', 40)`,
        [tenantId],
      );
    await nn();
    await nn();
    // Tipo sin número (o al revés) → CHECK.
    expect(
      await pgErrorCode(
        db.query(
          `INSERT INTO asclepio.patients (tenant_id, document_type, sex) VALUES ($1, 'CC', 'M')`,
          [tenantId],
        ),
      ),
    ).toBe('23514');
    expect(
      await pgErrorCode(
        db.query(
          `INSERT INTO asclepio.patients (tenant_id, document_number, sex) VALUES ($1, '123', 'M')`,
          [tenantId],
        ),
      ),
    ).toBe('23514');
    // Edad estimada con documento, con fecha de nacimiento o fuera de 0–120 → CHECK.
    for (const sql of [
      `INSERT INTO asclepio.patients (tenant_id, document_type, document_number, sex, estimated_age_years) VALUES ($1, 'CC', '9${Date.now()}', 'M', 30)`,
      `INSERT INTO asclepio.patients (tenant_id, birth_date, sex, estimated_age_years) VALUES ($1, '1990-01-01', 'M', 30)`,
      `INSERT INTO asclepio.patients (tenant_id, sex, estimated_age_years) VALUES ($1, 'M', 121)`,
      `INSERT INTO asclepio.patients (tenant_id, sex, estimated_age_years) VALUES ($1, 'M', -1)`,
    ]) {
      expect(await pgErrorCode(db.query(sql, [tenantId]))).toBe('23514');
    }
  });

  it('R28: el mismo documento se admite en dos tenants, pero no dos veces en el mismo', async () => {
    const other = await newTenant('f02-db-doc');
    const doc = String(Math.floor(1e9 + Math.random() * 9e9));
    await patient(tenantId, doc);
    await expect(patient(other, doc)).resolves.toBeDefined();
    expect(await pgErrorCode(patient(tenantId, doc))).toBe('23505');
  });
});
