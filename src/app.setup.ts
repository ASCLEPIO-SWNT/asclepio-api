import {
  BadRequestException,
  INestApplication,
  type ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import {
  DocumentBuilder,
  getSchemaPath,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { BEARER_SCHEME } from './common/auth/decorators.js';
import { ProblemDetailsFilter } from './common/problem/problem-details.filter.js';
import { ProblemDetailsDto } from './common/problem/problem-details.dto.js';

/** Versión semver del contrato publicado en openapi/asclepio-api.v1.json (ADR 0007). */
export const API_CONTRACT_VERSION = '0.5.0';
export const API_PREFIX = 'api/v1';

/**
 * Aplana los errores de class-validator a { field, message }. Los anidados (F-03: items[] de los hallazgos) llevan la
 * ruta con puntos ("items.0.kind"). El nombre de un campo no declarado lo elige el cliente: no se repite en el
 * mensaje (R36 de F-01, R22 de F-03).
 */
function flattenErrors(
  errors: ValidationError[],
  prefix = '',
): { field: string; message: string }[] {
  return errors.flatMap((e) => {
    const field = prefix + e.property;
    return [
      ...Object.entries(e.constraints ?? {}).map(([rule, message]) => ({
        field,
        message:
          rule === 'whitelistValidation' ? 'Campo no admitido.' : message,
      })),
      ...flattenErrors(e.children ?? [], `${field}.`),
    ];
  });
}

/** ValidationPipe global (docs/conventions.md): whitelist, forbidNonWhitelisted y 400 problem+json con errors[]. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        detail: 'La petición no superó la validación.',
        errors: flattenErrors(errors),
      }),
  });
}

/** Configuración común a main.ts, openapi-export.ts y las pruebas e2e. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  // Retry-After expuesto para que la web lea la espera tras un 429 (R39 de F-01-api, R7 de F-01-web).
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    exposedHeaders: ['Retry-After'],
  });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ProblemDetailsFilter());
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Asclepio API')
    .setDescription(
      'Triage de urgencias asistido por IA. La IA propone, el profesional decide.',
    )
    .setVersion(API_CONTRACT_VERSION)
    // JWT de acceso (F-01): personal (aud asclepio-staff) o paciente (aud asclepio-patient).
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      BEARER_SCHEME,
    )
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
        const o = op as {
          responses: Record<string, unknown>;
          security?: Record<string, string[]>[];
        };
        o.responses.default ??= problem;
        // @StaffRoles() y @PatientOnly() declaran cada uno el esquema bearer: se deja una sola entrada.
        if (o.security) {
          o.security = [
            ...new Map(o.security.map((s) => [JSON.stringify(s), s])).values(),
          ];
        }
      }
    }
  }
  return doc;
}
