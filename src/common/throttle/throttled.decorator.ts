import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiTooManyRequestsResponse, getSchemaPath } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ProblemDetailsDto } from '../problem/problem-details.dto.js';

/** Respuesta 429 documentada (problem+json con Retry-After), común a @Throttled() y @PublicThrottled(). */
export const ApiThrottledResponse = () =>
  ApiTooManyRequestsResponse({
    description:
      'Demasiadas peticiones desde esta IP a este endpoint (application/problem+json).',
    headers: {
      'Retry-After': {
        description: 'Segundos hasta que termina la ventana del límite.',
        schema: { type: 'integer' },
      },
    },
    content: {
      'application/problem+json': {
        schema: { $ref: getSchemaPath(ProblemDetailsDto) },
      },
    },
  });

/**
 * Límite de R39 de F-01 (10 peticiones / 60 s por IP y endpoint) SIN @Public(): el endpoint sigue exigiendo token
 * (el guard global corre antes). Lo usan los endpoints de escritura del paciente (R14 de F-02, D19).
 */
export const Throttled = () =>
  applyDecorators(UseGuards(ThrottlerGuard), ApiThrottledResponse());
