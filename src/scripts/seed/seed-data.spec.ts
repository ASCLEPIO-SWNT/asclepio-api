import { ageInYears } from '../../common/clock/age.js';
import { bogotaDate } from '../../common/clock/clock.js';
import { scoreNews2 } from '../../modules/ai/news2.js';
import { applyGuards } from '../../modules/ai/safety-guards.js';
import {
  birthDateFor,
  bogotaInstant,
  plannedArrival,
  plusMinutes,
  SEED_HISTORY,
  SEED_LIVE,
  SEED_PATIENTS,
  SEED_SCENARIOS,
  SEED_STAFF,
  type SeedScenario,
  type SeedVitals,
  seedIdentity,
  seedName,
  SeedNameError,
  staffEmail,
} from './seed-data.js';

/** Nivel que sugeriría el TriageAdvisor real: el del LLM ajustado por los SafetyGuards. */
function suggested(s: SeedScenario): number | null {
  if (s.llm?.kind !== 'OK' || !s.vitals) return null;
  return applyGuards(s.llm.level, scoreNews2(snapshotVitals(s.vitals)))
    .suggestedLevel;
}

function snapshotVitals(v: SeedVitals) {
  return {
    respiratory_rate: v.respiratoryRate,
    spo2: v.oxygenSaturation,
    supplemental_oxygen: v.supplementalOxygen,
    systolic_bp: v.systolicBp,
    diastolic_bp: v.diastolicBp,
    heart_rate: v.heartRate,
    consciousness: v.consciousness,
    temperature_c: v.temperatureC,
    glucose_mg_dl: null,
  };
}

function finalLevel(s: SeedScenario): number | null {
  const d = s.decision;
  if (!d) return null;
  return d.action === 'VALIDATE' ? suggested(s) : d.level;
}

const STEPS = [
  'preRegistered',
  'vitals',
  'suggestion',
  'decision',
  'startCare',
  'close',
] as const;

describe('Datos del seed (F-09-api, PA-F09-1)', () => {
  it('F-09.AC2: un usuario por cada uno de los 4 roles, con email dev-<nombre>-…', () => {
    expect(SEED_STAFF.map((s) => s.role).sort()).toEqual(
      ['ADMIN', 'NURSE', 'PHYSICIAN', 'RECEPTION'].sort(),
    );
    const id = seedIdentity('demo');
    for (const s of SEED_STAFF) {
      expect(staffEmail(id, s)).toMatch(/^dev-demo-[a-z]+@asclepio\.test$/);
    }
  });

  it('F-09.AC3: 30 históricas cerradas que cubren los niveles I–V, con ~5 correcciones y sugerencias coherentes', () => {
    expect(SEED_HISTORY).toHaveLength(30);
    const levels = SEED_HISTORY.map(finalLevel);
    for (const level of [1, 2, 3, 4, 5]) expect(levels).toContain(level);
    expect(levels.every((l) => l !== null)).toBe(true);
    const actions = SEED_HISTORY.map((s) => s.decision?.action);
    expect(actions.filter((a) => a === 'CORRECT')).toHaveLength(5);
    for (const s of SEED_HISTORY) {
      expect(s.target).toBe('CLOSED');
      const d = s.decision!;
      // F-05 (R6–R8): VALIDATE y CORRECT exigen una sugerencia OK; MANUAL, que no la haya; CORRECT cambia el nivel.
      if (d.action === 'MANUAL') expect(s.llm?.kind).not.toBe('OK');
      else expect(s.llm?.kind).toBe('OK');
      if (d.action === 'CORRECT') expect(d.level).not.toBe(suggested(s));
    }
    // Al menos una sugerencia con guard aplicado y una respondida por el respaldo (OpenRouter).
    expect(
      SEED_HISTORY.some(
        (s) => s.llm?.kind === 'OK' && suggested(s)! < s.llm.level,
      ),
    ).toBe(true);
    expect(
      SEED_HISTORY.some(
        (s) => s.llm?.kind === 'OK' && s.llm.provider === 'OPENROUTER',
      ),
    ).toBe(true);
  });

  it('F-09.AC3: escenarios vivos: 1 pre-registro pendiente, 2 en espera de triage y 3 clasificadas', () => {
    const count = (t: SeedScenario['target']) =>
      SEED_LIVE.filter((s) => s.target === t).length;
    expect(count('PENDING')).toBe(1);
    expect(count('WAITING_TRIAGE')).toBe(2);
    expect(count('TRIAGED')).toBe(3);
    // Máximo una atención activa o un pre-registro pendiente por paciente.
    const patients = SEED_LIVE.map((s) => s.patient);
    expect(new Set(patients).size).toBe(patients.length);
  });

  it('F-09.AC3: el caso de las 7:42 (hombre de 58 años, dolor torácico de 40 min, FC 112, PA 150/95, SatO₂ 94 %) espera triage sin sugerencia', () => {
    const c = SEED_LIVE.find((s) => s.complaint.includes('40 minutos'))!;
    expect(c.target).toBe('WAITING_TRIAGE');
    expect(c.llm).toBeUndefined();
    expect(c.decision).toBeUndefined();
    expect(c.vitals).toMatchObject({
      heartRate: 112,
      systolicBp: 150,
      diastolicBp: 95,
      oxygenSaturation: 94,
    });
    const p = SEED_PATIENTS.find((x) => x.key === c.patient)!;
    expect(p.sex).toBe('M');
    for (const today of [
      '2026-11-17',
      '2027-01-01',
      '2027-03-31',
      '2028-02-29',
    ]) {
      expect(ageInYears(birthDateFor(p, today), today)).toBe(58);
    }
  });

  it('F-09.AC3: una TRIAGED de nivel II clasificada hace menos de 30 min (cerca de la alerta de DT-02)', () => {
    const now = new Date('2026-11-17T19:00:00Z');
    const near = SEED_LIVE.filter(
      (s) => s.target === 'TRIAGED' && finalLevel(s) === 2,
    );
    expect(near).toHaveLength(1);
    const arrival = plannedArrival(near[0], now, bogotaDate(now));
    const triaged = plusMinutes(arrival, near[0].at.decision!);
    const minutes = (now.getTime() - triaged.getTime()) / 60_000;
    expect(minutes).toBeGreaterThan(20);
    expect(minutes).toBeLessThan(30);
  });

  it('F-09.AC4: el prefijo DEV-<nombre>- y claves únicas (motivo y documento)', () => {
    const id = seedIdentity(seedName(undefined));
    expect(id.prefix).toBe('DEV-demo-');
    expect(id.tenantName.startsWith('DEV-demo-')).toBe(true);
    expect(id.siteName.startsWith('DEV-demo-')).toBe(true);
    const complaints = SEED_SCENARIOS.map((s) => s.complaint);
    expect(new Set(complaints).size).toBe(complaints.length);
    const docs = SEED_PATIENTS.map((p) => p.documentSuffix);
    expect(new Set(docs).size).toBe(docs.length);
    expect(seedIdentity(seedName('test-ab12')).prefix).toBe('DEV-test-ab12-');
    for (const bad of ['Demo', 'a b', '-x', 'x'.repeat(31)]) {
      expect(() => seedName(bad)).toThrow(SeedNameError);
    }
  });

  it('F-09.AC1: los históricos caen en los 7 días anteriores (Bogotá), con pasos crecientes y terminados antes de hoy', () => {
    for (const nowIso of [
      '2026-11-17T05:00:00Z', // 00:00 de Bogotá
      '2026-11-17T17:30:00Z',
      '2026-11-18T04:59:00Z', // 23:59 de Bogotá
    ]) {
      const now = new Date(nowIso);
      const today = bogotaDate(now);
      const startOfToday = bogotaInstant(today, 0, '00:00');
      const weekAgo = bogotaInstant(today, 7, '00:00');
      for (const s of SEED_HISTORY) {
        const arrival = plannedArrival(s, now, today);
        expect(arrival.getTime()).toBeGreaterThanOrEqual(weekAgo.getTime());
        const offsets = STEPS.map((k) => s.at[k]).filter(
          (m): m is number => m !== undefined,
        );
        expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
        const last = plusMinutes(arrival, offsets[offsets.length - 1]);
        expect(last.getTime()).toBeLessThan(startOfToday.getTime());
      }
      for (const s of SEED_LIVE) {
        const arrival = plannedArrival(s, now, today);
        for (const k of STEPS) {
          const m = s.at[k];
          if (m !== undefined) {
            expect(plusMinutes(arrival, m).getTime()).toBeLessThanOrEqual(
              now.getTime(),
            );
          }
        }
      }
    }
  });

  it('F-09.AC1: bogotaInstant usa UTC−5 (hora de Bogotá) y retrocede días civiles', () => {
    expect(bogotaInstant('2026-11-17', 0, '07:42').toISOString()).toBe(
      '2026-11-17T12:42:00.000Z',
    );
    expect(bogotaInstant('2026-03-01', 1, '20:00').toISOString()).toBe(
      '2026-03-01T01:00:00.000Z',
    );
  });
});
