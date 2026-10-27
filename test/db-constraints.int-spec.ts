import pg from 'pg';
import { appClient, pgErrorCode, testName } from './int/db.js';

describe('Restricciones y permisos de la base (como asclepio_app)', () => {
  let db: pg.Client;
  let tenantId: string;

  beforeAll(async () => {
    db = await appClient();
    const res = await db.query<{ id: string }>(
      'INSERT INTO asclepio.tenants (name) VALUES ($1) RETURNING id',
      [testName('constraints')],
    );
    tenantId = res.rows[0].id;
  });

  afterAll(async () => {
    await db.query('DELETE FROM asclepio.users WHERE tenant_id = $1', [
      tenantId,
    ]);
    await db.end();
  });

  const insertUser = (tenant: string | null, role: string) =>
    db.query(
      `INSERT INTO asclepio.users (tenant_id, email, password_hash, full_name, role)
       VALUES ($1, $2, 'x', 'DEV-test', $3::asclepio.user_role)`,
      [tenant, `dev-test-${Date.now()}-${Math.random()}@example.test`, role],
    );

  it('R14: users.role solo admite RECEPTION, NURSE, PHYSICIAN o ADMIN', async () => {
    for (const role of ['RECEPTION', 'NURSE', 'PHYSICIAN', 'ADMIN']) {
      await expect(insertUser(tenantId, role)).resolves.toBeDefined();
    }
    expect(await pgErrorCode(insertUser(tenantId, 'SUPERUSER'))).toBe('22P02');
  });

  it('R14: users.tenant_id es obligatorio', async () => {
    expect(await pgErrorCode(insertUser(null, 'NURSE'))).toBe('23502');
  });

  it('R34: asclepio_app puede INSERT y SELECT en audit_log, pero UPDATE y DELETE fallan con permiso denegado', async () => {
    const ins = await db.query<{ id: string }>(
      `INSERT INTO asclepio.audit_log (tenant_id, action, entity) VALUES ($1, 'DEV_TEST', 'test') RETURNING id`,
      [tenantId],
    );
    const id = ins.rows[0].id;
    const sel = await db.query(
      'SELECT id FROM asclepio.audit_log WHERE id = $1',
      [id],
    );
    expect(sel.rowCount).toBe(1);
    expect(
      await pgErrorCode(
        db.query(`UPDATE asclepio.audit_log SET action = 'X' WHERE id = $1`, [
          id,
        ]),
      ),
    ).toBe('42501');
    expect(
      await pgErrorCode(
        db.query('DELETE FROM asclepio.audit_log WHERE id = $1', [id]),
      ),
    ).toBe('42501');
    expect(await pgErrorCode(db.query('TRUNCATE asclepio.audit_log'))).toBe(
      '42501',
    );
  });

  it('R34: con asclepio_app, borrar o cambiar el id de un tenant con filas en audit_log falla y esas filas quedan intactas', async () => {
    const t = await db.query<{ id: string }>(
      'INSERT INTO asclepio.tenants (name) VALUES ($1) RETURNING id',
      [testName('audit-fk')],
    );
    const tid = t.rows[0].id;
    const ins = await db.query<{ id: string }>(
      `INSERT INTO asclepio.audit_log (tenant_id, action, entity) VALUES ($1, 'DEV_TEST', 'test') RETURNING id`,
      [tid],
    );
    const auditId = ins.rows[0].id;
    const snapshot = () =>
      db.query('SELECT * FROM asclepio.audit_log WHERE id = $1', [auditId]);
    const before = (await snapshot()).rows;

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
    expect(before[0]).toMatchObject({ tenant_id: tid });
  });
});
