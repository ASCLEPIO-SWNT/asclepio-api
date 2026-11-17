import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { bogotaDate } from '../src/common/clock/clock.js';
import { PrismaService } from '../src/common/prisma/prisma.service.js';
import { bogotaInstant, SEED_PASSWORD } from '../src/scripts/seed/seed-data.js';
import { createApp } from './e2e-app.js';

/**
 * F-09-api: npm run db:seed (dist/scripts/seed.js, compilado por scripts/test-int.sh) como proceso hijo contra el
 * PostgreSQL local de Docker. SEED_NAME único por ejecución: cada corrida siembra su propio DEV-test-…- desde cero
 * (los datos no se borran: audit_log y encounter_events son append-only). Ninguna prueba llama a un LLM real.
 */
function seed(name: string, env: Record<string, string> = {}) {
  const res = spawnSync('node', ['dist/scripts/seed.js'], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', SEED_NAME: name, ...env },
    timeout: 120_000,
  });
  return { code: res.status, output: `${res.stdout}\n${res.stderr}` };
}

describe('F-09: seed de datos sintéticos (integración, proceso hijo contra Docker)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const name = `test-${randomUUID().slice(0, 8)}`;
  const prefix = `DEV-${name}-`;
  let tenantId: string;
  let first: { code: number | null; output: string };
  let second: { code: number | null; output: string };
  let countsAfterFirst: Record<string, number>;
  let countsAfterSecond: Record<string, number>;

  async function counts(): Promise<Record<string, number>> {
    const where = { tenantId };
    const [
      sites,
      users,
      patients,
      accounts,
      preRegistrations,
      encounters,
      events,
      vitals,
      findings,
      suggestions,
      decisions,
      audits,
    ] = await Promise.all([
      prisma.site.count({ where }),
      prisma.user.count({ where }),
      prisma.patient.count({ where }),
      prisma.patientAccount.count({ where }),
      prisma.preRegistration.count({ where }),
      prisma.encounter.count({ where }),
      prisma.encounterEvent.count({ where }),
      prisma.vitalSign.count({ where }),
      prisma.symptomFinding.count({ where }),
      prisma.triageSuggestion.count({ where }),
      prisma.triageDecision.count({ where }),
      prisma.auditLog.count({ where }),
    ]);
    const tenants = await prisma.tenant.count({
      where: { name: { startsWith: prefix } },
    });
    return {
      tenants,
      sites,
      users,
      patients,
      accounts,
      preRegistrations,
      encounters,
      events,
      vitals,
      findings,
      suggestions,
      decisions,
      audits,
    };
  }

  const http = (method: 'get' | 'post', path: string, token?: string) => {
    const req = request(app.getHttpServer())[method](`/api/v1${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  async function staffToken(local: string): Promise<string> {
    const res = await http('post', '/auth/login')
      .send({
        email: `${prefix.toLowerCase()}${local}@asclepio.test`,
        password: SEED_PASSWORD,
      })
      .expect(200);
    return (res.body as { accessToken: string }).accessToken;
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    first = seed(name);
    const tenant = await prisma.tenant.findUnique({
      where: { name: `${prefix}IPS Asclepio` },
    });
    tenantId = tenant?.id ?? '00000000-0000-0000-0000-000000000000';
    countsAfterFirst = await counts();
    second = seed(name);
    countsAfterSecond = await counts();
  }, 300_000);

  afterAll(async () => {
    await app.close();
  });

  it('F-09.AC1: ejecutarlo dos veces no duplica filas en ninguna tabla (incluidas audit_log y encounter_events)', () => {
    expect(first.code).toBe(0);
    expect(first.output).toContain('Creado:');
    expect(second.code).toBe(0);
    expect(second.output).toContain('Ya estaba completo');
    expect(countsAfterSecond).toEqual(countsAfterFirst);
    expect(countsAfterFirst).toMatchObject({
      tenants: 1,
      sites: 1,
      users: 4,
      patients: 16,
      accounts: 8,
      preRegistrations: 20,
      encounters: 35,
      suggestions: 33,
      decisions: 33,
    });
  });

  it('F-09.AC1: el guardián aborta (código 1, sin escribir) si la URL no es localhost, salvo ALLOW_REMOTE_SEED=1', async () => {
    const other = `test-${randomUUID().slice(0, 8)}`;
    const r = seed(other, {
      DATABASE_URL: 'postgresql://u:p@db.remote.example:5432/x',
      DIRECT_URL: 'postgresql://u:p@db.remote.example:5432/x',
    });
    expect(r.code).toBe(1);
    expect(r.output).toContain('ALLOW_REMOTE_SEED=1');
    expect(r.output).not.toContain('db.remote.example');
    expect(
      await prisma.tenant.count({
        where: { name: { startsWith: `DEV-${other}-` } },
      }),
    ).toBe(0);
  });

  it('F-09.AC2: una IPS, una sede y un usuario por rol que inicia sesión con la contraseña de desarrollo', async () => {
    const users = await prisma.user.findMany({
      where: { tenantId },
      select: { role: true, fullName: true, active: true },
    });
    expect(users.map((u) => u.role).sort()).toEqual([
      'ADMIN',
      'NURSE',
      'PHYSICIAN',
      'RECEPTION',
    ]);
    expect(users.every((u) => u.active)).toBe(true);
    for (const local of ['recepcion', 'enfermeria', 'medicina', 'admin']) {
      expect(await staffToken(local)).toBeTruthy();
    }
    const audits = await prisma.auditLog.count({
      where: { tenantId, action: { in: ['USER_CREATED', 'SITE_CREATED'] } },
    });
    expect(audits).toBe(5);
  });

  it('F-09.AC2: las cuentas de paciente inician sesión en la app con documento y contraseña de desarrollo', async () => {
    await http('post', '/auth/patient/login')
      .send({
        tenantId,
        documentType: 'CC',
        documentNumber: `${prefix}1001`,
        password: SEED_PASSWORD,
      })
      .expect(200);
  });

  it('F-09.AC3: atenciones en todos los niveles I–V, 5 correcciones y los escenarios vivos de la cola', async () => {
    const encounters = await prisma.encounter.findMany({
      where: { tenantId },
      select: { status: true, finalLevel: true },
    });
    const by = (status: string) =>
      encounters.filter((e) => e.status === status);
    expect(by('CLOSED')).toHaveLength(30);
    expect(new Set(by('CLOSED').map((e) => e.finalLevel))).toEqual(
      new Set([1, 2, 3, 4, 5]),
    );
    expect(by('WAITING_TRIAGE')).toHaveLength(2);
    expect(by('TRIAGED')).toHaveLength(3);
    expect(
      await prisma.preRegistration.count({
        where: { tenantId, status: 'PENDING' },
      }),
    ).toBe(1);
    const actions = await prisma.triageDecision.groupBy({
      by: ['action'],
      where: { tenantId },
      _count: true,
    });
    expect(
      Object.fromEntries(actions.map((a) => [a.action, a._count])),
    ).toEqual({ VALIDATE: 26, CORRECT: 5, MANUAL: 2 });
    // Ninguna sugerencia sale de un LLM real.
    const models = await prisma.triageSuggestion.groupBy({
      by: ['model'],
      where: { tenantId },
    });
    expect(models.map((m) => m.model)).toEqual(['DEV-seed-sin-llm']);
  });

  it('F-09.AC3: el caso de las 7:42 espera triage con sus signos, sin sugerencia ni decisión', async () => {
    const e = await prisma.encounter.findFirstOrThrow({
      where: {
        tenantId,
        chiefComplaintText: `${prefix}Dolor torácico opresivo de 40 minutos`,
      },
      select: {
        id: true,
        status: true,
        patient: { select: { sex: true, birthDate: true } },
        vitalSigns: true,
        triageSuggestions: { select: { id: true } },
        triageDecisions: { select: { id: true } },
      },
    });
    expect(e.status).toBe('WAITING_TRIAGE');
    expect(e.patient.sex).toBe('M');
    const birth = e.patient.birthDate!.toISOString().slice(0, 10);
    const today = bogotaDate(new Date());
    const age =
      Number(today.slice(0, 4)) -
      Number(birth.slice(0, 4)) -
      (today.slice(5) < birth.slice(5) ? 1 : 0);
    expect(age).toBe(58);
    expect(e.vitalSigns).toHaveLength(1);
    expect(e.vitalSigns[0]).toMatchObject({
      heartRate: 112,
      systolicBp: 150,
      diastolicBp: 95,
      oxygenSaturation: 94,
    });
    expect(e.triageSuggestions).toHaveLength(0);
    expect(e.triageDecisions).toHaveLength(0);
  });

  it('F-09.AC3: en la cola, la TRIAGED de nivel II aún no tiene alerta (clasificada hace menos de 30 min)', async () => {
    const token = await staffToken('medicina');
    const q = (await http('get', '/queue', token).expect(200)).body as {
      waitingTriage: unknown[];
      triaged: {
        finalLevel: number;
        minutesSinceTriage: number;
        overdue: boolean;
      }[];
    };
    expect(q.waitingTriage).toHaveLength(2);
    expect(q.triaged).toHaveLength(3);
    const ii = q.triaged.find((i) => i.finalLevel === 2)!;
    expect(ii.overdue).toBe(false);
    expect(ii.minutesSinceTriage).toBeGreaterThanOrEqual(20);
    expect(ii.minutesSinceTriage).toBeLessThan(30);
  });

  it('F-09.AC3: la línea de tiempo de una atención cerrada tiene todos los pasos en orden y con responsable', async () => {
    const e = await prisma.encounter.findFirstOrThrow({
      where: {
        tenantId,
        chiefComplaintText: `${prefix}Dolor torácico opresivo irradiado al brazo izquierdo`,
      },
      select: { id: true },
    });
    const token = await staffToken('enfermeria');
    const body = (await http('get', `/encounters/${e.id}`, token).expect(200))
      .body as {
      events: {
        type: string;
        toStatus: string | null;
        actor: { fullName: string | null };
      }[];
    };
    expect(body.events.map((x) => `${x.type}:${x.toStatus ?? ''}`)).toEqual([
      'ENCOUNTER_CREATED:REGISTERED',
      'STATUS_CHANGED:WAITING_TRIAGE',
      'VITAL_SIGNS_RECORDED:',
      'SYMPTOM_FINDINGS_RECORDED:',
      'TRIAGE_DECIDED:TRIAGED',
      'STATUS_CHANGED:IN_CARE',
      'STATUS_CHANGED:CLOSED',
    ]);
    expect(body.events.every((x) => x.actor.fullName?.startsWith(prefix))).toBe(
      true,
    );
  });

  it('F-09.AC4: todos los datos identificables y textos llevan el prefijo DEV-<nombre>- (emails en minúsculas)', async () => {
    const where = { tenantId };
    const [
      tenant,
      sites,
      users,
      patients,
      pres,
      encounters,
      findings,
      decisions,
    ] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      prisma.site.findMany({ where }),
      prisma.user.findMany({ where }),
      prisma.patient.findMany({ where }),
      prisma.preRegistration.findMany({ where }),
      prisma.encounter.findMany({ where }),
      prisma.symptomFinding.findMany({ where }),
      prisma.triageDecision.findMany({ where, select: { reason: true } }),
    ]);
    const texts = [
      tenant.name,
      ...sites.map((s) => s.name),
      ...users.map((u) => u.fullName),
      ...patients.flatMap((p) => [p.fullName!, p.documentNumber!]),
      ...pres.map((p) => p.chiefComplaintText),
      ...encounters.map((e) => e.chiefComplaintText),
      ...findings.map((f) => f.description),
      ...decisions.flatMap((d) => (d.reason ? [d.reason] : [])),
    ];
    expect(texts).toHaveLength(100);
    for (const t of texts) expect(t.startsWith(prefix)).toBe(true);
    for (const u of users) {
      expect(u.email.startsWith(prefix.toLowerCase())).toBe(true);
    }
  });

  it('F-09.AC3: GET /reports/summary del periodo sembrado (7 días, Bogotá) devuelve datos no vacíos y concordancia < 100 %', async () => {
    const token = await staffToken('admin');
    const today = bogotaDate(new Date());
    const from = bogotaDate(bogotaInstant(today, 7, '12:00'));
    const res = await http(
      'get',
      `/reports/summary?from=${from}&to=${today}`,
      token,
    ).expect(200);
    const s = res.body as {
      population: { encounters: number; triaged: number };
      concordance: {
        pairs: number;
        exactAgreementPercent: number | null;
        weightedKappa: number | null;
      };
      fallback: {
        decisions: { MANUAL: { count: number } };
        guards: { applied: number };
        providers: { OPENROUTER: { count: number } };
      };
    };
    expect(s.population.encounters).toBe(35);
    expect(s.population.triaged).toBe(33);
    expect(s.concordance.pairs).toBe(31);
    expect(s.concordance.exactAgreementPercent).toBeGreaterThan(0);
    expect(s.concordance.exactAgreementPercent).toBeLessThan(100);
    expect(s.concordance.weightedKappa).not.toBeNull();
    expect(s.fallback.decisions.MANUAL.count).toBe(2);
    expect(s.fallback.guards.applied).toBe(2);
    expect(s.fallback.providers.OPENROUTER.count).toBe(3);
  });
});
