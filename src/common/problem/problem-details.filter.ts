import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ProblemDetailsDto } from './problem-details.dto.js';

export const PROBLEM_JSON = 'application/problem+json';

/** Traduce cualquier excepción a application/problem+json. Nunca expone trazas ni mensajes internos en 5xx. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const problem = toProblem(exception, req.originalUrl ?? req.url);
    if (problem.status >= 500) {
      // Solo el tipo de error y la ruta: sin cuerpo de la petición (puede contener datos personales).
      this.logger.error({
        msg: 'unhandled_error',
        error: exception instanceof Error ? exception.name : 'unknown',
        path: req.path,
      });
    }
    res.status(problem.status).type(PROBLEM_JSON).send(JSON.stringify(problem));
  }
}

export function toProblem(
  exception: unknown,
  instance?: string,
): ProblemDetailsDto {
  if (!(exception instanceof HttpException)) {
    return {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'Error interno.',
      instance,
    };
  }
  const status = exception.getStatus();
  const title = (HttpStatus[status] ?? 'Error')
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  const body = exception.getResponse();
  const problem: ProblemDetailsDto = {
    type: 'about:blank',
    title,
    status,
    instance,
  };
  if (typeof body === 'string') {
    problem.detail = body;
  } else if (body && typeof body === 'object') {
    const b = body as {
      detail?: unknown;
      message?: unknown;
      errors?: ProblemDetailsDto['errors'];
    };
    const detail = b.detail ?? b.message;
    if (typeof detail === 'string') problem.detail = detail;
    else if (Array.isArray(detail)) problem.detail = detail.join('; ');
    if (Array.isArray(b.errors)) problem.errors = b.errors;
  }
  if (status >= 500) problem.detail = 'Error interno.';
  return problem;
}
