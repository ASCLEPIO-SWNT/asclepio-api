/**
 * Reglas puras de la entrevista de síntomas (F-11-api, design.md): dimensiones, señales de alarma, validador de la
 * pregunta del LLM y preguntas fijas. Sin Nest ni base. Las mismas reglas viven en Kotlin en asclepio-mobile y ambos
 * lados se prueban con el fixture compartido test/fixtures/red-flag-cases.json (D5, ADR 0010).
 */

export const DIMENSIONS = [
  'ONSET',
  'DURATION',
  'INTENSITY',
  'LOCATION',
  'ASSOCIATED',
  'HISTORY',
  'MEDS_ALLERGIES',
  'ALARM_SIGNS',
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** Señales de alarma (PA-F11-1, PROVISIONAL: no validada clínicamente). Mismo orden que el CHECK de la migración. */
export const RED_FLAGS = [
  'CHEST_PAIN',
  'BREATHING_DIFFICULTY',
  'LOSS_OF_CONSCIOUSNESS',
  'SEIZURE',
  'SEVERE_BLEEDING',
  'STROKE_SIGNS',
  'SUICIDAL_IDEATION',
] as const;
export type RedFlag = (typeof RED_FLAGS)[number];

export const INTERVIEW_ENGINES = ['ON_DEVICE', 'SERVER'] as const;
export type InterviewEngine = (typeof INTERVIEW_ENGINES)[number];
export const INTERVIEW_ENDED_BY = [
  'COMPLETE',
  'MAX_QUESTIONS',
  'RED_FLAG',
  'PATIENT',
] as const;
export type InterviewEndedBy = (typeof INTERVIEW_ENDED_BY)[number];

/** Límites del glosario de la spec. */
export const INTERVIEW_LIMITS = Object.freeze({
  /** Turnos de la entrevista guardada (F-11.AC1). */
  maxTurns: 6,
  /** Turnos que admite next-question: con 5 responde DONE (R14, PA-F11-4). */
  maxRequestTurns: 5,
  /** Dimensiones respondidas para aceptar done = true del LLM (R14, PA-F11-4). */
  minAnsweredForDone: 3,
  modelIdMax: 80,
  turnQuestionMax: 200,
  turnAnswerMax: 500,
  /** Motivo de consulta de next-question: el mismo máximo que COMPLAINT_MAX del pre-registro. */
  chiefComplaintMax: 2000,
  /** Pregunta del LLM (validador). */
  llmQuestionMax: 140,
});

/** Turno de la entrevista: answer null = "No sé / prefiero no responder". */
export interface InterviewTurn {
  dimension: Dimension;
  question: string;
  answer: string | null;
}

export type NextQuestion =
  | { kind: 'QUESTION'; dimension: Dimension; question: string }
  | { kind: 'DONE' }
  | { kind: 'RED_FLAG'; redFlags: RedFlag[] };

/** Minúsculas, sin tildes (NFD sin marcas) y con los espacios colapsados. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Patrones de las señales sobre el texto normalizado (PA-F11-1, PROVISIONALES). Solo sintaxis común a JS y a
 * java.util.regex (\b, clases, grupos y cuantificadores acotados) para que el port en Kotlin sea literal. Riesgo
 * aceptado (design.md): falsos positivos como una negación ("no tengo dolor en el pecho"); en la duda se escala.
 */
export const RED_FLAG_PATTERNS: Readonly<Record<RedFlag, readonly string[]>> =
  Object.freeze({
    CHEST_PAIN: [
      '\\b(dolor|duele|dolia|dolio|presion|opresion|peso|aprieta|apretado|oprimido)\\b[^.,;]{0,30}\\bpecho\\b',
      '\\bpecho\\b[^.,;]{0,15}\\b(apretado|oprimido|duele|dolia|dolor|aprieta)\\b',
      '\\bdolor toracico\\b',
    ],
    BREATHING_DIFFICULTY: [
      '\\b(no puedo|no puede|no podia|me cuesta|le cuesta|dificultad para|problemas para)\\s+respirar\\b',
      '\\bahog(o|a|ado|ada|ando|arme)\\b',
      '\\bfalta\\s+(de\\s+|el\\s+)?aire\\b',
      '\\bsin aire\\b',
      '\\bno me entra (el\\s+)?aire\\b',
      '\\bdisnea\\b',
    ],
    LOSS_OF_CONSCIOUSNESS: [
      '\\bdesmay\\w*',
      '\\bperd\\w*\\s+(el\\s+|la\\s+)?(de\\s+)?(conocimiento|conciencia|sentido)\\b',
      '\\binconscien\\w*',
      '\\bno supe de mi\\b',
    ],
    SEIZURE: ['\\bconvuls\\w*', '\\b(ataque|crisis)\\s+(de\\s+)?epilep\\w*'],
    SEVERE_BLEEDING: [
      '\\bsangrado\\s+(muy\\s+)?(abundante|fuerte|intens\\w*)',
      '\\bhemorragia\\w*',
      '\\b(sangra|sangro|sangrando)\\s+(mucho|muchisimo|demasiado|bastante|sin parar)\\b',
      '\\bmucha sangre\\b',
      '\\bno (para|deja) de sangrar\\b',
      '\\bvomit\\w*\\s+(con\\s+)?sangre\\b',
    ],
    STROKE_SIGNS: [
      // Cara o boca torcida, chueca o caída (también con palabras en medio: "la boca se me ve chueca").
      '\\b(cara|boca)\\b[^.,;]{0,20}\\b(torcid|chuec|caid|cayo)\\w*',
      '\\b(torci|cayo)\\w*\\s+(la\\s+)?(cara|boca)\\b',
      // Debilidad, adormecimiento u hormigueo de un lado: estado → lado/extremidad con lateralidad.
      '\\b(debil\\w*|durm\\w*|duerm\\w*|dormid\\w*|adormec\\w*|entumi\\w*|hormigueo|no siento|paraliz\\w*|no (puedo|puede|podia) mover)\\b[^.,;]{0,40}\\b(un lado|medio cuerpo|mitad del cuerpo|mitad de la cara|media cara|lado (derecho|izquierdo)|(brazo|pierna|mano|pie)s? (derech|izquierd)\\w*)',
      // Extremidad con lateralidad → estado ("la mano derecha entumida").
      '\\b(brazo|pierna|mano|pie)s? (derech|izquierd)\\w*[^.,;]{0,20}\\b(debil\\w*|dormid\\w*|adormec\\w*|entumi\\w*|paraliz\\w*)',
      '\\bno (puedo|puede|podia) mover (el|la|mi|su)\\s+(brazo|pierna|mano|cara)\\b',
      // Dificultad para hablar.
      '\\b(dificultad para|no puedo|no puede|no podia|me cuesta|le cuesta)\\s+hablar\\b',
      '\\bhabl\\w*\\s+(enredad|arrastrad|rar|trabad)\\w*',
      '\\btrab\\w*\\s+la\\s+lengua\\b',
      '\\blengua\\s+trabad\\w*',
    ],
    SUICIDAL_IDEATION: [
      '\\bsuicid\\w*',
      '\\b(quiero|quisiera|ganas de)\\s+morir\\w*',
      '\\bmatarme\\b',
      '\\bquitarme la vida\\b',
      '\\bacabar con mi vida\\b',
      '\\bno quiero (seguir\\s+)?(vivir|viviendo)\\b',
      '\\bhacerme dano\\b',
    ],
  });

const COMPILED: [RedFlag, RegExp[]][] = RED_FLAGS.map((f) => [
  f,
  RED_FLAG_PATTERNS[f].map((p) => new RegExp(p)),
]);

/** Señales de alarma de uno o varios textos, sin repetir y en el orden de RED_FLAGS (R4, R11). */
export function detectRedFlags(...texts: string[]): RedFlag[] {
  const norm = texts.map(normalizeText);
  return COMPILED.filter(([, res]) =>
    norm.some((t) => res.some((re) => re.test(t))),
  ).map(([f]) => f);
}

/** Une las señales sin quitar ninguna (D3): las de `base` en su orden y después las nuevas en el orden de RED_FLAGS. */
export function mergeRedFlags(
  base: readonly RedFlag[],
  extra: readonly RedFlag[],
): RedFlag[] {
  const out = [...base];
  for (const f of extra) if (!out.includes(f)) out.push(f);
  return out;
}

/**
 * Patrones prohibidos en la pregunta (glosario): diagnóstico, tratamiento o dosis y nivel o gravedad. Se buscan como
 * palabras completas sobre el texto normalizado ("síntomas" no contiene "toma").
 */
export const FORBIDDEN_QUESTION_PATTERNS: readonly string[] = Object.freeze([
  'tienes',
  'podria ser',
  'diagnostico',
  'es probable que',
  'toma',
  'tomate',
  'mg',
  'pastilla',
  'medicamento para',
  'te recomiendo',
  'nivel',
  'triage',
  'no es grave',
  'es grave',
  'urgente',
]);

const FORBIDDEN = FORBIDDEN_QUESTION_PATTERNS.map(
  (p) => new RegExp(`\\b${p.replace(/ /g, '\\s+')}\\b`),
);

/** Salida del LLM del fallback (esquema estricto). */
export interface QuestionOutput {
  done: boolean;
  question: string;
  dimension: Dimension;
  redFlagSuspected: boolean;
}

/** Esquema JSON de la salida, para response_format json_schema strict. */
export const QUESTION_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['done', 'question', 'dimension', 'redFlagSuspected'],
  properties: {
    done: { type: 'boolean' },
    question: { type: 'string' },
    dimension: { type: 'string', enum: [...DIMENSIONS] },
    redFlagSuspected: { type: 'boolean' },
  },
});

export type QuestionValidation =
  | { valid: true; output: QuestionOutput }
  /** redFlagSuspected solo si el esquema era válido y falló el texto de la pregunta (R13 enmendado). */
  | { valid: false; reason: string; redFlagSuspected?: boolean };

const OUTPUT_KEYS = ['dimension', 'done', 'question', 'redFlagSuspected'];

const isDimension = (v: unknown): v is Dimension =>
  (DIMENSIONS as readonly unknown[]).includes(v);

/**
 * Validador determinista de la salida del LLM (glosario, R12, F-11.AC2): JSON con exactamente los cuatro campos y sus
 * tipos, pregunta de 1–140 caracteres que termina en "?" con un solo "?", dimensión no cubierta en los turnos y sin
 * patrones prohibidos. El motivo de rechazo no lleva el contenido.
 */
export function validateQuestion(
  raw: string,
  turns: readonly InterviewTurn[],
): QuestionValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { valid: false, reason: 'NOT_JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { valid: false, reason: 'NOT_OBJECT' };
  }
  const o = parsed as Record<string, unknown>;
  if (Object.keys(o).sort().join() !== OUTPUT_KEYS.join()) {
    return { valid: false, reason: 'KEYS' };
  }
  if (typeof o.done !== 'boolean' || typeof o.redFlagSuspected !== 'boolean') {
    return { valid: false, reason: 'TYPES' };
  }
  if (!isDimension(o.dimension)) return { valid: false, reason: 'DIMENSION' };
  if (typeof o.question !== 'string') return { valid: false, reason: 'TYPES' };
  // Esquema válido: desde aquí los rechazos son del texto y conservan la sospecha (R13 enmendado).
  const textFail = (reason: string): QuestionValidation => ({
    valid: false,
    reason,
    redFlagSuspected: o.redFlagSuspected as boolean,
  });
  const question = o.question.trim();
  if (!question || question.length > INTERVIEW_LIMITS.llmQuestionMax) {
    return textFail('LENGTH');
  }
  if (!question.endsWith('?') || question.split('?').length !== 2) {
    return textFail('QUESTION_MARK');
  }
  if (turns.some((t) => t.dimension === o.dimension)) {
    return textFail('REPEATED_DIMENSION');
  }
  const norm = normalizeText(question);
  if (FORBIDDEN.some((re) => re.test(norm))) {
    return textFail('FORBIDDEN');
  }
  return {
    valid: true,
    output: {
      done: o.done,
      question,
      dimension: o.dimension,
      redFlagSuspected: o.redFlagSuspected,
    },
  };
}

/** Una pregunta fija por dimensión (R12): sencillas, en español y que pasan el validador. */
export const FIXED_QUESTIONS: Readonly<Record<Dimension, string>> =
  Object.freeze({
    ONSET: '¿Cuándo empezaron tus síntomas?',
    DURATION: '¿Los síntomas son continuos o van y vienen?',
    INTENSITY: 'Del 0 al 10, ¿qué tan fuerte es la molestia?',
    LOCATION: '¿En qué parte del cuerpo sientes la molestia?',
    ASSOCIATED: '¿Has notado otros síntomas, como fiebre, vómito o mareo?',
    HISTORY:
      '¿Sufres de alguna enfermedad crónica, como diabetes o hipertensión?',
    MEDS_ALLERGIES: '¿Usas algún medicamento a diario o eres alérgico a algo?',
    ALARM_SIGNS:
      '¿Has tenido desmayos, dificultad para respirar o dolor en el pecho?',
  });

/** Pregunta fija de la primera dimensión no cubierta en los turnos o, si están todas, DONE (R12). */
export function nextFallback(turns: readonly InterviewTurn[]): NextQuestion {
  const covered = new Set(turns.map((t) => t.dimension));
  const d = DIMENSIONS.find((x) => !covered.has(x));
  return d
    ? { kind: 'QUESTION', dimension: d, question: FIXED_QUESTIONS[d] }
    : { kind: 'DONE' };
}

/** Dimensiones distintas con respuesta (answer distinto de null) (R14). */
export function answeredDimensions(turns: readonly InterviewTurn[]): number {
  return new Set(turns.filter((t) => t.answer !== null).map((t) => t.dimension))
    .size;
}

// ---------------------------------------------------------------- Enmienda tras ai:eval (humano, 2026-11-18)
// Lógica pura y portable (F-11-mobile porta la misma decisión de done y redFlagSuspected).

const PAIN = /\b(dolor|duele|duelen|doler)\w*/;

/** true si el texto normalizado menciona dolor ("dolor", "duele", "doler" y sus formas). */
export function mentionsPain(text: string): boolean {
  return PAIN.test(normalizeText(text));
}

/**
 * Primera dimensión obligatoria no cubierta antes de aceptar done (R14 enmendado): ONSET siempre y LOCATION si el
 * motivo o alguna respuesta mencionan dolor. "Cubierta" = preguntada en los turnos (aunque la respuesta sea null).
 */
export function missingMandatory(
  chiefComplaintText: string,
  turns: readonly InterviewTurn[],
): Dimension | null {
  const covered = new Set(turns.map((t) => t.dimension));
  if (!covered.has('ONSET')) return 'ONSET';
  const pain =
    mentionsPain(chiefComplaintText) ||
    turns.some((t) => t.answer !== null && mentionsPain(t.answer));
  return pain && !covered.has('LOCATION') ? 'LOCATION' : null;
}

/**
 * Decide la respuesta a partir de una salida del LLM ya validada (R13, R14 y sus enmiendas). null = salida inválida
 * sin sospecha atendible: el llamador reintenta o usa la pregunta fija.
 * - redFlagSuspected (de una salida con esquema válido, aunque falle el texto) → RED_FLAG, salvo con 0 turnos
 *   respondidos, donde se ignora (las reglas sobre el motivo ya se aplicaron antes).
 * - done con ≥3 dimensiones respondidas → DONE si están cubiertas las obligatorias; si no, su pregunta fija.
 * - En otro caso, la pregunta del LLM.
 */
export function resolveOutput(
  chiefComplaintText: string,
  turns: readonly InterviewTurn[],
  checked: QuestionValidation,
): NextQuestion | null {
  const suspected = checked.valid
    ? checked.output.redFlagSuspected
    : checked.redFlagSuspected === true;
  if (suspected && answeredDimensions(turns) > 0) {
    return { kind: 'RED_FLAG', redFlags: [] };
  }
  if (!checked.valid) return null;
  const o = checked.output;
  if (
    o.done &&
    answeredDimensions(turns) >= INTERVIEW_LIMITS.minAnsweredForDone
  ) {
    const missing = missingMandatory(chiefComplaintText, turns);
    return missing
      ? {
          kind: 'QUESTION',
          dimension: missing,
          question: FIXED_QUESTIONS[missing],
        }
      : { kind: 'DONE' };
  }
  return { kind: 'QUESTION', dimension: o.dimension, question: o.question };
}
