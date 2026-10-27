import pg from 'pg';
import { appClient, pgErrorCode, testName } from './int/db.js';

/**
 * F-03-api · permisos, FKs y CHECK técnicos de vital_signs y symptom_findings, conectado como asclepio_app.
 * Las filas no se borran: asclepio_app no tiene DELETE y las FK son RESTRICT (design.md, "Datos de prueba").
 */
describe('F-03: restricciones y permisos de la base (como asclepio_app)', () => {
  let db: pg.Client;

  const one = async <T extends pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T> => (await db.query<T>(sql, params)).rows[0];

  /** Tenant, sede, usuario, paciente y atención propios: cada prueba de FK cambia ids sin afectar a las demás. */
  async function scenario(label: string) {
    const tenantId = (
      await one<{ id: string }>(
        'INSERT INTO asclepio.tenants (name) VALUES ($1) RETURNING id',
        [testName(label)],
      )
    ).id;
    const siteId = (
      await one<{ id: string }>(
        `INSERT INTO asclepio.sites (tenant_id, name) VALUES ($1, 'DEV-test sede') RETURNING id`,
        [tenantId],
      )
    ).id;
    const userId = (
      await one<{ id: string }>(
        `INSERT INTO asclepio.users (tenant_id, email, password_hash, full_name, role)
         VALUES ($1, $2, 'x', 'DEV-test', 'NURSE') RETURNING id`,
        [tenantId, `dev-test-${Date.now()}-${Math.random()}@example.test`],
      )
    ).id;
    const patientId = (
      await one<{ id: string }>(
        `INSERT INTO asclepio.patients (tenant_id, sex, estimated_age_years) VALUES ($1, 'F', 40) RETURNING id`,
        [tenantId],
      )
    ).id;
    const encounterId = (
      await one<{ id: string }>(
        `INSERT INTO asclepio.encounters
           (tenant_id, site_id, patient_id, status, origin, arrival_at, chief_complaint_text, complaint_source, registered_by)
         VALUES ($1, $2, $3, 'WAITING_TRIAGE', 'DIRECT', now(), 'DEV-test', 'TYPED', $4) RETURNING id`,
        [tenantId, siteId, patientId, userId],
      )
    ).id;
    return { tenantId, siteId, userId, patientId, encounterId };
  }

  type Scenario = Awaited<ReturnType<typeof scenario>>;

  const vital = (s: Scenario, heartRate: number | null = 80) =>
    db.query<{ id: string }>(
      `INSERT INTO asclepio.vital_signs (tenant_id, encounter_id, heart_rate, recorded_at, recorded_by)
       VALUES ($1, $2, $3, now(), $4) RETURNING id`,
      [s.tenantId, s.encounterId, heartRate, s.userId],
    );

  const finding = (s: Scenario, description = 'DEV-test tos seca') =>
    db.query<{ id: string }>(
      `INSERT INTO asclepio.symptom_findings (tenant_id, encounter_id, kind, description, recorded_at, recorded_by)
       VALUES ($1, $2, 'SYMPTOM', $3, now(), $4) RETURNING id`,
      [s.tenantId, s.encounterId, description, s.userId],
    );

  beforeAll(async () => {
    db = await appClient();
  });
  afterAll(() => db.end());

  it('R19: asclepio_app puede INSERT y SELECT en vital_signs, pero UPDATE y DELETE fallan con 42501', async () => {
    const s = await scenario('f03-db-vs');
    const id = (await vital(s)).rows[0].id;
    const sel = await db.query(
      'SELECT id FROM asclepio.vital_signs WHERE id = $1',
      [id],
    );
    expect(sel.rowCount).toBe(1);
    expect(
      await pgErrorCode(
        db.query(
          'UPDATE asclepio.vital_signs SET heart_rate = 90 WHERE id = $1',
          [id],
        ),
      ),
    ).toBe('42501');
    expect(
      await pgErrorCode(
        db.query('DELETE FROM asclepio.vital_signs WHERE id = $1', [id]),
      ),
    ).toBe('42501');
    expect(await pgErrorCode(db.query('TRUNCATE asclepio.vital_signs'))).toBe(
      '42501',
    );
  });

  it('R19: asclepio_app puede INSERT y SELECT en symptom_findings, pero UPDATE y DELETE fallan con 42501', async () => {
    const s = await scenario('f03-db-sf');
    const id = (await finding(s)).rows[0].id;
    const sel = await db.query(
      'SELECT id FROM asclepio.symptom_findings WHERE id = $1',
      [id],
    );
    expect(sel.rowCount).toBe(1);
    expect(
      await pgErrorCode(
        db.query(
          `UPDATE asclepio.symptom_findings SET description = 'x' WHERE id = $1`,
          [id],
        ),
      ),
    ).toBe('42501');
    expect(
      await pgErrorCode(
        db.query('DELETE FROM asclepio.symptom_findings WHERE id = $1', [id]),
      ),
    ).toBe('42501');
    expect(
      await pgErrorCode(db.query('TRUNCATE asclepio.symptom_findings')),
    ).toBe('42501');
  });

  it('R19: asclepio_app solo tiene SELECT e INSERT sobre vital_signs y symptom_findings', async () => {
    const grants = await db.query<{ table_name: string; privilege: string }>(
      `SELECT table_name, privilege_type AS privilege FROM information_schema.role_table_grants
       WHERE grantee = 'asclepio_app' AND table_schema = 'asclepio'
         AND table_name IN ('vital_signs', 'symptom_findings')
       ORDER BY table_name, privilege_type`,
    );
    expect(grants.rows).toEqual([
      { table_name: 'symptom_findings', privilege: 'INSERT' },
      { table_name: 'symptom_findings', privilege: 'SELECT' },
      { table_name: 'vital_signs', privilege: 'INSERT' },
      { table_name: 'vital_signs', privilege: 'SELECT' },
    ]);
  });

  it('R19: como dueño, borrar o cambiar el id de la atención, el tenant o el usuario referenciados por una toma y un hallazgo falla con 23503 y las filas quedan intactas', async () => {
    const owner = new pg.Client({ connectionString: process.env.DIRECT_URL });
    await owner.connect();
    try {
      const s = await scenario('f03-db-fk');
      const vs = (await vital(s)).rows[0].id;
      const sf = (await finding(s)).rows[0].id;
      const snapshot = async () => ({
        vs: (
          await owner.query(
            'SELECT * FROM asclepio.vital_signs WHERE id = $1',
            [vs],
          )
        ).rows,
        sf: (
          await owner.query(
            'SELECT * FROM asclepio.symptom_findings WHERE id = $1',
            [sf],
          )
        ).rows,
      });
      const before = await snapshot();
      expect(before.vs).toHaveLength(1);
      expect(before.sf).toHaveLength(1);

      for (const [table, id] of [
        ['encounters', s.encounterId],
        ['users', s.userId],
        ['tenants', s.tenantId],
      ]) {
        for (const sql of [
          `UPDATE asclepio.${table} SET id = gen_random_uuid() WHERE id = $1`,
          `DELETE FROM asclepio.${table} WHERE id = $1`,
        ]) {
          const code = await pgErrorCode(owner.query(sql, [id]));
          expect([sql, code]).toEqual([sql, '23503']);
        }
      }
      expect(await snapshot()).toEqual(before);
    } finally {
      await owner.end();
    }

    // Las tres FKs de cada tabla son RESTRICT/RESTRICT (r), nunca CASCADE ni SET NULL.
    for (const table of ['vital_signs', 'symptom_findings']) {
      const fks = await db.query<{ conname: string; del: string; upd: string }>(
        `SELECT conname, confdeltype AS del, confupdtype AS upd FROM pg_constraint
         WHERE conrelid = $1::regclass AND contype = 'f' ORDER BY conname`,
        [`asclepio.${table}`],
      );
      expect(fks.rows).toEqual([
        { conname: `${table}_encounter_id_tenant_id_fkey`, del: 'r', upd: 'r' },
        { conname: `${table}_recorded_by_fkey`, del: 'r', upd: 'r' },
        { conname: `${table}_tenant_id_fkey`, del: 'r', upd: 'r' },
      ]);
    }
  });

  it('R19: la FK compuesta impide una toma o un hallazgo con la atención de otro tenant', async () => {
    const a = await scenario('f03-db-xt-a');
    const b = await scenario('f03-db-xt-b');
    const mixed = { ...a, encounterId: b.encounterId };
    expect(await pgErrorCode(vital(mixed))).toBe('23503');
    expect(await pgErrorCode(finding(mixed))).toBe('23503');
  });

  it('R1: CHECK técnico: una toma sin ningún signo falla con 23514', async () => {
    const s = await scenario('f03-db-chk-vs');
    expect(await pgErrorCode(vital(s, null))).toBe('23514');
    await expect(vital(s, 70)).resolves.toBeDefined();
  });

  it('R7: CHECK técnico: description vacía, solo con espacios o de más de 500 caracteres falla con 23514', async () => {
    const s = await scenario('f03-db-chk-sf');
    for (const d of ['', '   ', 'a'.repeat(501)]) {
      expect(await pgErrorCode(finding(s, d))).toBe('23514');
    }
    await expect(finding(s, ` ${'a'.repeat(500)} `)).resolves.toBeDefined();
    // Sin columna code (PA-F03-3).
    const cols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'asclepio' AND table_name = 'symptom_findings' AND column_name = 'code'`,
    );
    expect(cols.rows).toEqual([]);
  });
});
