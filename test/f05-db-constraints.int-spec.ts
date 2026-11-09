import pg from 'pg';
import { appClient, pgErrorCode, testName } from './int/db.js';

/**
 * F-05-api · permisos, FKs y CHECK de triage_decisions y de las columnas de triage de encounters, conectado como
 * asclepio_app. Las filas no se borran: asclepio_app no tiene DELETE y las FK son RESTRICT.
 */
describe('F-05: restricciones y permisos de triage_decisions y encounters (como asclepio_app)', () => {
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
    const encounter = async () => {
      const patientId = (
        await one<{ id: string }>(
          `INSERT INTO asclepio.patients (tenant_id, sex, estimated_age_years) VALUES ($1, 'F', 40) RETURNING id`,
          [tenantId],
        )
      ).id;
      return (
        await one<{ id: string }>(
          `INSERT INTO asclepio.encounters
             (tenant_id, site_id, patient_id, status, origin, arrival_at, chief_complaint_text, complaint_source, registered_by)
           VALUES ($1, $2, $3, 'WAITING_TRIAGE', 'DIRECT', now(), 'DEV-test', 'TYPED', $4) RETURNING id`,
          [tenantId, siteId, patientId, userId],
        )
      ).id;
    };
    const suggestion = async (encounterId: string) =>
      (
        await one<{ id: string }>(
          `INSERT INTO asclepio.triage_suggestions
             (tenant_id, encounter_id, requested_by, input_snapshot, status, llm_level, suggested_level, explanation,
              guard_applied, prompt_version, latency_ms, attempts, created_at)
           VALUES ($1, $2, $3, '{}', 'OK', 3, 3, '{"summary":"DEV-test","factors":[]}', false, 'triage-v1', 1, '[]', now())
           RETURNING id`,
          [tenantId, encounterId, userId],
        )
      ).id;
    return { tenantId, siteId, userId, encounter, suggestion };
  }

  type Scenario = Awaited<ReturnType<typeof scenario>>;

  interface Decision {
    encounterId: string;
    suggestionId: string | null;
    action: string;
    level: number;
    reason: string | null;
  }

  const decision = (s: Scenario, d: Decision, tenantId = s.tenantId) =>
    db.query<{ id: string }>(
      `INSERT INTO asclepio.triage_decisions
         (tenant_id, encounter_id, suggestion_id, action, level, reason, decided_by, decided_at)
       VALUES ($1, $2, $3, $4::asclepio.triage_decision_action, $5, $6, $7, now())
       RETURNING id`,
      [
        tenantId,
        d.encounterId,
        d.suggestionId,
        d.action,
        d.level,
        d.reason,
        s.userId,
      ],
    );

  /** Atención con sugerencia y una decisión VALIDATE válida de base. */
  async function validated(s: Scenario) {
    const encounterId = await s.encounter();
    const suggestionId = await s.suggestion(encounterId);
    const base: Decision = {
      encounterId,
      suggestionId,
      action: 'VALIDATE',
      level: 3,
      reason: null,
    };
    return { encounterId, suggestionId, base };
  }

  beforeAll(async () => {
    db = await appClient();
  });
  afterAll(() => db.end());

  it('R19: asclepio_app puede INSERT y SELECT en triage_decisions, pero UPDATE, DELETE y TRUNCATE fallan con 42501', async () => {
    const s = await scenario('f05-db-grants');
    const { base } = await validated(s);
    const id = (await decision(s, base)).rows[0].id;
    const sel = await db.query(
      'SELECT id FROM asclepio.triage_decisions WHERE id = $1',
      [id],
    );
    expect(sel.rowCount).toBe(1);
    expect(
      await pgErrorCode(
        db.query(
          'UPDATE asclepio.triage_decisions SET level = 1 WHERE id = $1',
          [id],
        ),
      ),
    ).toBe('42501');
    expect(
      await pgErrorCode(
        db.query('DELETE FROM asclepio.triage_decisions WHERE id = $1', [id]),
      ),
    ).toBe('42501');
    expect(
      await pgErrorCode(db.query('TRUNCATE asclepio.triage_decisions')),
    ).toBe('42501');

    const grants = await db.query<{ privilege: string }>(
      `SELECT privilege_type AS privilege FROM information_schema.role_table_grants
       WHERE grantee = 'asclepio_app' AND table_schema = 'asclepio' AND table_name = 'triage_decisions'
       ORDER BY privilege_type`,
    );
    expect(grants.rows).toEqual([
      { privilege: 'INSERT' },
      { privilege: 'SELECT' },
    ]);
  });

  it('R19: una segunda decisión sobre la misma atención falla con 23505 (único encounter_id)', async () => {
    const s = await scenario('f05-db-unique');
    const { base, encounterId } = await validated(s);
    await decision(s, base);
    expect(
      await pgErrorCode(
        decision(s, {
          encounterId,
          suggestionId: null,
          action: 'MANUAL',
          level: 2,
          reason: null,
        }),
      ),
    ).toBe('23505');
  });

  it('R19: la FK compuesta impide una decisión con la sugerencia de otra atención o la atención de otro tenant (23503)', async () => {
    const s = await scenario('f05-db-xenc');
    const a = await validated(s);
    const b = await validated(s);
    expect(
      await pgErrorCode(
        decision(s, { ...a.base, suggestionId: b.suggestionId }),
      ),
    ).toBe('23503');
    const other = await scenario('f05-db-xt');
    expect(await pgErrorCode(decision(s, a.base, other.tenantId))).toBe(
      '23503',
    );
  });

  it('R19: CHECK: MANUAL con sugerencia, VALIDATE/CORRECT sin sugerencia, CORRECT sin motivo, motivo en VALIDATE o MANUAL, motivo en blanco o de 501 y level 0 o 6 fallan con 23514', async () => {
    const s = await scenario('f05-db-chk');
    const { base } = await validated(s);
    const bad: Partial<Decision>[] = [
      { action: 'MANUAL' },
      { action: 'VALIDATE', suggestionId: null },
      { action: 'CORRECT', suggestionId: null, level: 2, reason: 'DEV-test' },
      { action: 'CORRECT', level: 2, reason: null },
      { action: 'VALIDATE', reason: 'DEV-test' },
      { action: 'MANUAL', suggestionId: null, reason: 'DEV-test' },
      { action: 'CORRECT', level: 2, reason: '   ' },
      { action: 'CORRECT', level: 2, reason: 'x'.repeat(501) },
      { level: 0 },
      { level: 6 },
    ];
    for (const over of bad) {
      const code = await pgErrorCode(decision(s, { ...base, ...over }));
      expect([over, code]).toEqual([over, '23514']);
    }
    // Las tres formas válidas caben (cada una en su atención).
    await expect(decision(s, base)).resolves.toBeDefined();
    const c = await validated(s);
    await expect(
      decision(s, {
        ...c.base,
        action: 'CORRECT',
        level: 1,
        reason: `  ${'x'.repeat(500)}  `,
      }),
    ).resolves.toBeDefined();
    await expect(
      decision(s, {
        encounterId: await s.encounter(),
        suggestionId: null,
        action: 'MANUAL',
        level: 5,
        reason: null,
      }),
    ).resolves.toBeDefined();
  });

  it('R19: como dueño, borrar o cambiar el id de la atención, la sugerencia, el tenant o el usuario referenciados falla con 23503 y la fila queda intacta; todas las FK son RESTRICT', async () => {
    const s = await scenario('f05-db-fk');
    const { base, encounterId, suggestionId } = await validated(s);
    const id = (await decision(s, base)).rows[0].id;
    const owner = new pg.Client({ connectionString: process.env.DIRECT_URL });
    await owner.connect();
    try {
      const snapshot = async () =>
        (
          await owner.query<Record<string, unknown>>(
            'SELECT * FROM asclepio.triage_decisions WHERE id = $1',
            [id],
          )
        ).rows;
      const before = await snapshot();
      expect(before).toHaveLength(1);
      for (const [table, ref] of [
        ['triage_suggestions', suggestionId],
        ['encounters', encounterId],
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
       WHERE conrelid = 'asclepio.triage_decisions'::regclass AND contype = 'f' ORDER BY conname`,
    );
    expect(fks.rows).toEqual([
      { conname: 'triage_decisions_decided_by_fkey', del: 'r', upd: 'r' },
      {
        conname: 'triage_decisions_encounter_id_tenant_id_fkey',
        del: 'r',
        upd: 'r',
      },
      {
        conname: 'triage_decisions_suggestion_id_encounter_id_fkey',
        del: 'r',
        upd: 'r',
      },
      { conname: 'triage_decisions_tenant_id_fkey', del: 'r', upd: 'r' },
    ]);
    const triagedBy = await db.query<{ del: string; upd: string }>(
      `SELECT confdeltype AS del, confupdtype AS upd FROM pg_constraint
       WHERE conname = 'encounters_triaged_by_fkey'`,
    );
    expect(triagedBy.rows).toEqual([{ del: 'r', upd: 'r' }]);
  });

  it('R11: CHECK de encounters: final_level sin triaged_at o sin triaged_by, TRIAGED/IN_CARE/CLOSED sin final_level y final_level fuera de 1–5 fallan con 23514', async () => {
    const s = await scenario('f05-db-enc');
    const id = await s.encounter();
    const update = (set: string, params: unknown[] = []) =>
      db.query(`UPDATE asclepio.encounters SET ${set} WHERE id = $1`, [
        id,
        ...params,
      ]);
    for (const [set, params] of [
      ['final_level = 3', []],
      ['final_level = 3, triaged_at = now()', []],
      ['final_level = 3, triaged_by = $2', [s.userId]],
      ['triaged_at = now(), triaged_by = $2', [s.userId]],
      ["status = 'TRIAGED'", []],
      ["status = 'IN_CARE'", []],
      ["status = 'CLOSED'", []],
      [
        "status = 'TRIAGED', final_level = 0, triaged_at = now(), triaged_by = $2",
        [s.userId],
      ],
      [
        "status = 'TRIAGED', final_level = 6, triaged_at = now(), triaged_by = $2",
        [s.userId],
      ],
    ] as [string, unknown[]][]) {
      const code = await pgErrorCode(update(set, params));
      expect([set, code]).toEqual([set, '23514']);
    }
    // Los tres juntos sí caben, y una atención CANCELLED puede tenerlos o no.
    await expect(
      update(
        "status = 'TRIAGED', final_level = 2, triaged_at = now(), triaged_by = $2",
        [s.userId],
      ),
    ).resolves.toBeDefined();
    await expect(update("status = 'CANCELLED'")).resolves.toBeDefined();
    const cancelled = await s.encounter();
    await expect(
      db.query(
        "UPDATE asclepio.encounters SET status = 'CANCELLED' WHERE id = $1",
        [cancelled],
      ),
    ).resolves.toBeDefined();
  });
});
