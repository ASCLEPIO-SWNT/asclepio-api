import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiTooManyRequestsResponse, getSchemaPath } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/decorators.js';
import { ProblemDetailsDto } from '../problem/problem-details.dto.js';

/** @Public() + límite de R39 (10 peticiones / 60 s por IP y endpoint) con 429 problem+json y Retry-After. */
export const PublicThrottled = () =>
  applyDecorators(
    Public(),
    UseGuards(ThrottlerGuard),
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
    }),
  );
