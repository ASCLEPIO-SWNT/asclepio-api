import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../../app.setup.js';
import {
  FINDING_DESCRIPTION_MAX,
  FINDINGS_MAX,
} from '../symptom-findings.rules.js';
import {
  CreateSymptomFindingsDto,
  CreateVitalSignsDto,
} from './clinical-capture.dto.js';

const pipe = createValidationPipe();

type FieldErrors = { field: string; message: string }[];

/** Ejecuta el ValidationPipe global; devuelve los errores del 400 o null si el cuerpo es válido. */
async function errorsOf(
  metatype: typeof CreateVitalSignsDto | typeof CreateSymptomFindingsDto,
  body: unknown,
): Promise<FieldErrors | null> {
  try {
    await pipe.transform(body, { type: 'body', metatype });
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return ((e as BadRequestException).getResponse() as { errors: FieldErrors })
      .errors;
  }
}

const VALID_VITALS = {
  respiratoryRate: 18,
  oxygenSaturation: 94,
  supplementalOxygen: false,
  systolicBp: 150,
  heartRate: 112,
  consciousness: 'A',
  temperatureC: 37.4,
  diastolicBp: 95,
  glucoseMgDl: 110,
};

const VALID_FINDINGS = {
  items: [
    { kind: 'SYMPTOM', description: 'DEV-test dolor torácico opresivo' },
    { kind: 'FINDING', description: 'DEV-test diaforesis' },
    { kind: 'COMPLAINT_NOTE', description: 'DEV-test inicia hace 2 horas' },
  ],
};

describe('CreateVitalSignsDto (forma, 400)', () => {
  it('R3: una toma bien formada (también sin opcionales, o con obligatorios ausentes o null) pasa la validación de forma', async () => {
    expect(await errorsOf(CreateVitalSignsDto, VALID_VITALS)).toBeNull();
    // La ausencia de obligatorios es 422 (R4) y la decide validateVitalSigns, no el DTO.
    expect(await errorsOf(CreateVitalSignsDto, {})).toBeNull();
    expect(
      await errorsOf(CreateVitalSignsDto, {
        ...VALID_VITALS,
        diastolicBp: null,
        heartRate: null,
      }),
    ).toBeNull();
  });

  it('R3: un signo numérico que no es número, un entero con decimales o un temperatureC con dos decimales → 400 con el campo', async () => {
    for (const [field, value] of [
      ['heartRate', '112'],
      ['heartRate', 112.5],
      ['respiratoryRate', true],
      ['oxygenSaturation', 94.1],
      ['systolicBp', {}],
      ['diastolicBp', [95]],
      ['glucoseMgDl', 'NaN'],
      ['temperatureC', 37.45],
      ['temperatureC', '37.4'],
      ['heartRate', Number.POSITIVE_INFINITY],
    ] as const) {
      const errors = await errorsOf(CreateVitalSignsDto, {
        ...VALID_VITALS,
        [field]: value,
      });
      expect([field, value, errors?.map((e) => e.field)]).toEqual([
        field,
        value,
        [field],
      ]);
    }
  });

  it('R3: supplementalOxygen no booleano o consciousness fuera de A/C/V/P/U → 400 con el campo', async () => {
    for (const [field, value] of [
      ['supplementalOxygen', 'true'],
      ['supplementalOxygen', 1],
      ['consciousness', 'X'],
      ['consciousness', 'a'],
      ['consciousness', 'GCS15'],
    ] as const) {
      const errors = await errorsOf(CreateVitalSignsDto, {
        ...VALID_VITALS,
        [field]: value,
      });
      expect([field, errors?.map((e) => e.field)]).toEqual([field, [field]]);
    }
  });

  it('R3: un campo que no pertenece a la lista de signos aceptada (Glasgow, dolor, spo2…) → 400 con el campo', async () => {
    for (const field of ['glasgow', 'painScore', 'spo2', 'zzNoDeclarado']) {
      const errors = await errorsOf(CreateVitalSignsDto, {
        ...VALID_VITALS,
        [field]: 1,
      });
      expect(errors).toEqual([{ field, message: 'Campo no admitido.' }]);
    }
  });

  it('R13: recordedAt, recordedBy, tenantId, encounterId, id o createdAt en el cuerpo → 400', async () => {
    for (const field of [
      'recordedAt',
      'recordedBy',
      'tenantId',
      'encounterId',
      'id',
      'createdAt',
    ]) {
      const errors = await errorsOf(CreateVitalSignsDto, {
        ...VALID_VITALS,
        [field]: '2020-01-01T00:00:00Z',
      });
      expect(errors?.map((e) => e.field)).toEqual([field]);
    }
  });

  it('R22: los mensajes de error no repiten el valor enviado', async () => {
    const errors = await errorsOf(CreateVitalSignsDto, {
      ...VALID_VITALS,
      heartRate: 'zz-valor-enviado',
      consciousness: 'zz-otro-valor',
    });
    expect(JSON.stringify(errors)).not.toContain('zz-');
  });
});

describe('CreateSymptomFindingsDto (forma, 400)', () => {
  it('R8: entre 1 y 20 elementos con kind válido y description de 1 a 500 (sin contar espacios extremos) pasa', async () => {
    expect(await errorsOf(CreateSymptomFindingsDto, VALID_FINDINGS)).toBeNull();
    expect(
      await errorsOf(CreateSymptomFindingsDto, {
        items: Array.from({ length: FINDINGS_MAX }, () => ({
          kind: 'SYMPTOM',
          description: `  ${'a'.repeat(FINDING_DESCRIPTION_MAX)}  `,
        })),
      }),
    ).toBeNull();
  });

  it('R8: items ausente, no lista, vacío o con 21 elementos → 400 con el campo items', async () => {
    const one = VALID_FINDINGS.items[0];
    for (const body of [
      {},
      { items: null },
      { items: 'x' },
      { items: [] },
      { items: Array.from({ length: FINDINGS_MAX + 1 }, () => one) },
    ]) {
      const errors = await errorsOf(CreateSymptomFindingsDto, body);
      expect(errors?.map((e) => e.field)).toContain('items');
    }
  });

  it('R8: kind inválido, description ausente, en blanco o de 501, o un elemento que no es objeto → 400 con la ruta del campo', async () => {
    for (const [item, field] of [
      [{ kind: 'DIAGNOSIS', description: 'DEV-test' }, 'items.0.kind'],
      [{ description: 'DEV-test' }, 'items.0.kind'],
      [{ kind: 'SYMPTOM' }, 'items.0.description'],
      [{ kind: 'SYMPTOM', description: '   ' }, 'items.0.description'],
      [
        {
          kind: 'SYMPTOM',
          description: 'a'.repeat(FINDING_DESCRIPTION_MAX + 1),
        },
        'items.0.description',
      ],
      [{ kind: 'SYMPTOM', description: 42 }, 'items.0.description'],
      ['texto suelto', 'items.0'],
    ] as const) {
      const errors = await errorsOf(CreateSymptomFindingsDto, {
        items: [item],
      });
      expect([item, errors?.map((e) => e.field)]).toEqual([
        item,
        expect.arrayContaining([field]),
      ]);
    }
  });

  it('R8: un campo no declarado en el cuerpo o dentro de un elemento (code, severity…) → 400', async () => {
    expect(
      (
        await errorsOf(CreateSymptomFindingsDto, {
          ...VALID_FINDINGS,
          zzNoDeclarado: 1,
        })
      )?.map((e) => e.field),
    ).toEqual(['zzNoDeclarado']);
    expect(
      (
        await errorsOf(CreateSymptomFindingsDto, {
          items: [{ ...VALID_FINDINGS.items[0], code: 'R07.4' }],
        })
      )?.map((e) => e.field),
    ).toEqual(['items.0.code']);
  });

  it('R13: recordedAt, recordedBy, tenantId, encounterId, id o createdAt en el cuerpo o en un elemento → 400', async () => {
    for (const field of [
      'recordedAt',
      'recordedBy',
      'tenantId',
      'encounterId',
      'id',
      'createdAt',
    ]) {
      expect(
        (
          await errorsOf(CreateSymptomFindingsDto, {
            ...VALID_FINDINGS,
            [field]: 'x',
          })
        )?.map((e) => e.field),
      ).toEqual([field]);
      expect(
        (
          await errorsOf(CreateSymptomFindingsDto, {
            items: [{ ...VALID_FINDINGS.items[0], [field]: 'x' }],
          })
        )?.map((e) => e.field),
      ).toEqual([`items.0.${field}`]);
    }
  });

  it('R22: los mensajes de error no repiten la descripción ni el kind enviados', async () => {
    const errors = await errorsOf(CreateSymptomFindingsDto, {
      items: [{ kind: 'zz-kind', description: `zz-texto ${'b'.repeat(600)}` }],
    });
    expect(JSON.stringify(errors)).not.toContain('zz-');
  });
});
