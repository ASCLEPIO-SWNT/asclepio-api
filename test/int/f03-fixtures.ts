import pg from 'pg';
import { COMPLAINT, type F02Fixtures, type Staff } from './f02-fixtures.js';

/** Toma válida (caso 7:42 de docs/verification.md): todos los signos dentro de los rangos provisionales. */
export const VITALS = {
  respiratoryRate: 22,
  oxygenSaturation: 94,
  supplementalOxygen: false,
  systolicBp: 150,
  heartRate: 112,
  consciousness: 'A',
  temperatureC: 37.4,
  diastolicBp: 95,
  glucoseMgDl: 132,
} as const;

/** Toma válida sin los signos opcionales (diastolicBp, glucoseMgDl). */
export const REQUIRED_VITALS = {
  respiratoryRate: VITALS.respiratoryRate,
  oxygenSaturation: VITALS.oxygenSaturation,
  supplementalOxygen: VITALS.supplementalOxygen,
  systolicBp: VITALS.systolicBp,
  heartRate: VITALS.heartRate,
  consciousness: VITALS.consciousness,
  temperatureC: VITALS.temperatureC,
};

export type EncounterStatusName =
  | 'REGISTERED'
  | 'WAITING_TRIAGE'
  | 'TRIAGED'
  | 'IN_CARE'
  | 'CLOSED'
  | 'CANCELLED';

/**
 * Datos de prueba de F-03 (DEV-test-…). No se limpian: vital_signs y symptom_findings no admiten DELETE para
 * asclepio_app y referencian atenciones, tenants y usuarios con RESTRICT (design.md, "Datos de prueba").
 */
export class F03Fixtures {
  constructor(private readonly fx: F02Fixtures) {}

  /** Atención en WAITING_TRIAGE registrada por recepción (POST /encounters, con sus eventos de F-02). */
  async encounter(
    tenant: { id: string; siteId: string },
    reception: Staff,
    complaint = COMPLAINT,
  ): Promise<string> {
    const p = await this.fx.patient(tenant.id);
    const res = await this.fx
      .http('post', '/encounters', reception.token)
      .send({
        patientId: p.id,
        siteId: tenant.siteId,
        chiefComplaintText: complaint,
        complaintSource: 'TYPED',
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  /**
   * Cambia el estado como dueño de la base (DIRECT_URL), para preparar estados a los que aún no llega la API. En
   * TRIAGED, IN_CARE y CLOSED fija también final_level, triaged_at y triaged_by (CHECK de F-05, R11).
   */
  async setStatus(id: string, status: EncounterStatusName): Promise<void> {
    const owner = new pg.Client({ connectionString: process.env.DIRECT_URL });
    await owner.connect();
    try {
      await owner.query(
        `UPDATE asclepio.encounters SET status = $2::asclepio.encounter_status,
           final_level = CASE WHEN $2 IN ('TRIAGED', 'IN_CARE', 'CLOSED') THEN 3 ELSE final_level END,
           triaged_at = CASE WHEN $2 IN ('TRIAGED', 'IN_CARE', 'CLOSED') THEN now() ELSE triaged_at END,
           triaged_by = CASE WHEN $2 IN ('TRIAGED', 'IN_CARE', 'CLOSED') THEN registered_by ELSE triaged_by END
         WHERE id = $1`,
        [id, status],
      );
    } finally {
      await owner.end();
    }
  }

  counts(encounterId: string) {
    const p = this.fx.prisma;
    return Promise.all([
      p.vitalSign.count({ where: { encounterId } }),
      p.symptomFinding.count({ where: { encounterId } }),
      p.encounterEvent.count({
        where: {
          encounterId,
          type: { in: ['VITAL_SIGNS_RECORDED', 'SYMPTOM_FINDINGS_RECORDED'] },
        },
      }),
      p.auditLog.count({
        where: {
          action: { in: ['VITAL_SIGNS_RECORDED', 'SYMPTOM_FINDINGS_RECORDED'] },
          OR: [
            { entityId: encounterId },
            { metadata: { path: ['encounterId'], equals: encounterId } },
          ],
        },
      }),
    ]).then(([vitalSigns, findings, events, audits]) => ({
      vitalSigns,
      findings,
      events,
      audits,
    }));
  }
}

export const NOTHING = { vitalSigns: 0, findings: 0, events: 0, audits: 0 };
