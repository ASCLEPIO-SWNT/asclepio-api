import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { buildOpenApiDocument } from '../src/app.setup.js';
import { createApp } from './e2e-app.js';

describe('Contrato OpenAPI 0.2.x (e2e, sin base)', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it('R8: el documento tiene info.version 0.2.x, las seis rutas nuevas y el esquema de seguridad bearer solo en las protegidas', () => {
    const doc = buildOpenApiDocument(app);
    expect(doc.info.version).toBe('0.2.1');
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/api/v1/auth/login',
      '/api/v1/auth/patient/accounts',
      '/api/v1/auth/patient/login',
      '/api/v1/health',
      '/api/v1/me',
      '/api/v1/public/consent',
      '/api/v1/public/tenants',
    ]);
    expect(doc.components?.securitySchemes?.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(doc.paths['/api/v1/me'].get?.security).toEqual([{ bearer: [] }]);
    expect(doc.paths['/api/v1/auth/login'].post?.security).toBeUndefined();
  });

  it('R20: CreatePatientAccountDto documenta consentVersion como string', () => {
    const doc = buildOpenApiDocument(app);
    const schema = doc.components?.schemas?.CreatePatientAccountDto as {
      properties: Record<string, { type?: string }>;
    };
    expect(schema.properties.consentVersion.type).toBe('string');
  });

  it('R2: no existe endpoint de renovación de tokens', async () => {
    const doc = buildOpenApiDocument(app);
    expect(Object.keys(doc.paths).join(' ')).not.toMatch(/refresh|renew/i);
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').expect(404);
  });

  it('R39: los endpoints limitados documentan 429 problem+json con Retry-After', () => {
    const doc = buildOpenApiDocument(app);
    const limited = [
      doc.paths['/api/v1/auth/login'].post,
      doc.paths['/api/v1/auth/patient/login'].post,
      doc.paths['/api/v1/auth/patient/accounts'].post,
      doc.paths['/api/v1/public/tenants'].get,
      doc.paths['/api/v1/public/consent'].get,
    ];
    for (const op of limited) {
      expect(op?.responses['429']).toMatchObject({
        headers: { 'Retry-After': expect.any(Object) as object },
        content: { 'application/problem+json': expect.any(Object) as object },
      });
    }
    expect(doc.paths['/api/v1/health'].get?.responses['429']).toBeUndefined();
  });

  it('R36: todos los endpoints de F-01 declaran los errores como application/problem+json', () => {
    const doc = buildOpenApiDocument(app);
    for (const path of Object.values(doc.paths)) {
      for (const op of [path.get, path.post]) {
        if (!op) continue;
        expect(op.responses.default).toMatchObject({
          content: { 'application/problem+json': expect.any(Object) as object },
        });
      }
    }
  });

  it('R18: GET /me documenta oneOf StaffMeDto | PatientMeDto con discriminador kind e identityVerified', () => {
    const doc = buildOpenApiDocument(app);
    const ok = doc.paths['/api/v1/me'].get?.responses['200'] as unknown as {
      content: { 'application/json': { schema: Record<string, unknown> } };
    };
    expect(ok.content['application/json'].schema).toMatchObject({
      oneOf: [
        { $ref: '#/components/schemas/StaffMeDto' },
        { $ref: '#/components/schemas/PatientMeDto' },
      ],
      discriminator: { propertyName: 'kind' },
    });
    expect(doc.components?.schemas?.PatientMeDto).toMatchObject({
      required: expect.arrayContaining(['identityVerified']) as string[],
    });
  });
});
