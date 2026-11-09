import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../../app.setup.js';
import {
  CreateTriageDecisionDto,
  validateDecisionBody,
} from './triage-decision.dto.js';

const pipe = createValidationPipe();

type FieldErrors = { field: string; message: string }[];

const SID = '6f1c1d2e-0000-4000-8000-000000000001';
const REASON = 'DEV-test dolor irradiado a brazo izquierdo';

/** Ejecuta el ValidationPipe global; devuelve los errores del 400 o el DTO transformado si la forma es válida. */
async function shape(
  body: unknown,
): Promise<{ errors: FieldErrors } | { dto: CreateTriageDecisionDto }> {
  try {
    const dto = (await pipe.transform(body, {
      type: 'body',
      metatype: CreateTriageDecisionDto,
    })) as CreateTriageDecisionDto;
    return { dto };
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return {
      errors: (
        (e as BadRequestException).getResponse() as { errors: FieldErrors }
      ).errors,
    };
  }
}

async function fieldsOf(body: unknown): Promise<string[] | null> {
  const r = await shape(body);
  return 'errors' in r ? [...new Set(r.errors.map((e) => e.field))] : null;
}

/** Forma válida + reglas del cuerpo (422). */
async function business(body: object) {
  const r = await shape(body);
  if (!('dto' in r)) throw new Error(`forma inválida: ${JSON.stringify(r)}`);
  return validateDecisionBody(r.dto);
}

describe('CreateTriageDecisionDto (forma, 400)', () => {
  it('R4: los tres cuerpos bien formados pasan la validación de forma', async () => {
    for (const body of [
      { action: 'VALIDATE', suggestionId: SID },
      { action: 'CORRECT', suggestionId: SID, level: 2, reason: REASON },
      { action: 'MANUAL', level: 4 },
    ]) {
      expect(await fieldsOf(body)).toBeNull();
    }
  });

  it('R4: acción ausente, desconocida o de otro tipo → 400 con action en errors[]', async () => {
    for (const body of [
      {},
      { suggestionId: SID },
      { action: 'APPROVE', suggestionId: SID },
      { action: 'validate', suggestionId: SID },
      { action: 1 },
      { action: null, level: 3 },
    ]) {
      expect(await fieldsOf(body)).toContain('action');
    }
  });

  it('R4: suggestionId ausente o que no es UUID en VALIDATE y CORRECT → 400 con suggestionId', async () => {
    for (const action of ['VALIDATE', 'CORRECT']) {
      const extra =
        action === 'CORRECT' ? { level: 2, reason: REASON } : ({} as object);
      for (const suggestionId of [undefined, 'abc', 123, null, '']) {
        expect(await fieldsOf({ action, suggestionId, ...extra })).toEqual([
          'suggestionId',
        ]);
      }
    }
  });

  it('R4: level en VALIDATE, suggestionId o reason en MANUAL y reason en VALIDATE → 400 con el campo', async () => {
    const cases: [object, string][] = [
      [{ action: 'VALIDATE', suggestionId: SID, level: 3 }, 'level'],
      [{ action: 'VALIDATE', suggestionId: SID, level: null }, 'level'],
      [{ action: 'VALIDATE', suggestionId: SID, reason: REASON }, 'reason'],
      [{ action: 'MANUAL', level: 3, suggestionId: SID }, 'suggestionId'],
      [{ action: 'MANUAL', level: 3, reason: REASON }, 'reason'],
      [{ action: 'MANUAL', level: 3, reason: '' }, 'reason'],
    ];
    for (const [body, field] of cases) {
      expect([body, await fieldsOf(body)]).toEqual([body, [field]]);
    }
  });

  it('R4: level no entero (2.5, "2", null, ausente) en CORRECT o MANUAL → 400 con level; reason que no es texto → 400', async () => {
    for (const level of [2.5, '2', null, undefined, true]) {
      expect(await fieldsOf({ action: 'MANUAL', level })).toEqual(['level']);
      expect(
        await fieldsOf({
          action: 'CORRECT',
          suggestionId: SID,
          level,
          reason: REASON,
        }),
      ).toEqual(['level']);
    }
    expect(
      await fieldsOf({
        action: 'CORRECT',
        suggestionId: SID,
        level: 2,
        reason: 42,
      }),
    ).toEqual(['reason']);
  });

  it('R4: campos no declarados (decidedAt, decidedBy, finalLevel, tenantId, id u otros) → 400 sin repetir el nombre en el mensaje', async () => {
    for (const field of [
      'decidedAt',
      'decidedBy',
      'finalLevel',
      'tenantId',
      'id',
      'triagedAt',
      'foo',
    ]) {
      const r = await shape({ action: 'MANUAL', level: 3, [field]: 'x' });
      expect(r).toEqual({
        errors: [{ field, message: 'Campo no admitido.' }],
      });
    }
  });

  it('R20: la hora o el responsable enviados por el cliente (decidedAt, decidedBy, triagedAt, triagedBy) se rechazan con 400', async () => {
    for (const field of ['decidedAt', 'decidedBy', 'triagedAt', 'triagedBy']) {
      expect(
        await fieldsOf({
          action: 'VALIDATE',
          suggestionId: SID,
          [field]: '2026-11-09T17:00:00Z',
        }),
      ).toEqual([field]);
    }
  });

  it('R23: los mensajes de error no repiten los valores enviados', async () => {
    const r = await shape({
      action: 'MANUAL',
      level: 2.5,
      reason: 'DEV-test-secreto',
      suggestionId: 'DEV-test-no-uuid',
    });
    expect(JSON.stringify(r)).not.toMatch(
      /DEV-test-secreto|DEV-test-no-uuid|2\.5/,
    );
  });
});

describe('validateDecisionBody (reglas del cuerpo, 422)', () => {
  it('R5: level 0 o 6 en CORRECT o MANUAL → 422 con level en errors[]', async () => {
    for (const level of [0, 6, -1, 100]) {
      expect(await business({ action: 'MANUAL', level })).toEqual({
        errors: [{ field: 'level', message: expect.any(String) as string }],
      });
      expect(
        await business({
          action: 'CORRECT',
          suggestionId: SID,
          level,
          reason: REASON,
        }),
      ).toMatchObject({ errors: [{ field: 'level' }] });
    }
  });

  it('R5: en CORRECT el motivo ausente, vacío, solo espacios o de 501 caracteres → 422 con reason; 500 caracteres se admite', async () => {
    for (const reason of [
      undefined,
      '',
      '   ',
      'x'.repeat(501),
      ` ${'x'.repeat(501)} `,
    ]) {
      expect(
        await business({
          action: 'CORRECT',
          suggestionId: SID,
          level: 2,
          reason,
        }),
      ).toEqual({
        errors: [{ field: 'reason', message: expect.any(String) as string }],
      });
    }
    expect(
      await business({
        action: 'CORRECT',
        suggestionId: SID,
        level: 2,
        reason: 'x'.repeat(500),
      }),
    ).toMatchObject({ input: { reason: 'x'.repeat(500) } });
  });

  it('R5: el motivo se guarda sin los espacios iniciales y finales', async () => {
    expect(
      await business({
        action: 'CORRECT',
        suggestionId: SID,
        level: 1,
        reason: `  ${REASON}\n `,
      }),
    ).toEqual({
      input: { action: 'CORRECT', suggestionId: SID, level: 1, reason: REASON },
    });
  });

  it('R5: los cuerpos válidos pasan a la entrada de las reglas sin campos de más', async () => {
    expect(await business({ action: 'VALIDATE', suggestionId: SID })).toEqual({
      input: { action: 'VALIDATE', suggestionId: SID },
    });
    expect(await business({ action: 'MANUAL', level: 5 })).toEqual({
      input: { action: 'MANUAL', level: 5 },
    });
  });

  it('R23: los mensajes del 422 no repiten el motivo ni el nivel enviados', async () => {
    const r = await business({
      action: 'CORRECT',
      suggestionId: SID,
      level: 9,
      reason: `DEV-test-secreto${'x'.repeat(600)}`,
    });
    expect(JSON.stringify(r)).not.toMatch(/DEV-test-secreto|9/);
  });
});
