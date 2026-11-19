import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../../app.setup.js';
import { CreatePreRegistrationDto } from './encounters.dto.js';

const pipe = createValidationPipe();

type FieldErrors = { field: string; message: string }[];

/** Ejecuta el ValidationPipe global; devuelve los errores del 400 o null si el cuerpo es válido. */
async function errorsOf(body: unknown): Promise<FieldErrors | null> {
  try {
    await pipe.transform(body, {
      type: 'body',
      metatype: CreatePreRegistrationDto,
    });
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return ((e as BadRequestException).getResponse() as { errors: FieldErrors })
      .errors;
  }
}

const ECHO = 'DEV-ECO-7f3a';

const BASE = {
  siteId: '66666666-6666-4666-8666-666666666666',
  chiefComplaintText: 'DEV-test dolor de cabeza desde ayer',
  complaintSource: 'TYPED',
};

const turn = (over: Record<string, unknown> = {}) => ({
  dimension: 'ONSET',
  question: '¿Cuándo empezaron tus síntomas?',
  answer: 'DEV-test ayer por la tarde',
  ...over,
});

const interview = (over: Record<string, unknown> = {}) => ({
  engine: 'ON_DEVICE',
  modelId: 'gemma-4-e2b-it',
  turns: [turn(), turn({ dimension: 'INTENSITY', answer: null })],
  redFlags: [],
  endedBy: 'COMPLETE',
  ...over,
});

describe('CreatePreRegistrationDto con interview (F-11-api, forma, 400)', () => {
  it('R3: sin interview el cuerpo de 0.10.0 sigue siendo válido', async () => {
    expect(await errorsOf(BASE)).toBeNull();
  });

  it('R1: una entrevista bien formada pasa (0 o 6 turnos, answer null, señales sin repetir, ambos motores)', async () => {
    expect(await errorsOf({ ...BASE, interview: interview() })).toBeNull();
    expect(
      await errorsOf({
        ...BASE,
        interview: interview({
          engine: 'SERVER',
          turns: [],
          redFlags: ['CHEST_PAIN', 'SEIZURE'],
          endedBy: 'RED_FLAG',
        }),
      }),
    ).toBeNull();
    expect(
      await errorsOf({
        ...BASE,
        interview: interview({
          turns: Array.from({ length: 6 }, () => turn()),
          endedBy: 'MAX_QUESTIONS',
        }),
      }),
    ).toBeNull();
  });

  it.each([
    ['interview no objeto', ECHO, 'interview'],
    ['interview null', null, 'interview'],
    [
      'más de 6 turnos',
      interview({ turns: Array.from({ length: 7 }, () => turn()) }),
      'interview.turns',
    ],
    ['turns no lista', interview({ turns: ECHO }), 'interview.turns'],
    ['engine desconocido', interview({ engine: ECHO }), 'interview.engine'],
    ['endedBy desconocido', interview({ endedBy: ECHO }), 'interview.endedBy'],
    ['sin endedBy', interview({ endedBy: undefined }), 'interview.endedBy'],
    [
      'modelId de más de 80',
      interview({ modelId: `${ECHO}${'m'.repeat(80)}` }),
      'interview.modelId',
    ],
    ['modelId vacío', interview({ modelId: '  ' }), 'interview.modelId'],
    [
      'redFlags repetidas',
      interview({ redFlags: ['SEIZURE', 'SEIZURE'] }),
      'interview.redFlags',
    ],
    [
      'redFlag desconocida',
      interview({ redFlags: [ECHO] }),
      'interview.redFlags',
    ],
    ['campo extra en interview', interview({ score: ECHO }), 'interview.score'],
    [
      'dimension desconocida',
      interview({ turns: [turn({ dimension: ECHO })] }),
      'interview.turns.0.dimension',
    ],
    [
      'question de más de 200',
      interview({ turns: [turn({ question: `${ECHO}${'q'.repeat(200)}` })] }),
      'interview.turns.0.question',
    ],
    [
      'question vacía',
      interview({ turns: [turn({ question: '' })] }),
      'interview.turns.0.question',
    ],
    [
      'answer de más de 500',
      interview({ turns: [turn({ answer: `${ECHO}${'a'.repeat(500)}` })] }),
      'interview.turns.0.answer',
    ],
    [
      'answer vacía',
      interview({ turns: [turn({ answer: '   ' })] }),
      'interview.turns.0.answer',
    ],
    [
      'answer ausente',
      interview({ turns: [turn({ answer: undefined })] }),
      'interview.turns.0.answer',
    ],
    [
      'campo extra en un turno',
      interview({ turns: [turn({ score: ECHO })] }),
      'interview.turns.0.score',
    ],
    ['turno no objeto', interview({ turns: [ECHO] }), 'interview.turns.0'],
  ])(
    'R2: %s → 400 con el campo, sin repetir el valor enviado',
    async (_label, value, field) => {
      const errors = await errorsOf({ ...BASE, interview: value });
      expect(errors).not.toBeNull();
      expect(errors!.map((e) => e.field)).toContain(field);
      expect(JSON.stringify(errors)).not.toContain(ECHO);
    },
  );
});
