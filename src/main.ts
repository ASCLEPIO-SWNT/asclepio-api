import { existsSync } from 'node:fs';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { API_PREFIX, buildOpenApiDocument, configureApp } from './app.setup.js';

async function bootstrap() {
  // ponytail: .env con process.loadEnvFile (Node >= 20.12), sin dependencia dotenv.
  if (existsSync('.env')) process.loadEnvFile('.env');
  // Logs JSON estructurados. Prohibido registrar datos personales (docs/conventions.md).
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ json: true }),
  });
  configureApp(app);
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, buildOpenApiDocument(app));
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
