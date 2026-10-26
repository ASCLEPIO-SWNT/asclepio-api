import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import {
  DocumentBuilder,
  getSchemaPath,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { ProblemDetailsFilter } from './common/problem/problem-details.filter.js';
import { ProblemDetailsDto } from './common/problem/problem-details.dto.js';

/** Versión semver del contrato publicado en openapi/asclepio-api.v1.json (ADR 0007). */
export const API_CONTRACT_VERSION = '0.1.0';
export const API_PREFIX = 'api/v1';

/** Configuración común a main.ts, openapi-export.ts y las pruebas e2e. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new BadRequestException({
          detail: 'La petición no superó la validación.',
          errors: errors.flatMap((e) =>
            Object.values(e.constraints ?? {}).map((message) => ({
              field: e.property,
              message,
            })),
          ),
        }),
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Asclepio API')
    .setDescription(
      'Triage de urgencias asistido por IA. La IA propone, el profesional decide.',
    )
    .setVersion(API_CONTRACT_VERSION)
    .build();
  const doc = SwaggerModule.createDocument(app, config, {
    extraModels: [ProblemDetailsDto],
  });
  // Todo error de la API es application/problem+json (ADR 0007): se declara como respuesta "default" en cada operación.
  const problem = {
    description: 'Error en application/problem+json (RFC 9457)',
    content: {
      'application/problem+json': {
        schema: { $ref: getSchemaPath(ProblemDetailsDto) },
      },
    },
  };
  for (const path of Object.values(doc.paths)) {
    for (const op of Object.values(path)) {
      if (op && typeof op === 'object' && 'responses' in op) {
        (op as { responses: Record<string, unknown> }).responses.default ??=
          problem;
      }
    }
  }
  return doc;
}
