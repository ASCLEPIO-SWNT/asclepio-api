// npm run openapi:export → escribe el contrato en openapi/asclepio-api.v1.json (ADR 0007).
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { buildOpenApiDocument, configureApp } from './app.setup.js';

async function exportOpenApi() {
  // El export solo construye el documento: no firma tokens ni conecta a la base (Prisma es perezoso, D16).
  // Se fijan valores de un solo uso para que la validación de arranque (D2, D10) no exija un .env.
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  process.env.PATIENT_CONSENT_VERSION ||= 'openapi-export';
  // F-04-api: el export no llama al LLM; se fijan valores ficticios si faltan.
  for (const name of [
    'GROQ_API_KEY',
    'GROQ_MODEL',
    'OPENROUTER_API_KEY',
    'OPENROUTER_MODEL',
  ]) {
    process.env[name] ||= 'openapi-export';
  }
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  const out = join(process.cwd(), 'openapi', 'asclepio-api.v1.json');
  writeFileSync(out, JSON.stringify(buildOpenApiDocument(app), null, 2) + '\n');
  await app.close();
  process.stdout.write(`OpenAPI escrito en ${out}\n`);
}
void exportOpenApi();
