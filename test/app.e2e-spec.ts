import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { buildOpenApiDocument, configureApp } from '../src/app.setup.js';

describe('API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health responde 200 con la hora del servidor', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      time: expect.any(String) as string,
    });
    expect(Number.isNaN(Date.parse((res.body as { time: string }).time))).toBe(
      false,
    );
  });

  it('una ruta inexistente responde 404 en application/problem+json', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/no-existe')
      .expect(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(JSON.parse(res.text)).toMatchObject({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
    });
  });

  it('las rutas cuelgan del prefijo /api/v1', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('el OpenAPI generado incluye /api/v1/health y el esquema ProblemDetailsDto', () => {
    const doc = buildOpenApiDocument(app);
    expect(Object.keys(doc.paths)).toContain('/api/v1/health');
    expect(doc.components?.schemas).toHaveProperty('ProblemDetailsDto');
    expect(doc.paths['/api/v1/health'].get?.responses.default).toMatchObject({
      content: {
        'application/problem+json': {
          schema: { $ref: '#/components/schemas/ProblemDetailsDto' },
        },
      },
    });
  });
});
