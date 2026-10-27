import type { INestApplication, LoggerService, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

export interface E2eOptions {
  controllers?: Type<unknown>[];
  imports?: Type<unknown>[];
  overrides?: (
    | { provide: unknown; useValue: unknown }
    | { provide: unknown; useClass: Type<unknown> }
  )[];
  logger?: LoggerService;
}

/** App completa (AppModule) con la misma configuración que main.ts; admite controladores de prueba y overrides. */
export async function createApp(
  opts: E2eOptions = {},
): Promise<INestApplication<App>> {
  let builder = Test.createTestingModule({
    imports: [AppModule, ...(opts.imports ?? [])],
    controllers: opts.controllers ?? [],
  });
  for (const o of opts.overrides ?? []) {
    const target = builder.overrideProvider(o.provide);
    builder =
      'useClass' in o
        ? target.useClass(o.useClass)
        : target.useValue(o.useValue);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    logger: false,
  });
  if (opts.logger) app.useLogger(opts.logger);
  configureApp(app);
  await app.init();
  return app;
}

export function problem(res: {
  headers: Record<string, string>;
  text: string;
}) {
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  return JSON.parse(res.text) as {
    type: string;
    title: string;
    status: number;
    detail?: string;
    errors?: { field: string; message: string }[];
  };
}
