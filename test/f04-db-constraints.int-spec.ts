import pg from 'pg';
import { appClient, pgErrorCode, testName } from './int/db.js';

/**
 * F-04-api · permisos, FKs y CHECK de triage_suggestions, conectado como asclepio_app.
 * Las filas no se borran: asclepio_app no tiene DELETE y las FK son RESTRICT.
 */
describe('F-04: restricciones y permisos de triage_suggestions (como asclepio_app)', () => {
  let db: pg.Client;

  const one = async <T extends pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T> => (await db.query<T>(sql, params)).rows[0];

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

  interface Row {
    status: string;
    llm_level: number | null;
    suggested_level: number | null;
    explanation: object | null;
    guard_applied: boolean;
    latency_ms: number;
  }

  const OK_ROW: Row = {
    status: 'OK',
    llm_level: 3,
    suggested_level: 3,
    explanation: { summary: 'DEV-test', factors: [] },
    guard_applied: false,
    latency_ms: 120,
  };

  const suggestion = (s: Scenario, over: Partial<Row> = {}) => {
    const r = { ...OK_ROW, ...over };
    return db.query<{ id: string }>(
      `INSERT INTO asclepio.triage_suggestions
         (tenant_id, encounter_id, requested_by, input_snapshot, status, llm_level, suggested_level, explanation,
          guard_applied, prompt_version, latency_ms, attempts, created_at)
       VALUES ($1, $2, $3, '{}', $4::asclepio.triage_suggestion_status, $5, $6, $7, $8, 'triage-v1', $9, '[]', now())
       RETURNING id`,
      [
        s.tenantId,
        s.encounterId,
        s.userId,
        r.status,
        r.llm_level,
        r.suggested_level,
        r.explanation === null ? null : JSON.stringify(r.explanation),
        r.guard_applied,
        r.latency_ms,
      ],
    );
  };

  beforeAll(async () => {
    db = await appClient();
  });
  afterAll(() => db.end());

  it('R24: asclepio_app puede INSERT y SELECT en triage_suggestions, pero UPDATE, DELETE y TRUNCATE fallan con 42501', async () => {
    const s = await scenario('f04-db-grants');
    const id = (await suggestion(s)).rows[0].id;
    const sel = await db.query(
      'SELECT id FROM asclepio.triage_suggestions WHERE id = $1',
      [id],
    );
    expect(sel.rowCount).toBe(1);
    expect(
      await pgErrorCode(
        db.query(
          'UPDATE asclepio.triage_suggestions SET suggested_level = 1 WHERE id = $1',
          [id],
        ),
      ),
    ).toBe('42501');
    expect(
      await pgErrorCode(
        db.query('DELETE FROM asclepio.triage_suggestions WHERE id = $1', [id]),
      ),
    ).toBe('42501');
    expect(
      await pgErrorCode(db.query('TRUNCATE asclepio.triage_suggestions')),
    ).toBe('42501');

    const grants = await db.query<{ privilege: string }>(
      `SELECT privilege_type AS privilege FROM information_schema.role_table_grants
       WHERE grantee = 'asclepio_app' AND table_schema = 'asclepio' AND table_name = 'triage_suggestions'
       ORDER BY privilege_type`,
    );
    expect(grants.rows).toEqual([
      { privilege: 'INSERT' },
      { privilege: 'SELECT' },
    ]);
  });

  it('R24: como dueño, borrar o cambiar el id de la atención, el tenant o el usuario referenciados falla con 23503 y la fila queda intacta; todas las FK son RESTRICT', async () => {
    const owner = new pg.Client({ connectionString: process.env.DIRECT_URL });
    await owner.connect();
    try {
      const s = await scenario('f04-db-fk');
      const id = (await suggestion(s)).rows[0].id;
      const snapshot = async () =>
        (
          await owner.query<Record<string, unknown>>(
            'SELECT * FROM asclepio.triage_suggestions WHERE id = $1',
            [id],
          )
        ).rows;
      const before = await snapshot();
      expect(before).toHaveLength(1);
      for (const [table, ref] of [
        ['encounters', s.encounterId],
        ['users', s.userId],
        ['tenants', s.tenantId],
      ]) {
        for (const sql of [
          `UPDATE asclepio.${table} SET id = gen_random_uuid() WHERE id = $1`,
          `DELETE FROM asclepio.${table} WHERE id = $1`,
        ]) {
          const code = await pgErrorCode(owner.query(sql, [ref]));
          expect([sql, code]).toEqual([sql, '23503']);
        }
      }
      expect(await snapshot()).toEqual(before);
    } finally {
      await owner.end();
    }

    const fks = await db.query<{ conname: string; del: string; upd: string }>(
      `SELECT conname, confdeltype AS del, confupdtype AS upd FROM pg_constraint
       WHERE conrelid = 'asclepio.triage_suggestions'::regclass AND contype = 'f' ORDER BY conname`,
    );
    expect(fks.rows).toEqual([
      {
        conname: 'triage_suggestions_encounter_id_tenant_id_fkey',
        del: 'r',
        upd: 'r',
      },
      { conname: 'triage_suggestions_requested_by_fkey', del: 'r', upd: 'r' },
      { conname: 'triage_suggestions_tenant_id_fkey', del: 'r', upd: 'r' },
    ]);
  });

  it('R24: la FK compuesta impide una sugerencia con la atención de otro tenant', async () => {
    const a = await scenario('f04-db-xt-a');
    const b = await scenario('f04-db-xt-b');
    expect(
      await pgErrorCode(suggestion({ ...a, encounterId: b.encounterId })),
    ).toBe('23503');
  });

  it('R19: CHECK: suggested_level mayor (menos grave) que llm_level falla con 23514', async () => {
    const s = await scenario('f04-db-chk-guard');
    expect(
      await pgErrorCode(
        suggestion(s, {
          llm_level: 2,
          suggested_level: 3,
          guard_applied: false,
        }),
      ),
    ).toBe('23514');
    // Un guard que sube la gravedad sí cabe.
    await expect(
      suggestion(s, { llm_level: 4, suggested_level: 2, guard_applied: true }),
    ).resolves.toBeDefined();
  });

  it('R19: CHECK: coherencia de status con niveles y explicación, rangos 1–5, guard_applied y latency_ms', async () => {
    const s = await scenario('f04-db-chk');
    const bad: Partial<Row>[] = [
      // OK sin nivel, sin nivel sugerido o sin explicación.
      { llm_level: null, suggested_level: null },
      { suggested_level: null },
      { explanation: null },
      // status distinto de OK con niveles o explicación.
      { status: 'INVALID_OUTPUT' },
      // Rangos.
      { llm_level: 0, suggested_level: 0 },
      { llm_level: 6, suggested_level: 5, guard_applied: true },
      { llm_level: 5, suggested_level: 0, guard_applied: true },
      // guard_applied incoherente.
      { llm_level: 3, suggested_level: 3, guard_applied: true },
      { llm_level: 4, suggested_level: 2, guard_applied: false },
      { latency_ms: -1 },
    ];
    for (const over of bad) {
      const code = await pgErrorCode(suggestion(s, over));
      expect([over, code]).toEqual([over, '23514']);
    }
    for (const status of ['INVALID_OUTPUT', 'TIMEOUT', 'FAILED']) {
      await expect(
        suggestion(s, {
          status,
          llm_level: null,
          suggested_level: null,
          explanation: null,
          latency_ms: 0,
        }),
      ).resolves.toBeDefined();
    }
  });
});
