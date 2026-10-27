import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { toProblem } from './problem-details.filter.js';

describe('toProblem', () => {
  it('traduce una HttpException a problem+json con title y status', () => {
    expect(toProblem(new NotFoundException('No existe'), '/api/v1/x')).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'No existe',
      instance: '/api/v1/x',
    });
  });

  it('conserva los errores por campo de la validación', () => {
    const p = toProblem(
      new BadRequestException({
        detail: 'inválido',
        errors: [{ field: 'level', message: 'max 5' }],
      }),
    );
    expect(p).toMatchObject({
      status: 400,
      title: 'Bad Request',
      detail: 'inválido',
      errors: [{ field: 'level', message: 'max 5' }],
    });
  });

  it('no filtra mensajes internos en errores desconocidos ni en 5xx', () => {
    expect(
      toProblem(new Error('SELECT * FROM patients — secreto')),
    ).toMatchObject({ status: 500, detail: 'Error interno.' });
    expect(
      toProblem(new ServiceUnavailableException('host db-interna:5432')),
    ).toMatchObject({ status: 503, detail: 'Error interno.' });
  });

  it('R36: un 400 del body-parser no repite el cuerpo enviado por el cliente', () => {
    const p = toProblem(
      new BadRequestException(
        'Unexpected token \'j\', "{"email": juan.perez@x.co}" is not valid JSON',
      ),
    );
    expect(p).toMatchObject({
      status: 400,
      detail: 'La petición está mal formada.',
    });
    expect(JSON.stringify(p)).not.toContain('juan');
  });
});
