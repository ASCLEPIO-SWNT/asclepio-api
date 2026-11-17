// Datos sintéticos del seed (F-09-api, PA-F09-1 decidido por el humano el 2026-11-17). Pura: sin Nest ni base.
// 1 IPS, 1 sede, 1 usuario por rol, 8 cuentas de paciente + 8 pacientes registrados por recepción, 30 atenciones
// históricas cerradas en los 7 días anteriores (hora de Bogotá) y 6 escenarios vivos relativos a "ahora".
// Los signos vitales y niveles son ilustrativos para la demo: NO son criterios clínicos (no validados por un asesor).
import type { StaffRole } from '../../common/auth/principal.js';

/** Nombre de los datos por defecto: el prefijo es `DEV-<nombre>-` (ADR 0003, F-09.AC4). */
export const DEFAULT_SEED_NAME = 'demo';
const SEED_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SEED_NAME_MAX = 30;

/** Contraseña SOLO de desarrollo, igual para el personal y los pacientes sembrados (documentada en verification.md). */
export const SEED_PASSWORD = 'DEV-demo-clave-2026';
/** Modelo que figura en las sugerencias sembradas: ninguna sale de un LLM real. */
export const SEED_LLM_MODEL = 'DEV-seed-sin-llm';
/** Hora de Bogotá: UTC−5 todo el año (Colombia no tiene horario de verano). */
const BOGOTA_OFFSET_HOURS = 5;
const MINUTE = 60_000;

export class SeedNameError extends Error {}

export function seedName(raw: string | undefined): string {
  const name = (raw ?? '').trim() || DEFAULT_SEED_NAME;
  if (name.length > SEED_NAME_MAX || !SEED_NAME_RE.test(name)) {
    throw new SeedNameError(
      `SEED_NAME debe tener de 1 a ${SEED_NAME_MAX} caracteres: minúsculas, dígitos y guiones.`,
    );
  }
  return name;
}

export interface SeedIdentity {
  /** `DEV-<nombre>-`. */
  prefix: string;
  /** Prefijo de los emails (se guardan en minúsculas, D7 de F-01): `dev-<nombre>-`. */
  emailPrefix: string;
  tenantName: string;
  siteName: string;
}

export function seedIdentity(name: string): SeedIdentity {
  const prefix = `DEV-${name}-`;
  return {
    prefix,
    emailPrefix: prefix.toLowerCase(),
    tenantName: `${prefix}IPS Asclepio`,
    siteName: `${prefix}Sede Centro`,
  };
}

// ---------------------------------------------------------------- personal

export interface SeedStaff {
  role: StaffRole;
  /** Parte local tras el prefijo: dev-<nombre>-<local>@asclepio.test. */
  emailLocal: string;
  /** Nombre tras el prefijo. */
  name: string;
}

export const SEED_STAFF: readonly SeedStaff[] = [
  { role: 'RECEPTION', emailLocal: 'recepcion', name: 'Laura Díaz' },
  { role: 'NURSE', emailLocal: 'enfermeria', name: 'Marta Salazar' },
  { role: 'PHYSICIAN', emailLocal: 'medicina', name: 'Felipe Arango' },
  { role: 'ADMIN', emailLocal: 'admin', name: 'Sofía Vélez' },
];

export const SEED_EMAIL_DOMAIN = 'asclepio.test';

export function staffEmail(id: SeedIdentity, s: SeedStaff): string {
  return `${id.emailPrefix}${s.emailLocal}@${SEED_EMAIL_DOMAIN}`;
}

// ---------------------------------------------------------------- pacientes

export interface SeedPatient {
  key: string;
  /** Número tras el prefijo: documento `DEV-<nombre>-<n>` (nunca un documento real). */
  documentSuffix: string;
  name: string;
  sex: 'M' | 'F';
  /** Fecha civil fija, o edad cumplida hoy (el caso de las 7:42 tiene siempre 58 años). */
  birth: { date: string } | { ageYears: number };
  /** true: cuenta de paciente (app móvil, ADR 0008); false: registrado por recepción. */
  account: boolean;
}

export const SEED_PATIENTS: readonly SeedPatient[] = [
  // Con cuenta (se pre-registran desde el móvil).
  {
    key: 'P1',
    documentSuffix: '1001',
    name: 'Ana Morales',
    sex: 'F',
    birth: { date: '1990-04-12' },
    account: true,
  },
  {
    key: 'P2',
    documentSuffix: '1002',
    name: 'Luis Herrera',
    sex: 'M',
    birth: { date: '1985-09-03' },
    account: true,
  },
  {
    key: 'P3',
    documentSuffix: '1003',
    name: 'Camila Rojas',
    sex: 'F',
    birth: { date: '1998-01-25' },
    account: true,
  },
  {
    key: 'P4',
    documentSuffix: '1004',
    name: 'Andrés Gómez',
    sex: 'M',
    birth: { date: '1972-06-30' },
    account: true,
  },
  {
    key: 'P5',
    documentSuffix: '1005',
    name: 'Valentina Ortiz',
    sex: 'F',
    birth: { date: '2001-11-08' },
    account: true,
  },
  {
    key: 'P6',
    documentSuffix: '1006',
    name: 'Ricardo Mejía',
    sex: 'M',
    birth: { date: '1963-02-14' },
    account: true,
  },
  {
    key: 'P7',
    documentSuffix: '1007',
    name: 'Paula Cárdenas',
    sex: 'F',
    birth: { date: '1994-07-21' },
    account: true,
  },
  {
    key: 'P8',
    documentSuffix: '1008',
    name: 'Diego Restrepo',
    sex: 'M',
    birth: { date: '1979-12-02' },
    account: true,
  },
  // Registrados por recepción (sin app).
  {
    key: 'D1',
    documentSuffix: '2001',
    name: 'Jorge Castaño',
    sex: 'M',
    birth: { ageYears: 58 },
    account: false,
  },
  {
    key: 'D2',
    documentSuffix: '2002',
    name: 'Rosa Pineda',
    sex: 'F',
    birth: { date: '1981-05-09' },
    account: false,
  },
  {
    key: 'D3',
    documentSuffix: '2003',
    name: 'Tomás Úsuga',
    sex: 'M',
    birth: { date: '2005-03-17' },
    account: false,
  },
  {
    key: 'D4',
    documentSuffix: '2004',
    name: 'Gloria Patiño',
    sex: 'F',
    birth: { date: '1950-10-28' },
    account: false,
  },
  {
    key: 'D5',
    documentSuffix: '2005',
    name: 'Hernán Zapata',
    sex: 'M',
    birth: { date: '1958-08-19' },
    account: false,
  },
  {
    key: 'D6',
    documentSuffix: '2006',
    name: 'Natalia Giraldo',
    sex: 'F',
    birth: { date: '1988-12-11' },
    account: false,
  },
  {
    key: 'D7',
    documentSuffix: '2007',
    name: 'Óscar Londoño',
    sex: 'M',
    birth: { date: '1969-04-04' },
    account: false,
  },
  {
    key: 'D8',
    documentSuffix: '2008',
    name: 'Marcela Vargas',
    sex: 'F',
    birth: { date: '1996-09-30' },
    account: false,
  },
];

export const SEED_DOCUMENT_TYPE = 'CC';

/** Fecha civil de nacimiento; con edad, el día 15 de hace (edad años y 3 meses): cumple esa edad hoy en Bogotá. */
export function birthDateFor(p: SeedPatient, today: string): string {
  if ('date' in p.birth) return p.birth.date;
  const [y, m] = today.split('-').map(Number);
  const d = new Date(Date.UTC(y - p.birth.ageYears, m - 1 - 3, 15));
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- signos vitales (ilustrativos)

export interface SeedVitals {
  respiratoryRate: number;
  oxygenSaturation: number;
  supplementalOxygen: boolean;
  systolicBp: number;
  diastolicBp: number;
  heartRate: number;
  consciousness: 'A' | 'C' | 'V' | 'P' | 'U';
  temperatureC: number;
}

const V = (
  respiratoryRate: number,
  oxygenSaturation: number,
  systolicBp: number,
  diastolicBp: number,
  heartRate: number,
  temperatureC: number,
  consciousness: SeedVitals['consciousness'] = 'A',
  supplementalOxygen = false,
): SeedVitals => ({
  respiratoryRate,
  oxygenSaturation,
  supplementalOxygen,
  systolicBp,
  diastolicBp,
  heartRate,
  consciousness,
  temperatureC,
});

const VITALS = {
  CRIT: V(30, 86, 84, 50, 136, 38.7, 'V', true),
  SEIZURE: V(22, 92, 150, 90, 120, 37.4, 'V'),
  CHEST: V(20, 96, 158, 96, 108, 36.8),
  RESP: V(26, 92, 130, 80, 118, 36.9),
  HTN: V(18, 97, 225, 125, 88, 36.8),
  /** NEWS2 ≥ 7: el guard G1 sube un III del LLM a II. */
  GUARD_G1: V(25, 92, 98, 60, 125, 38.4),
  /** NEWS2 5–6: el guard G2 sube un IV del LLM a III. */
  GUARD_G2: V(22, 95, 118, 75, 104, 38.9),
  STROKE: V(18, 96, 182, 104, 92, 36.9, 'C'),
  MID: V(18, 97, 126, 80, 96, 37.6),
  MID_FEVER: V(19, 96, 120, 76, 98, 38.5),
  LOW: V(16, 98, 122, 78, 82, 36.7),
  MIN: V(14, 99, 116, 74, 72, 36.5),
  /** Caso de las 7:42 (docs/product/vision.md): FC 112, PA 150/95, SatO₂ 94 %. */
  CASE_742: V(20, 94, 150, 95, 112, 36.8),
} as const;

// ---------------------------------------------------------------- escenarios

export type SeedLlmPlan =
  /** Respuesta válida del proveedor indicado (OPENROUTER = Groq falla con HTTP 429 y responde el respaldo). */
  | {
      kind: 'OK';
      provider: 'GROQ' | 'OPENROUTER';
      level: number;
      summary: string;
    }
  /** Los dos proveedores agotan el timeout. */
  | { kind: 'TIMEOUT' }
  /** Los dos proveedores responden HTTP 5xx. */
  | { kind: 'FAILED' };

export type SeedDecision =
  | { action: 'VALIDATE' }
  | { action: 'CORRECT'; level: number; reason: string }
  | { action: 'MANUAL'; level: number };

export type SeedTarget = 'PENDING' | 'WAITING_TRIAGE' | 'TRIAGED' | 'CLOSED';

export interface SeedScenario {
  code: string;
  patient: string;
  origin: 'PRE_REGISTRATION' | 'DIRECT';
  /** Texto tras el prefijo; es la clave de idempotencia del escenario (único). */
  complaint: string;
  source: 'TYPED' | 'VOICE_ON_DEVICE';
  /** Llegada: día y hora de Bogotá (históricos) o minutos antes de ahora (vivos). */
  when: { daysAgo: number; time: string } | { minutesAgo: number };
  target: SeedTarget;
  vitals?: SeedVitals;
  findings?: { kind: 'SYMPTOM' | 'FINDING'; description: string }[];
  llm?: SeedLlmPlan;
  decision?: SeedDecision;
  /** Minutos desde la llegada de cada paso (preRegistered es negativo). */
  at: {
    preRegistered?: number;
    vitals?: number;
    suggestion?: number;
    decision?: number;
    startCare?: number;
    close?: number;
  };
}

const ok = (
  level: number,
  summary: string,
  provider: 'GROQ' | 'OPENROUTER' = 'GROQ',
): SeedLlmPlan => ({ kind: 'OK', provider, level, summary });
const VALIDATE: SeedDecision = { action: 'VALIDATE' };
const correct = (level: number, reason: string): SeedDecision => ({
  action: 'CORRECT',
  level,
  reason,
});

/**
 * Atención histórica cerrada: pre-registro 25 min antes (si viene del móvil), signos +6, sugerencia +8, decisión +10
 * (I: +1, +2, +3), inicio de la atención `wait` min tras la decisión y cierre `care` min después.
 */
function history(
  code: string,
  patient: string,
  origin: SeedScenario['origin'],
  daysAgo: number,
  time: string,
  complaint: string,
  vitals: SeedVitals,
  llm: SeedLlmPlan,
  decision: SeedDecision,
  wait: number,
  care: number,
  extra: Partial<Pick<SeedScenario, 'findings' | 'source'>> = {},
): SeedScenario {
  const fast = vitals === VITALS.CRIT || vitals === VITALS.SEIZURE;
  const [v, s, d] = fast ? [1, 2, 3] : [6, 8, 10];
  return {
    code,
    patient,
    origin,
    complaint,
    source:
      extra.source ??
      (origin === 'PRE_REGISTRATION' ? 'VOICE_ON_DEVICE' : 'TYPED'),
    when: { daysAgo, time },
    target: 'CLOSED',
    vitals,
    findings: extra.findings,
    llm,
    decision,
    at: {
      ...(origin === 'PRE_REGISTRATION' ? { preRegistered: -25 } : {}),
      vitals: v,
      suggestion: s,
      decision: d,
      startCare: d + wait,
      close: d + wait + care,
    },
  };
}

const P = 'PRE_REGISTRATION';
const D = 'DIRECT';

export const SEED_HISTORY: readonly SeedScenario[] = [
  history(
    'H01',
    'P1',
    P,
    7,
    '07:40',
    'Dolor de cabeza intenso desde ayer',
    VITALS.LOW,
    ok(4, 'Cefalea sin signos de alarma y signos vitales normales.'),
    VALIDATE,
    70,
    60,
  ),
  history(
    'H02',
    'D2',
    D,
    7,
    '09:15',
    'Dolor torácico opresivo irradiado al brazo izquierdo',
    VITALS.CHEST,
    ok(
      2,
      'Dolor torácico típico con taquicardia: descartar síndrome coronario agudo.',
    ),
    VALIDATE,
    12,
    180,
    { findings: [{ kind: 'SYMPTOM', description: 'Sudoración fría' }] },
  ),
  history(
    'H03',
    'P2',
    P,
    7,
    '11:30',
    'Fiebre y tos seca desde hace 3 días',
    VITALS.MID,
    ok(3, 'Cuadro respiratorio febril con taquicardia leve.'),
    VALIDATE,
    45,
    90,
  ),
  history(
    'H04',
    'D3',
    D,
    7,
    '14:05',
    'Esguince de tobillo jugando fútbol',
    VITALS.LOW,
    ok(5, 'Trauma menor de extremidad sin compromiso hemodinámico.'),
    correct(
      4,
      'Edema importante y dolor al apoyar: requiere radiografía pronto.',
    ),
    90,
    60,
  ),
  history(
    'H05',
    'D4',
    D,
    6,
    '06:50',
    'Dificultad respiratoria súbita, labios morados',
    VITALS.CRIT,
    ok(
      1,
      'Insuficiencia respiratoria con hipoxemia grave y alteración de la conciencia.',
    ),
    VALIDATE,
    1,
    240,
  ),
  history(
    'H06',
    'P3',
    P,
    6,
    '08:20',
    'Dolor abdominal en fosa ilíaca derecha',
    VITALS.MID,
    ok(3, 'Dolor abdominal localizado: descartar apendicitis.', 'OPENROUTER'),
    VALIDATE,
    50,
    150,
  ),
  history(
    'H07',
    'P4',
    P,
    6,
    '10:45',
    'Mareo y visión borrosa, hipertenso conocido',
    VITALS.HTN,
    ok(3, 'Cifras tensionales elevadas con síntomas inespecíficos.'),
    correct(
      2,
      'Presión muy elevada con síntomas neurológicos: posible emergencia hipertensiva.',
    ),
    20,
    180,
  ),
  history(
    'H08',
    'D5',
    D,
    6,
    '13:10',
    'Vómito y diarrea desde ayer',
    VITALS.MID,
    ok(3, 'Gastroenteritis con taquicardia leve: vigilar deshidratación.'),
    VALIDATE,
    60,
    120,
  ),
  history(
    'H09',
    'P5',
    P,
    6,
    '15:30',
    'Dolor de oído y fiebre',
    VITALS.LOW,
    ok(4, 'Otalgia febril sin signos de alarma.'),
    VALIDATE,
    80,
    45,
  ),
  history(
    'H10',
    'D6',
    D,
    5,
    '07:05',
    'Herida en cuero cabelludo por caída',
    VITALS.LOW,
    ok(4, 'Herida superficial sin pérdida de conciencia referida.'),
    VALIDATE,
    65,
    50,
  ),
  history(
    'H11',
    'P6',
    P,
    5,
    '09:40',
    'Dolor torácico al respirar y fiebre',
    VITALS.GUARD_G1,
    ok(3, 'Dolor pleurítico febril: probable neumonía.'),
    VALIDATE,
    18,
    200,
    {
      findings: [
        { kind: 'FINDING', description: 'Uso de músculos accesorios' },
      ],
    },
  ),
  history(
    'H12',
    'D7',
    D,
    5,
    '12:00',
    'Dolor lumbar sin trauma',
    VITALS.MIN,
    ok(5, 'Lumbalgia mecánica sin signos de alarma.'),
    VALIDATE,
    110,
    40,
  ),
  history(
    'H13',
    'P7',
    P,
    5,
    '14:25',
    'Crisis asmática que no mejora con inhalador',
    VITALS.RESP,
    ok(2, 'Broncoespasmo con taquipnea e hipoxemia.', 'OPENROUTER'),
    VALIDATE,
    38,
    150,
  ),
  history(
    'H14',
    'P8',
    P,
    4,
    '06:30',
    'Dolor abdominal difuso y fiebre',
    VITALS.MID,
    { kind: 'TIMEOUT' },
    { action: 'MANUAL', level: 3 },
    55,
    120,
  ),
  history(
    'H15',
    'D8',
    D,
    4,
    '08:55',
    'Palpitaciones desde hace una hora',
    VITALS.MID,
    ok(3, 'Palpitaciones con estabilidad hemodinámica.'),
    VALIDATE,
    40,
    90,
  ),
  history(
    'H16',
    'P1',
    P,
    4,
    '11:20',
    'Ardor al orinar y dolor lumbar',
    VITALS.MID,
    ok(3, 'Síntomas urinarios con dolor lumbar: descartar pielonefritis.'),
    VALIDATE,
    70,
    60,
  ),
  history(
    'H17',
    'D2',
    D,
    4,
    '13:45',
    'Tos con expectoración y fiebre alta',
    VITALS.GUARD_G2,
    ok(4, 'Infección respiratoria febril.'),
    VALIDATE,
    60,
    100,
  ),
  history(
    'H18',
    'P2',
    P,
    4,
    '16:00',
    'Rinorrea y malestar general',
    VITALS.MIN,
    ok(5, 'Cuadro gripal leve.'),
    VALIDATE,
    95,
    30,
  ),
  history(
    'H19',
    'D3',
    D,
    3,
    '07:15',
    'Convulsión en casa, ahora somnoliento',
    VITALS.SEIZURE,
    { kind: 'FAILED' },
    { action: 'MANUAL', level: 1 },
    2,
    240,
  ),
  history(
    'H20',
    'P3',
    P,
    3,
    '09:30',
    'Dolor en el pecho tipo punzada al moverse',
    VITALS.MID,
    ok(2, 'Dolor torácico: descartar origen cardiaco.'),
    correct(
      3,
      'Dolor mecánico que se reproduce a la palpación; sin signos de alarma.',
    ),
    50,
    90,
  ),
  history(
    'H21',
    'D4',
    D,
    3,
    '11:50',
    'Quemadura en el antebrazo con agua hirviendo',
    VITALS.LOW,
    ok(4, 'Quemadura localizada de extensión limitada.'),
    VALIDATE,
    75,
    60,
  ),
  history(
    'H22',
    'P4',
    P,
    3,
    '14:10',
    'Dolor de muela intenso',
    VITALS.MIN,
    ok(5, 'Odontalgia sin compromiso sistémico.'),
    correct(4, 'Dolor que no cede con analgésico oral y edema facial.'),
    100,
    40,
  ),
  history(
    'H23',
    'D5',
    D,
    2,
    '06:40',
    'Debilidad en el brazo derecho y dificultad para hablar desde hace una hora',
    VITALS.STROKE,
    ok(2, 'Déficit neurológico agudo: posible ataque cerebrovascular.'),
    VALIDATE,
    52,
    240,
  ),
  history(
    'H24',
    'P5',
    P,
    2,
    '09:05',
    'Dolor abdominal tipo cólico y vómito',
    VITALS.MID,
    ok(3, 'Dolor abdominal con vómito y taquicardia leve.'),
    VALIDATE,
    45,
    120,
  ),
  history(
    'H25',
    'D6',
    D,
    2,
    '11:35',
    'Dolor en la rodilla tras una caída',
    VITALS.LOW,
    ok(4, 'Trauma de rodilla sin deformidad referida.'),
    VALIDATE,
    85,
    45,
  ),
  history(
    'H26',
    'P6',
    P,
    2,
    '13:55',
    'Cefalea leve y congestión nasal',
    VITALS.MIN,
    ok(5, 'Síntomas leves de vía aérea superior.', 'OPENROUTER'),
    VALIDATE,
    120,
    30,
  ),
  history(
    'H27',
    'D7',
    D,
    1,
    '07:25',
    'Dolor torácico y sudoración fría',
    VITALS.CHEST,
    ok(
      2,
      'Dolor torácico con cortejo vegetativo: descartar síndrome coronario agudo.',
    ),
    VALIDATE,
    9,
    210,
  ),
  history(
    'H28',
    'P7',
    P,
    1,
    '09:50',
    'Fiebre y dolor de garganta que impide tragar',
    VITALS.MID_FEVER,
    ok(4, 'Faringitis febril sin dificultad respiratoria.'),
    correct(
      3,
      'Fiebre alta persistente y dolor que limita la ingesta de líquidos.',
    ),
    60,
    60,
  ),
  history(
    'H29',
    'D8',
    D,
    1,
    '12:15',
    'Lumbalgia crónica agudizada',
    VITALS.LOW,
    ok(4, 'Lumbalgia agudizada sin déficit neurológico.'),
    VALIDATE,
    90,
    45,
  ),
  history(
    'H30',
    'P8',
    P,
    1,
    '14:40',
    'Esguince de muñeca',
    VITALS.LOW,
    ok(4, 'Trauma menor de muñeca.'),
    VALIDATE,
    70,
    40,
  ),
];

/**
 * Escenarios vivos (relativos a "ahora"; PA-F09-1): 1 pre-registro pendiente, 2 en espera de triage (una es el caso
 * de las 7:42, sin sugerencia ni decisión) y 3 clasificadas en la cola (una de nivel II a 4 min de la alerta, que
 * cuenta desde la clasificación: DT-02-api).
 */
export const SEED_LIVE: readonly SeedScenario[] = [
  {
    code: 'L1',
    patient: 'P5',
    origin: P,
    complaint: 'Dolor abdominal y vómito desde anoche',
    source: 'VOICE_ON_DEVICE',
    when: { minutesAgo: 0 },
    target: 'PENDING',
    at: { preRegistered: -12 },
  },
  {
    code: 'L2',
    patient: 'D1',
    origin: D,
    complaint: 'Dolor torácico opresivo de 40 minutos',
    source: 'TYPED',
    when: { minutesAgo: 11 },
    target: 'WAITING_TRIAGE',
    vitals: VITALS.CASE_742,
    at: { vitals: 8 },
  },
  {
    code: 'L3',
    patient: 'P3',
    origin: P,
    complaint: 'Fiebre y dolor de garganta desde hace 2 días',
    source: 'VOICE_ON_DEVICE',
    when: { minutesAgo: 24 },
    target: 'WAITING_TRIAGE',
    at: { preRegistered: -26 },
  },
  {
    code: 'L4',
    patient: 'P4',
    origin: P,
    complaint: 'Dificultad para respirar desde esta mañana',
    source: 'VOICE_ON_DEVICE',
    when: { minutesAgo: 40 },
    target: 'TRIAGED',
    vitals: VITALS.RESP,
    llm: ok(
      2,
      'Dificultad respiratoria con taquipnea, hipoxemia y taquicardia.',
    ),
    decision: VALIDATE,
    at: { preRegistered: -30, vitals: 6, suggestion: 9, decision: 14 },
  },
  {
    code: 'L5',
    patient: 'D2',
    origin: D,
    complaint: 'Dolor lumbar intenso al levantar peso',
    source: 'TYPED',
    when: { minutesAgo: 55 },
    target: 'TRIAGED',
    vitals: VITALS.MID,
    llm: ok(
      3,
      'Dolor lumbar agudo con taquicardia leve, sin déficit referido.',
    ),
    decision: VALIDATE,
    at: { vitals: 12, suggestion: 16, decision: 40 },
  },
  {
    code: 'L6',
    patient: 'P2',
    origin: P,
    complaint: 'Corte en la mano con un cuchillo de cocina',
    source: 'TYPED',
    when: { minutesAgo: 80 },
    target: 'TRIAGED',
    vitals: VITALS.LOW,
    llm: ok(4, 'Herida en mano sin sangrado activo referido.'),
    decision: VALIDATE,
    at: { preRegistered: -20, vitals: 10, suggestion: 12, decision: 30 },
  },
];

/** Históricos primero (en orden de llegada) y después los vivos: un paciente nunca tiene dos atenciones activas. */
export const SEED_SCENARIOS: readonly SeedScenario[] = [
  ...[...SEED_HISTORY].sort(
    (a, b) => arrivalOffsetKey(a) - arrivalOffsetKey(b),
  ),
  ...SEED_LIVE,
];

function arrivalOffsetKey(s: SeedScenario): number {
  if (!('daysAgo' in s.when)) return 0;
  const [hh, mm] = s.when.time.split(':').map(Number);
  return -s.when.daysAgo * 1440 + hh * 60 + mm;
}

// ---------------------------------------------------------------- tiempo

/** Instante de la hora `hh:mm` de Bogotá, `daysAgo` días antes de la fecha civil `today` (YYYY-MM-DD de Bogotá). */
export function bogotaInstant(
  today: string,
  daysAgo: number,
  time: string,
): Date {
  const [y, m, d] = today.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(
    Date.UTC(y, m - 1, d - daysAgo, hh + BOGOTA_OFFSET_HOURS, mm),
  );
}

/** Llegada prevista del escenario con el "ahora" del seed y la fecha civil de hoy en Bogotá. */
export function plannedArrival(
  s: SeedScenario,
  now: Date,
  today: string,
): Date {
  return 'daysAgo' in s.when
    ? bogotaInstant(today, s.when.daysAgo, s.when.time)
    : new Date(now.getTime() - s.when.minutesAgo * MINUTE);
}

export function plusMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * MINUTE);
}

/** Texto con el prefijo de los datos de desarrollo. */
export function withPrefix(id: SeedIdentity, text: string): string {
  return `${id.prefix}${text}`;
}
