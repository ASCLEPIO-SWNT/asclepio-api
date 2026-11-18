import pg from 'pg';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import type { StaffRole } from '../../src/common/auth/principal.js';
import type { FixedClock } from '../../src/common/clock/clock.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import type { F02Fixtures, Staff } from './f02-fixtures.js';
import type { SuggestionStatusName } from './f05-fixtures.js';

/** Texto que permite buscar el contenido de las columnas que nunca se devuelven (instantánea y respuesta cruda). */
export const RAW_MARKER = 'DEV-test-raw-response-f07';
export const SNAPSHOT_MARKER = 'DEV-test-snapshot-f07';

export interface OwnerSuggestion {
  tenantId: string;
  encounterId: string;
  requestedBy: string;
  createdAt: Date;
  status?: SuggestionStatusName;
  suggestedLevel?: number;
  /** ≥ suggestedLevel; si es mayor, guard_applied = true (CHECK de F-04). */
  llmLevel?: number;
  provider?: 'GROQ' | 'OPENROUTER' | null;
}

/**
 * Inserta una sugerencia como DUEÑO de la base local (DIRECT_URL, solo Docker): ninguna prueba de F-07 llama a Groq ni
 * a OpenRouter. Respeta los CHECK de F-04 (niveles solo en OK, suggested ≤ llm y guard_applied = suggested < llm).
 */
export async function insertSuggestionAsOwner(
  s: OwnerSuggestion,
): Promise<string> {
  const status = s.status ?? 'OK';
  const ok = status === 'OK';
  const suggested = ok ? (s.suggestedLevel ?? 3) : null;
  const llm = ok ? (s.llmLevel ?? suggested) : null;
  const provider = s.provider === undefined ? (ok ? 'GROQ' : null) : s.provider;
  const owner = new pg.Client({ connectionString: process.env.DIRECT_URL });
  await owner.connect();
  try {
    const res = await owner.query<{ id: string }>(
      `INSERT INTO asclepio.triage_suggestions
         (tenant_id, encounter_id, requested_by, input_snapshot, status, llm_level, suggested_level, explanation,
          guard_applied, guard_reasons, provider, model, prompt_version, raw_response, latency_ms, attempts, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::asclepio.triage_suggestion_status, $6, $7, $8::jsonb, $9, '[]'::jsonb,
               $10::asclepio.llm_provider, $11, 'triage-v1', $12, 1, '[]'::jsonb, $13)
       RETURNING id`,
      [
        s.tenantId,
        s.encounterId,
        s.requestedBy,
        JSON.stringify({ marker: SNAPSHOT_MARKER }),
        status,
        llm,
        suggested,
        ok ? JSON.stringify({ summary: 'DEV-test', factors: [] }) : null,
        ok && llm !== null && suggested !== null && suggested < llm,
        provider,
        provider ? 'openai/gpt-oss-120b' : null,
        RAW_MARKER,
        s.createdAt,
      ],
    );
    return res.rows[0].id;
  } finally {
    await owner.end();
  }
}

/** Usuario del personal con lo necesario para volver a emitir su token a la hora del FixedClock. */
export interface StaffRef extends Staff {
  tenantId: string;
  role: StaffRole;
}

/**
 * Prepara atenciones por la API real con el FixedClock, para que arrival_at, triaged_at y los eventos STATUS_CHANGED
 * a IN_CARE y CLOSED lleven horas conocidas. Como el reloj salta días, cada petición emite un token nuevo a la hora
 * del reloj (el de fx.staff caducaría).
 */
export class F07Flow {
  private readonly tokens: TokenService;

  constructor(
    app: INestApplication<App>,
    private readonly fx: F02Fixtures,
    private readonly clock: FixedClock,
  ) {
    this.tokens = app.get(TokenService);
  }

  async staff(tenantId: string, role: StaffRole): Promise<StaffRef> {
    return { ...(await this.fx.staff(tenantId, role)), tenantId, role };
  }

  /** Token emitido a la hora actual del reloj. */
  async token(s: StaffRef): Promise<string> {
    return (
      await this.tokens.issueStaff({
        id: s.id,
        tenantId: s.tenantId,
        role: s.role,
      })
    ).accessToken;
  }

  /** Atención en WAITING_TRIAGE con llegada `at` (POST /encounters). */
  async arrive(
    at: Date,
    tenant: { id: string; siteId: string },
    reception: StaffRef,
    opts: { complaint?: string; fullName?: string } = {},
  ): Promise<string> {
    this.clock.set(at);
    const p = await this.fx.patient(
      tenant.id,
      opts.fullName ? { fullName: opts.fullName } : {},
    );
    const res = await this.fx
      .http('post', '/encounters', await this.token(reception))
      .send({
        patientId: p.id,
        siteId: tenant.siteId,
        chiefComplaintText: opts.complaint ?? 'DEV-test dolor torácico',
        complaintSource: 'TYPED',
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  /** POST /encounters/{id}/triage-decision a la hora `at`. */
  async decide(
    id: string,
    at: Date,
    nurse: StaffRef,
    body: Record<string, unknown>,
  ): Promise<void> {
    this.clock.set(at);
    await this.fx
      .http(
        'post',
        `/encounters/${id}/triage-decision`,
        await this.token(nurse),
      )
      .send(body)
      .expect(201);
  }

  /** POST start-care, close (PHYSICIAN) o cancel (RECEPTION/NURSE) a la hora `at`. */
  async move(
    id: string,
    action: 'start-care' | 'close' | 'cancel',
    at: Date,
    staff: StaffRef,
  ): Promise<void> {
    this.clock.set(at);
    const req = this.fx.http(
      'post',
      `/encounters/${id}/${action}`,
      await this.token(staff),
    );
    await (
      action === 'cancel' ? req.send({ reason: 'DEV-test cancelada' }) : req
    ).expect(200);
  }
}
