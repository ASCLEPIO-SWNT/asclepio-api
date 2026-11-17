// Runner del seed (F-09-api). Idempotente: cada fila tiene una clave determinista (nombre de la IPS y de la sede,
// email, documento, motivo de consulta con prefijo) y solo se crea si falta. Toda escritura pasa por los services de
// los módulos dueños, con su evento y su auditoría en la misma transacción; audit_log y encounter_events solo reciben
// INSERT. Si un escenario quedó a medias, la siguiente ejecución lo completa desde el paso que falte.
import type { INestApplicationContext } from '@nestjs/common';
import type { StaffPrincipal } from '../../common/auth/principal.js';
import { bogotaDate, type FixedClock } from '../../common/clock/clock.js';
import { APP_CONFIG, type AppConfig } from '../../common/config/app-config.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { TriageSuggestionsService } from '../../modules/ai/triage-suggestions.service.js';
import { AuditService } from '../../modules/audit/audit.service.js';
import { PasswordHasher } from '../../modules/auth/password/password-hasher.js';
import { PatientAccountsService } from '../../modules/auth/patient-accounts.service.js';
import { ClinicalCaptureService } from '../../modules/encounters/clinical-capture.service.js';
import { EncountersService } from '../../modules/encounters/encounters.service.js';
import { PreRegistrationsService } from '../../modules/encounters/pre-registrations.service.js';
import { PatientsService } from '../../modules/patients/patients.service.js';
import { TenancyService } from '../../modules/tenancy/tenancy.service.js';
import type { CreateTriageDecisionDto } from '../../modules/triage/dto/triage-decision.dto.js';
import { TriageDecisionsService } from '../../modules/triage/triage-decisions.service.js';
import { UsersService } from '../../modules/users/users.service.js';
import {
  birthDateFor,
  plannedArrival,
  plusMinutes,
  SEED_DOCUMENT_TYPE,
  SEED_PASSWORD,
  SEED_PATIENTS,
  SEED_SCENARIOS,
  SEED_STAFF,
  type SeedIdentity,
  type SeedScenario,
  staffEmail,
  withPrefix,
} from './seed-data.js';
import type { SeedLlm } from './seed-llm.js';

/** Las cuentas de paciente se crean 30 días antes y los pacientes de recepción 8 días antes (antes de los históricos). */
const ACCOUNT_CREATED_DAYS_AGO = 30;
const PATIENT_CREATED_DAYS_AGO = 8;
const DAY_MINUTES = 1440;

export class SeedError extends Error {}

export interface SeedSummary {
  tenantId: string;
  siteId: string;
  created: Record<SeedCounter, number>;
}

type SeedCounter =
  | 'tenant'
  | 'site'
  | 'users'
  | 'patients'
  | 'preRegistrations'
  | 'encounters'
  | 'vitalSigns'
  | 'symptomFindings'
  | 'suggestions'
  | 'decisions'
  | 'transitions';

interface PatientRef {
  patientId: string;
  /** Id de la cuenta de paciente (principal del pre-registro), si tiene. */
  accountId: string | null;
}

type Staff = Record<
  'RECEPTION' | 'NURSE' | 'PHYSICIAN' | 'ADMIN',
  StaffPrincipal
>;

export async function runSeed(
  app: INestApplicationContext,
  clock: FixedClock,
  llm: SeedLlm,
  id: SeedIdentity,
  now: Date,
): Promise<SeedSummary> {
  return new SeedRunner(app, clock, llm, id, now).run();
}

class SeedRunner {
  private readonly prisma: PrismaService;
  private readonly today: string;
  private readonly created: Record<SeedCounter, number> = {
    tenant: 0,
    site: 0,
    users: 0,
    patients: 0,
    preRegistrations: 0,
    encounters: 0,
    vitalSigns: 0,
    symptomFindings: 0,
    suggestions: 0,
    decisions: 0,
    transitions: 0,
  };

  constructor(
    private readonly app: INestApplicationContext,
    private readonly clock: FixedClock,
    private readonly llm: SeedLlm,
    private readonly id: SeedIdentity,
    private readonly now: Date,
  ) {
    this.prisma = app.get(PrismaService);
    this.today = bogotaDate(now);
  }

  async run(): Promise<SeedSummary> {
    const { tenantId, siteId } = await this.tenantAndSite();
    const staff = await this.staff(tenantId);
    const patients = await this.patients(tenantId, staff.RECEPTION);
    for (const s of SEED_SCENARIOS) {
      const patient = patients.get(s.patient);
      if (!patient)
        throw new SeedError(`Escenario ${s.code}: paciente desconocido.`);
      await this.scenario(s, tenantId, siteId, patient, staff);
    }
    return { tenantId, siteId, created: { ...this.created } };
  }

  private at(instant: Date): void {
    if (instant.getTime() > this.now.getTime()) {
      throw new SeedError('Un paso del seed quedaría en el futuro.');
    }
    this.clock.set(instant);
  }

  /** IPS y sede como npm run sites:create (auditoría SITE_CREATED, actor SYSTEM). */
  private async tenantAndSite(): Promise<{ tenantId: string; siteId: string }> {
    const tenancy = this.app.get(TenancyService);
    const audit = this.app.get(AuditService);
    this.at(
      plusMinutes(this.now, -ACCOUNT_CREATED_DAYS_AGO * DAY_MINUTES - 60),
    );
    const existing = await tenancy.findByName(this.id.tenantName);
    const site = existing
      ? await tenancy.findSiteByName(existing.id, this.id.siteName)
      : null;
    if (existing && site) return { tenantId: existing.id, siteId: site.id };
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tenancy.findOrCreateByName(this.id.tenantName, tx);
      if (tenant.created) this.created.tenant++;
      const created = await tenancy.createSite(tenant.id, this.id.siteName, tx);
      this.created.site++;
      await audit.record(
        {
          action: 'SITE_CREATED',
          actorType: 'SYSTEM',
          actorId: null,
          tenantId: tenant.id,
          entity: 'site',
          entityId: created.id,
        },
        tx,
      );
      return { tenantId: tenant.id, siteId: created.id };
    });
  }

  /** Un usuario por rol como npm run users:create (hasher scrypt, auditoría USER_CREATED, actor SYSTEM). */
  private async staff(tenantId: string): Promise<Staff> {
    const users = this.app.get(UsersService);
    const hasher = this.app.get(PasswordHasher);
    const audit = this.app.get(AuditService);
    const out: Partial<Staff> = {};
    for (const s of SEED_STAFF) {
      const email = staffEmail(this.id, s);
      let found = await users.findForLogin(email);
      if (!found) {
        const passwordHash = await hasher.hash(SEED_PASSWORD);
        await this.prisma.$transaction(async (tx) => {
          const user = await users.create(
            {
              tenantId,
              email,
              passwordHash,
              fullName: withPrefix(this.id, s.name),
              role: s.role,
            },
            tx,
          );
          await audit.record(
            {
              action: 'USER_CREATED',
              actorType: 'SYSTEM',
              actorId: null,
              tenantId,
              entity: 'user',
              entityId: user.id,
            },
            tx,
          );
        });
        this.created.users++;
        found = await users.findForLogin(email);
      }
      const user = found?.user;
      if (!user || user.tenantId !== tenantId || user.role !== s.role) {
        throw new SeedError(
          `El usuario ${s.role} del seed ya existe con otra IPS u otro rol.`,
        );
      }
      out[s.role] = { kind: 'STAFF', id: user.id, tenantId, role: s.role };
    }
    return out as Staff;
  }

  /** Cuentas de paciente (POST /patient-accounts) y pacientes registrados por recepción (POST /patients). */
  private async patients(
    tenantId: string,
    reception: StaffPrincipal,
  ): Promise<Map<string, PatientRef>> {
    const accounts = this.app.get(PatientAccountsService);
    const patients = this.app.get(PatientsService);
    const consentVersion =
      this.app.get<AppConfig>(APP_CONFIG).patientConsentVersion;
    const refs = new Map<string, PatientRef>();
    for (const p of SEED_PATIENTS) {
      const documentNumber = withPrefix(this.id, p.documentSuffix);
      const fullName = withPrefix(this.id, p.name);
      const birthDate = birthDateFor(p, this.today);
      if (p.account) {
        let account = await accounts.findForLogin(
          tenantId,
          SEED_DOCUMENT_TYPE,
          documentNumber,
        );
        if (!account) {
          this.at(
            plusMinutes(this.now, -ACCOUNT_CREATED_DAYS_AGO * DAY_MINUTES),
          );
          await accounts.create({
            tenantId,
            documentType: SEED_DOCUMENT_TYPE,
            documentNumber,
            fullName,
            birthDate,
            sex: p.sex,
            password: SEED_PASSWORD,
            consentAccepted: true,
            consentVersion,
          });
          this.created.patients++;
          account = await accounts.findForLogin(
            tenantId,
            SEED_DOCUMENT_TYPE,
            documentNumber,
          );
        }
        if (!account) throw new SeedError(`Paciente ${p.key}: sin cuenta.`);
        refs.set(p.key, {
          patientId: account.patientId,
          accountId: account.id,
        });
      } else {
        let found = await patients.findByDocument(
          tenantId,
          SEED_DOCUMENT_TYPE,
          documentNumber,
        );
        if (!found) {
          this.at(
            plusMinutes(this.now, -PATIENT_CREATED_DAYS_AGO * DAY_MINUTES),
          );
          found = await patients.createByReception(reception, {
            documentType: SEED_DOCUMENT_TYPE,
            documentNumber,
            fullName,
            birthDate,
            sex: p.sex,
          });
          this.created.patients++;
        }
        refs.set(p.key, { patientId: found.id, accountId: null });
      }
    }
    return refs;
  }

  private async scenario(
    s: SeedScenario,
    tenantId: string,
    siteId: string,
    patient: PatientRef,
    staff: Staff,
  ): Promise<void> {
    const complaint = withPrefix(this.id, s.complaint);
    let encounter = await this.findEncounter(tenantId, complaint);
    if (!encounter) {
      const arrival = plannedArrival(s, this.now, this.today);
      if (s.origin === 'PRE_REGISTRATION') {
        const preId = await this.preRegistration(
          s,
          tenantId,
          siteId,
          patient,
          complaint,
          arrival,
        );
        if (s.target === 'PENDING' || !preId) return;
        this.at(arrival);
        await this.app
          .get(PreRegistrationsService)
          .confirm(staff.RECEPTION, preId, { identityVerified: true });
      } else {
        this.at(arrival);
        await this.app.get(EncountersService).createDirect(staff.RECEPTION, {
          patientId: patient.patientId,
          siteId,
          chiefComplaintText: complaint,
          complaintSource: s.source,
        });
      }
      this.created.encounters++;
      encounter = await this.findEncounter(tenantId, complaint);
      if (!encounter) throw new SeedError(`Escenario ${s.code}: sin atención.`);
    }
    await this.progress(s, tenantId, encounter, staff);
  }

  /** Pre-registro desde el móvil (principal de paciente). Devuelve el id si sigue PENDING; null si ya se resolvió. */
  private async preRegistration(
    s: SeedScenario,
    tenantId: string,
    siteId: string,
    patient: PatientRef,
    complaint: string,
    arrival: Date,
  ): Promise<string | null> {
    if (!patient.accountId) {
      throw new SeedError(`Escenario ${s.code}: el paciente no tiene cuenta.`);
    }
    const existing = await this.prisma.preRegistration.findFirst({
      where: {
        tenantId,
        patientId: patient.patientId,
        chiefComplaintText: complaint,
      },
      orderBy: [{ preRegisteredAt: 'desc' }, { id: 'desc' }],
      select: { id: true, status: true },
    });
    if (existing) {
      if (existing.status === 'PENDING') return existing.id;
      if (s.target === 'PENDING') return null;
      throw new SeedError(
        `Escenario ${s.code}: el pre-registro ya no está pendiente y no tiene atención.`,
      );
    }
    this.at(plusMinutes(arrival, s.at.preRegistered ?? 0));
    const pre = await this.app.get(PreRegistrationsService).create(
      {
        kind: 'PATIENT',
        id: patient.accountId,
        tenantId,
        patientId: patient.patientId,
      },
      { siteId, chiefComplaintText: complaint, complaintSource: s.source },
    );
    this.created.preRegistrations++;
    return pre.id;
  }

  private findEncounter(tenantId: string, complaint: string) {
    return this.prisma.encounter.findFirst({
      where: { tenantId, chiefComplaintText: complaint },
      select: { id: true, status: true, arrivalAt: true },
    });
  }

  /** Completa los pasos que falten (signos, hallazgos, sugerencia, decisión, inicio y cierre) desde la llegada real. */
  private async progress(
    s: SeedScenario,
    tenantId: string,
    encounter: { id: string; status: string; arrivalAt: Date },
    staff: Staff,
  ): Promise<void> {
    const id = encounter.id;
    const step = (minutes: number | undefined) =>
      plusMinutes(encounter.arrivalAt, minutes ?? 0);
    let status = encounter.status;
    if (status === 'WAITING_TRIAGE') {
      const capture = this.app.get(ClinicalCaptureService);
      const [vitals, findings, suggestions] = await Promise.all([
        this.prisma.vitalSign.count({ where: { tenantId, encounterId: id } }),
        this.prisma.symptomFinding.count({
          where: { tenantId, encounterId: id },
        }),
        this.prisma.triageSuggestion.count({
          where: { tenantId, encounterId: id },
        }),
      ]);
      if (s.vitals && !vitals) {
        this.at(step(s.at.vitals));
        await capture.recordVitalSigns(staff.NURSE, id, s.vitals);
        this.created.vitalSigns++;
      }
      if (s.findings?.length && !findings) {
        this.at(step(s.at.vitals));
        await capture.recordSymptomFindings(staff.NURSE, id, {
          items: s.findings.map((f) => ({
            kind: f.kind,
            description: withPrefix(this.id, f.description),
          })),
        });
        this.created.symptomFindings++;
      }
      if (s.llm && s.vitals && !suggestions) {
        this.at(step(s.at.suggestion));
        this.llm.program(s.llm, s.vitals);
        try {
          await this.app.get(TriageSuggestionsService).request(staff.NURSE, id);
        } finally {
          this.llm.clear();
        }
        this.created.suggestions++;
      }
      if (s.decision) {
        const current = await this.prisma.triageSuggestion.findFirst({
          where: { tenantId, encounterId: id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        this.at(step(s.at.decision));
        await this.app
          .get(TriageDecisionsService)
          .decide(
            staff.NURSE,
            id,
            decisionBody(s, current?.id ?? null, this.id),
          );
        this.created.decisions++;
        status = 'TRIAGED';
      }
    }
    const encounters = this.app.get(EncountersService);
    if (status === 'TRIAGED' && s.target === 'CLOSED') {
      this.at(step(s.at.startCare));
      await encounters.startCare(staff.PHYSICIAN, id);
      this.created.transitions++;
      status = 'IN_CARE';
    }
    if (status === 'IN_CARE' && s.target === 'CLOSED') {
      this.at(step(s.at.close));
      await encounters.close(staff.PHYSICIAN, id);
      this.created.transitions++;
    }
  }
}

function decisionBody(
  s: SeedScenario,
  suggestionId: string | null,
  id: SeedIdentity,
): CreateTriageDecisionDto {
  const d = s.decision!;
  if (d.action === 'MANUAL') return { action: 'MANUAL', level: d.level };
  if (!suggestionId) {
    throw new SeedError(
      `Escenario ${s.code}: la decisión necesita una sugerencia.`,
    );
  }
  return d.action === 'VALIDATE'
    ? { action: 'VALIDATE', suggestionId }
    : {
        action: 'CORRECT',
        suggestionId,
        level: d.level,
        reason: withPrefix(id, d.reason),
      };
}
