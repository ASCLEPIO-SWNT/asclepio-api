import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  answeredDimensions,
  DIMENSIONS,
  detectRedFlags,
  FIXED_QUESTIONS,
  type InterviewTurn,
  nextFallback,
  RED_FLAGS,
  type RedFlag,
  validateQuestion,
} from './interview.rules.js';

const FIXTURE = join(process.cwd(), 'test', 'fixtures', 'red-flag-cases.json');
/**
 * SHA-256 fijado del fixture compartido (D5): asclepio-mobile copia el archivo literalmente y fija el mismo valor.
 * Un cambio en los casos exige cambiar este hash en los dos repos.
 */
const FIXTURE_SHA256 =
  '2d75bdbd0ba08e8e1c9d29ccc40c94ab8c9ca003c34ee8c642409c4da83fe6b7';

interface Case {
  text: string;
  expected: RedFlag[];
}
const raw = readFileSync(FIXTURE);
const cases = JSON.parse(raw.toString('utf8')) as Case[];

const turn = (
  dimension: InterviewTurn['dimension'],
  answer: string | null = 'DEV respuesta',
): InterviewTurn => ({ dimension, question: '¿Pregunta?', answer });

const output = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    done: false,
    question: '¿Cuándo empezaron tus síntomas?',
    dimension: 'ONSET',
    redFlagSuspected: false,
    ...over,
  });

describe('interview.rules (F-11-api)', () => {
  describe('fixture compartido red-flag-cases.json', () => {
    it('R4: el hash SHA-256 del fixture es el fijado (mismo archivo en asclepio-mobile)', () => {
      expect(createHash('sha256').update(raw).digest('hex')).toBe(
        FIXTURE_SHA256,
      );
    });

    it('R4: cada RedFlag tiene al menos dos casos positivos y hay casos negativos', () => {
      for (const flag of RED_FLAGS) {
        const n = cases.filter((c) => c.expected.includes(flag)).length;
        expect([flag, n >= 2]).toEqual([flag, true]);
      }
      expect(
        cases.filter((c) => c.expected.length === 0).length,
      ).toBeGreaterThanOrEqual(5);
      for (const c of cases) {
        for (const f of c.expected) expect(RED_FLAGS).toContain(f);
      }
    });

    it.each(cases.map((c) => [c.text, c.expected] as const))(
      'R4: detectRedFlags(%j) → %j',
      (text, expected) => {
        expect(detectRedFlags(text)).toEqual(expected);
      },
    );
  });

  describe('detectRedFlags', () => {
    it('R11: une las señales de varios textos sin repetir y en el orden de RED_FLAGS', () => {
      expect(
        detectRedFlags(
          'me desmayé',
          'dolor en el pecho',
          'me desmayé otra vez',
        ),
      ).toEqual(['CHEST_PAIN', 'LOSS_OF_CONSCIOUSNESS']);
      expect(detectRedFlags('', 'tos')).toEqual([]);
    });
  });

  describe('validateQuestion', () => {
    it('R12: acepta una salida con la forma exacta, un solo "?" final y una dimensión no cubierta', () => {
      expect(validateQuestion(output(), [])).toEqual({
        valid: true,
        output: {
          done: false,
          question: '¿Cuándo empezaron tus síntomas?',
          dimension: 'ONSET',
          redFlagSuspected: false,
        },
      });
    });

    it.each([
      ['no es JSON', 'hola'],
      ['un arreglo', '[]'],
      ['null', 'null'],
      ['un campo extra', output({ level: 2 })],
      [
        'sin done',
        JSON.stringify({
          question: '¿A?',
          dimension: 'ONSET',
          redFlagSuspected: false,
        }),
      ],
      ['done no booleano', output({ done: 'no' })],
      ['redFlagSuspected no booleano', output({ redFlagSuspected: 1 })],
      ['dimensión desconocida', output({ dimension: 'MOOD' })],
      ['pregunta no string', output({ question: 7 })],
      ['pregunta vacía', output({ question: '  ' })],
      ['pregunta de más de 140', output({ question: `¿${'a'.repeat(139)}?` })],
      ['sin "?" final', output({ question: '¿Cuándo empezó' })],
      ['dos "?"', output({ question: '¿Cuándo? ¿Dónde?' })],
    ])('R12: rechaza %s', (_label, raw) => {
      expect(validateQuestion(raw, []).valid).toBe(false);
    });

    it('R12: rechaza una dimensión ya cubierta en los turnos', () => {
      expect(validateQuestion(output(), [turn('ONSET')]).valid).toBe(false);
      expect(
        validateQuestion(output({ dimension: 'DURATION' }), [turn('ONSET')])
          .valid,
      ).toBe(true);
    });

    it.each([
      '¿Crees que tienes una infección?',
      '¿Sabías que podría ser migraña?',
      '¿Te dieron un diagnóstico antes?',
      '¿Es probable que sea el estómago?',
      '¿Toma algo para el dolor?',
      '¿Tómate un té y me cuentas?',
      '¿Usas 500 mg de algo?',
      '¿Te tomaste alguna pastilla?',
      '¿Usas algún medicamento para la presión?',
      '¿Te recomiendo reposo, de acuerdo?',
      '¿Qué nivel de dolor sientes?',
      '¿Te hicieron triage antes?',
      '¿Sabes que no es grave?',
      '¿Crees que es grave?',
      '¿Sientes que es urgente?',
      '¿TIENES fiebre?',
    ])('R12: rechaza la pregunta prohibida %j', (question) => {
      expect(validateQuestion(output({ question }), []).valid).toBe(false);
    });

    it('R12: los patrones prohibidos son palabras completas ("síntomas" no contiene "toma", "amigo" no contiene "mg")', () => {
      expect(
        validateQuestion(
          output({ question: '¿Algún amigo notó tus síntomas?' }),
          [],
        ).valid,
      ).toBe(true);
    });

    it('R13: conserva redFlagSuspected y done de la salida válida', () => {
      const r = validateQuestion(
        output({ done: true, redFlagSuspected: true }),
        [],
      );
      expect(r).toMatchObject({
        valid: true,
        output: { done: true, redFlagSuspected: true },
      });
    });
  });

  describe('FIXED_QUESTIONS y nextFallback', () => {
    it('R12: hay una pregunta fija por dimensión y todas pasan el validador', () => {
      expect(Object.keys(FIXED_QUESTIONS).sort()).toEqual(
        [...DIMENSIONS].sort(),
      );
      for (const d of DIMENSIONS) {
        const r = validateQuestion(
          output({ dimension: d, question: FIXED_QUESTIONS[d] }),
          [],
        );
        expect([d, r.valid]).toEqual([d, true]);
      }
    });

    it('R12: nextFallback da la pregunta fija de la primera dimensión no cubierta', () => {
      expect(nextFallback([])).toEqual({
        kind: 'QUESTION',
        dimension: DIMENSIONS[0],
        question: FIXED_QUESTIONS[DIMENSIONS[0]],
      });
      expect(nextFallback([turn('ONSET', null), turn('INTENSITY')])).toEqual({
        kind: 'QUESTION',
        dimension: 'DURATION',
        question: FIXED_QUESTIONS.DURATION,
      });
    });

    it('R12: nextFallback responde DONE si ya están cubiertas todas las dimensiones', () => {
      expect(nextFallback(DIMENSIONS.map((d) => turn(d)))).toEqual({
        kind: 'DONE',
      });
    });

    it('R14: answeredDimensions cuenta las dimensiones con respuesta (no "No sé")', () => {
      expect(
        answeredDimensions([
          turn('ONSET'),
          turn('DURATION', null),
          turn('LOCATION'),
        ]),
      ).toBe(2);
    });
  });
});
