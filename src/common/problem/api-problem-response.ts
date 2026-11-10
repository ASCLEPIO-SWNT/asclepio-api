import { ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ProblemDetailsDto } from './problem-details.dto.js';

/** Respuesta de error documentada como application/problem+json (RFC 9457) con su código y descripción. */
export const ApiProblemResponse = (status: number, description: string) =>
  ApiResponse({
    status,
    description,
    content: {
      'application/problem+json': {
        schema: { $ref: getSchemaPath(ProblemDetailsDto) },
      },
    },
  });
