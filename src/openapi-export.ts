// npm run openapi:export → escribe el contrato en openapi/asclepio-api.v1.json (ADR 0007).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { buildOpenApiDocument, configureApp } from './app.setup.js';

async function exportOpenApi() {
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  const out = join(process.cwd(), 'openapi', 'asclepio-api.v1.json');
  writeFileSync(out, JSON.stringify(buildOpenApiDocument(app), null, 2) + '\n');
  await app.close();
  process.stdout.write(`OpenAPI escrito en ${out}\n`);
}
void exportOpenApi();
