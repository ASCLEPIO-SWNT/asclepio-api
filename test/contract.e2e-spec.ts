import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { buildOpenApiDocument } from '../src/app.setup.js';
import { VITAL_SIGN_DEFINITIONS } from '../src/modules/encounters/vital-signs.rules.js';
import { createApp } from './e2e-app.js';

describe('Contrato OpenAPI 0.7.x (e2e, sin base)', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it('R8: el documento tiene las rutas de F-01 y de F-02 y el esquema de seguridad bearer solo en las protegidas', () => {
    const doc = buildOpenApiDocument(app);
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/api/v1/auth/login',
      '/api/v1/auth/patient/accounts',
      '/api/v1/auth/patient/login',
      '/api/v1/encounters',
      '/api/v1/encounters/{id}',
      '/api/v1/encounters/{id}/cancel',
      '/api/v1/encounters/{id}/clinical-capture',
      '/api/v1/encounters/{id}/close',
      '/api/v1/encounters/{id}/start-care',
      '/api/v1/encounters/{id}/symptom-findings',
      '/api/v1/encounters/{id}/triage-decision',
      '/api/v1/encounters/{id}/triage-suggestions',
      '/api/v1/encounters/{id}/vital-signs',
      '/api/v1/health',
      '/api/v1/me',
      '/api/v1/patient/pre-registrations',
      '/api/v1/patient/pre-registrations/{id}',
      '/api/v1/patient/profile',
      '/api/v1/patients',
      '/api/v1/pre-registrations',
      '/api/v1/pre-registrations/{id}/confirm',
      '/api/v1/pre-registrations/{id}/reject',
      '/api/v1/public/consent',
      '/api/v1/public/tenants',
      '/api/v1/queue',
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

  it('R45: los 14 endpoints de F-02 declaran el esquema bearer', () => {
    const doc = buildOpenApiDocument(app);
    const ops = [
      doc.paths['/api/v1/patient/profile'].get,
      doc.paths['/api/v1/patient/profile'].patch,
      doc.paths['/api/v1/patient/pre-registrations'].post,
      doc.paths['/api/v1/patient/pre-registrations'].get,
      doc.paths['/api/v1/patient/pre-registrations/{id}'].get,
      doc.paths['/api/v1/patients'].get,
      doc.paths['/api/v1/patients'].post,
      doc.paths['/api/v1/pre-registrations'].get,
      doc.paths['/api/v1/pre-registrations/{id}/confirm'].post,
      doc.paths['/api/v1/pre-registrations/{id}/reject'].post,
      doc.paths['/api/v1/encounters'].post,
      doc.paths['/api/v1/encounters'].get,
      doc.paths['/api/v1/encounters/{id}'].get,
      doc.paths['/api/v1/encounters/{id}/cancel'].post,
    ];
    for (const op of ops) expect(op?.security).toEqual([{ bearer: [] }]);
  });

  it('R21: los tres endpoints de F-03 declaran el esquema bearer y sus respuestas (F-03 publicó 0.4.0; F-04 subió a 0.5.0, F-05 a 0.6.0 y F-06 a 0.7.0)', () => {
    const doc = buildOpenApiDocument(app);
    expect(doc.info.version).toBe('0.7.0');
    const vs = doc.paths['/api/v1/encounters/{id}/vital-signs'].post;
    const sf = doc.paths['/api/v1/encounters/{id}/symptom-findings'].post;
    const cc = doc.paths['/api/v1/encounters/{id}/clinical-capture'].get;
    for (const op of [vs, sf, cc])
      expect(op?.security).toEqual([{ bearer: [] }]);
    expect(vs?.responses['201']).toBeDefined();
    expect(sf?.responses['201']).toBeDefined();
    expect(cc?.responses['200']).toBeDefined();
  });

  it('R1: info.version es 0.7.0 (F-04 publicó 0.5.0) y las dos operaciones de F-04 declaran bearer, sus respuestas y problem+json', () => {
    const doc = buildOpenApiDocument(app);
    expect(doc.info.version).toBe('0.7.0');
    const path = doc.paths['/api/v1/encounters/{id}/triage-suggestions'];
    for (const op of [path.post, path.get]) {
      expect(op?.security).toEqual([{ bearer: [] }]);
      expect(op?.responses.default).toMatchObject({
        content: { 'application/problem+json': expect.any(Object) as object },
      });
      // La sugerencia es una propuesta, nunca una decisión.
      expect(op?.description).toMatch(/PROPUESTA, nunca una decisión/);
    }
    expect(path.post?.responses['201']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/TriageSuggestionDto' },
        },
      },
    });
    expect(path.get?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/TriageSuggestionListDto' },
        },
      },
    });
    expect(path.post?.requestBody).toMatchObject({
      required: false,
      content: {
        'application/json': {
          schema: { type: 'object', additionalProperties: false },
        },
      },
    });
  });

  it('R22: TriageSuggestionDto documenta los campos de R22 (niveles, explicación, factores, proveedor y modelo anulables) y no expone inputSnapshot, rawResponse ni attempts', () => {
    const doc = buildOpenApiDocument(app);
    const schema = doc.components?.schemas?.TriageSuggestionDto as {
      properties: Record<string, { nullable?: boolean; enum?: string[] }>;
      required: string[];
    };
    expect(Object.keys(schema.properties).sort()).toEqual([
      'createdAt',
      'encounterId',
      'explanation',
      'factors',
      'guardApplied',
      'guardReasons',
      'id',
      'latencyMs',
      'llmLevel',
      'model',
      'promptVersion',
      'provider',
      'requestedBy',
      'status',
      'suggestedLevel',
    ]);
    for (const f of [
      'suggestedLevel',
      'llmLevel',
      'explanation',
      'factors',
      'provider',
      'model',
    ]) {
      expect([f, schema.properties[f].nullable]).toEqual([f, true]);
    }
    expect(doc.components?.schemas?.TriageSuggestionStatus).toMatchObject({
      enum: ['OK', 'INVALID_OUTPUT', 'TIMEOUT', 'FAILED'],
    });
    expect(doc.components?.schemas?.LlmProvider).toMatchObject({
      enum: ['GROQ', 'OPENROUTER'],
    });
  });

  it('R22: los endpoints de F-03 declaran los errores como application/problem+json', () => {
    const doc = buildOpenApiDocument(app);
    for (const op of [
      doc.paths['/api/v1/encounters/{id}/vital-signs'].post,
      doc.paths['/api/v1/encounters/{id}/symptom-findings'].post,
      doc.paths['/api/v1/encounters/{id}/clinical-capture'].get,
    ]) {
      expect(op?.responses.default).toMatchObject({
        content: { 'application/problem+json': expect.any(Object) as object },
      });
    }
  });

  it('R3: CreateVitalSignsDto documenta los siete obligatorios como required y la unidad y el rango de cada signo leídos de VITAL_SIGN_DEFINITIONS, marcados como provisionales', () => {
    const doc = buildOpenApiDocument(app);
    const schemas = doc.components?.schemas as Record<
      string,
      {
        required?: string[];
        properties?: Record<
          string,
          {
            type?: string;
            minimum?: number;
            maximum?: number;
            description?: string;
            nullable?: boolean;
          }
        >;
      }
    >;
    const req = schemas.CreateVitalSignsDto;
    expect([...(req.required ?? [])].sort()).toEqual(
      VITAL_SIGN_DEFINITIONS.filter((d) => d.required)
        .map((d) => d.field)
        .sort(),
    );
    for (const d of VITAL_SIGN_DEFINITIONS) {
      const prop = req.properties![d.field];
      expect(prop.description).toContain('PROVISIONAL');
      if (d.min !== undefined) {
        expect([d.field, prop.minimum, prop.maximum]).toEqual([
          d.field,
          d.min,
          d.max,
        ]);
        expect(prop.type).toBe(d.type === 'integer' ? 'integer' : 'number');
        expect(prop.description).toContain(d.unit!);
      }
    }
    expect(JSON.stringify(req.properties!.consciousness)).toContain(
      '#/components/schemas/ConsciousnessLevel',
    );
    expect(schemas.ConsciousnessLevel).toMatchObject({
      enum: ['A', 'C', 'V', 'P', 'U'],
    });
    expect(schemas.SymptomFindingKind).toMatchObject({
      enum: ['SYMPTOM', 'FINDING', 'COMPLAINT_NOTE'],
    });
    expect(schemas.VitalSignsDto.properties!.diastolicBp.nullable).toBe(true);
    for (const name of ['CreateVitalSignsDto', 'CreateSymptomFindingsDto']) {
      const props = Object.keys(schemas[name].properties ?? {});
      for (const banned of [
        'recordedAt',
        'recordedBy',
        'tenantId',
        'encounterId',
        'id',
        'createdAt',
      ]) {
        expect([name, props.includes(banned)]).toEqual([name, false]);
      }
    }
  });

  it('R17: EncounterEventDto.type documenta VITAL_SIGNS_RECORDED y SYMPTOM_FINDINGS_RECORDED', () => {
    const doc = buildOpenApiDocument(app);
    const ev = doc.components?.schemas?.EncounterEventDto as {
      properties: Record<string, { enum?: string[] }>;
    };
    expect(ev.properties.type.enum).toEqual(
      expect.arrayContaining([
        'VITAL_SIGNS_RECORDED',
        'SYMPTOM_FINDINGS_RECORDED',
      ]),
    );
  });

  it('R14: PATCH /patient/profile y POST /patient/pre-registrations documentan 429 problem+json con Retry-After', () => {
    const doc = buildOpenApiDocument(app);
    for (const op of [
      doc.paths['/api/v1/patient/profile'].patch,
      doc.paths['/api/v1/patient/pre-registrations'].post,
    ]) {
      expect(op?.responses['429']).toMatchObject({
        headers: { 'Retry-After': expect.any(Object) as object },
        content: { 'application/problem+json': expect.any(Object) as object },
      });
    }
  });

  it('R47: ningún esquema de petición de F-02 declara horas, tenantId ni status', () => {
    const doc = buildOpenApiDocument(app);
    const schemas = doc.components?.schemas as Record<
      string,
      { properties?: Record<string, unknown> }
    >;
    const requests = [
      'UpdatePatientProfileDto',
      'CreatePreRegistrationDto',
      'CreatePatientDto',
      'ConfirmPreRegistrationDto',
      'RejectPreRegistrationDto',
      'CreateEncounterDto',
      'CancelEncounterDto',
    ];
    for (const name of requests) {
      const props = Object.keys(schemas[name]?.properties ?? {});
      expect(props.length).toBeGreaterThan(0);
      for (const banned of [
        'tenantId',
        'status',
        'origin',
        'arrivalAt',
        'preRegisteredAt',
        'expiresAt',
        'resolvedAt',
        'occurredAt',
        'createdAt',
        'updatedAt',
        'registeredBy',
        'resolvedBy',
      ]) {
        expect([name, props.includes(banned)]).toEqual([name, false]);
      }
    }
    for (const name of [
      'UpdatePatientProfileDto',
      'CreatePreRegistrationDto',
    ]) {
      expect(Object.keys(schemas[name].properties ?? {})).not.toContain(
        'patientId',
      );
    }
  });

  it('R36: todos los endpoints de F-01 declaran los errores como application/problem+json', () => {
    const doc = buildOpenApiDocument(app);
    for (const path of Object.values(doc.paths)) {
      for (const op of [path.get, path.post, path.patch]) {
        if (!op) continue;
        expect(op.responses.default).toMatchObject({
          content: { 'application/problem+json': expect.any(Object) as object },
        });
      }
    }
  });

  it('R49: todos los endpoints de F-01 y F-02 declaran los errores como application/problem+json', () => {
    const doc = buildOpenApiDocument(app);
    for (const path of Object.values(doc.paths)) {
      for (const op of [path.get, path.post, path.patch]) {
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

  // ---------------------------------------------------------------- F-05-api (0.6.0)

  it('R16: info.version es 0.7.0 (F-05 publicó 0.6.0) y POST/GET /encounters/{id}/triage-decision declaran bearer, TriageDecisionDto y problem+json', () => {
    const doc = buildOpenApiDocument(app);
    expect(doc.info.version).toBe('0.7.0');
    const path = doc.paths['/api/v1/encounters/{id}/triage-decision'];
    for (const op of [path.post, path.get]) {
      expect(op?.security).toEqual([{ bearer: [] }]);
      expect(op?.responses.default).toMatchObject({
        content: { 'application/problem+json': expect.any(Object) as object },
      });
    }
    const dto = {
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/TriageDecisionDto' },
        },
      },
    };
    expect(path.post?.responses['201']).toMatchObject(dto);
    expect(path.get?.responses['200']).toMatchObject(dto);
  });

  it('R4: el cuerpo del POST es un oneOf de VALIDATE, CORRECT y MANUAL con discriminador action, sin campos de hora, responsable ni tenant', () => {
    const doc = buildOpenApiDocument(app);
    const body = doc.paths['/api/v1/encounters/{id}/triage-decision'].post
      ?.requestBody as {
      required: boolean;
      content: { 'application/json': { schema: Record<string, unknown> } };
    };
    expect(body.required).toBe(true);
    const ref = (n: string) => `#/components/schemas/${n}`;
    expect(body.content['application/json'].schema).toEqual({
      oneOf: [
        { $ref: ref('ValidateTriageDecisionRequest') },
        { $ref: ref('CorrectTriageDecisionRequest') },
        { $ref: ref('ManualTriageDecisionRequest') },
      ],
      discriminator: {
        propertyName: 'action',
        mapping: {
          VALIDATE: ref('ValidateTriageDecisionRequest'),
          CORRECT: ref('CorrectTriageDecisionRequest'),
          MANUAL: ref('ManualTriageDecisionRequest'),
        },
      },
    });
    const schema = (n: string) =>
      doc.components?.schemas?.[n] as {
        properties: Record<
          string,
          {
            enum?: string[];
            minimum?: number;
            maximum?: number;
            maxLength?: number;
          }
        >;
        required: string[];
      };
    const expected: [string, string[]][] = [
      ['ValidateTriageDecisionRequest', ['action', 'suggestionId']],
      [
        'CorrectTriageDecisionRequest',
        ['action', 'suggestionId', 'level', 'reason'],
      ],
      ['ManualTriageDecisionRequest', ['action', 'level']],
    ];
    for (const [name, fields] of expected) {
      const s = schema(name);
      expect([name, Object.keys(s.properties).sort()]).toEqual([
        name,
        [...fields].sort(),
      ]);
      expect(s.required.sort()).toEqual([...fields].sort());
    }
    expect(schema('CorrectTriageDecisionRequest').properties).toMatchObject({
      action: { enum: ['CORRECT'] },
      level: { minimum: 1, maximum: 5 },
      reason: { maxLength: 500 },
    });
    expect(
      schema('ManualTriageDecisionRequest').properties.level,
    ).toMatchObject({ minimum: 1, maximum: 5 });
  });

  it('R15: TriageDecisionDto documenta id, encounterId, action, level, suggestionId, suggestedLevel, reason, decidedAt y decidedBy', () => {
    const doc = buildOpenApiDocument(app);
    const s = doc.components?.schemas?.TriageDecisionDto as {
      properties: Record<string, { nullable?: boolean }>;
      required: string[];
    };
    const fields = [
      'id',
      'encounterId',
      'action',
      'level',
      'suggestionId',
      'suggestedLevel',
      'reason',
      'decidedAt',
      'decidedBy',
    ];
    expect(Object.keys(s.properties).sort()).toEqual([...fields].sort());
    expect(s.required.sort()).toEqual([...fields].sort());
    for (const f of ['suggestionId', 'suggestedLevel', 'reason']) {
      expect([f, s.properties[f].nullable]).toEqual([f, true]);
    }
  });

  it('R17: EncounterSummaryDto añade finalLevel, triagedAt y triagedBy anulables y EncounterEventDto.type documenta TRIAGE_DECIDED; los esquemas del paciente no cambian', () => {
    const doc = buildOpenApiDocument(app);
    const s = doc.components?.schemas?.EncounterSummaryDto as {
      properties: Record<string, { nullable?: boolean }>;
    };
    for (const f of ['finalLevel', 'triagedAt', 'triagedBy']) {
      expect([f, s.properties[f]?.nullable]).toEqual([f, true]);
    }
    const ev = doc.components?.schemas?.EncounterEventDto as {
      properties: Record<string, { enum?: string[]; description?: string }>;
    };
    expect(ev.properties.type.enum).toContain('TRIAGE_DECIDED');
    expect(ev.properties.type.description).toMatch(/TRIAGE_DECIDED/);
    for (const name of [
      'PatientPreRegistrationDto',
      'EncounterRefDto',
      'PatientProfileDto',
    ]) {
      const schema = doc.components?.schemas?.[name];
      expect([name, schema]).toEqual([name, expect.any(Object)]);
      expect(JSON.stringify(schema)).not.toMatch(
        /finalLevel|triagedAt|triagedBy/,
      );
    }
  });

  it('R22: el POST documenta 201, 400, 401, 403, 404, 409, 422 y el GET 200, 401, 403, 404 como problem+json', () => {
    const doc = buildOpenApiDocument(app);
    const path = doc.paths['/api/v1/encounters/{id}/triage-decision'];
    expect(Object.keys(path.post?.responses ?? {}).sort()).toEqual(
      ['201', '400', '401', '403', '404', '409', '422', 'default'].sort(),
    );
    expect(Object.keys(path.get?.responses ?? {}).sort()).toEqual(
      ['200', '401', '403', '404', 'default'].sort(),
    );
    for (const [code, res] of Object.entries({
      ...path.post?.responses,
    })) {
      if (code === '201') continue;
      expect([code, res]).toMatchObject([
        code,
        {
          content: {
            'application/problem+json': expect.any(Object) as object,
          },
        },
      ]);
    }
  });

  // ---------------------------------------------------------------- F-06-api (0.7.0)

  type Schema = {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const schemaOf = (
    doc: ReturnType<typeof buildOpenApiDocument>,
    name: string,
  ) => doc.components?.schemas?.[name] as Schema;
  const isProblem = {
    content: { 'application/problem+json': expect.any(Object) as object },
  };

  it('R1: info.version es 0.7.0 y GET /queue declara bearer, QueueDto, siteId opcional y los tiempos máximos de la Res. 5596', () => {
    const doc = buildOpenApiDocument(app);
    expect(doc.info.version).toBe('0.7.0');
    const op = doc.paths['/api/v1/queue'].get;
    expect(op?.security).toEqual([{ bearer: [] }]);
    expect(op?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/QueueDto' },
        },
      },
    });
    expect(op?.parameters).toEqual([
      expect.objectContaining({
        name: 'siteId',
        in: 'query',
        required: false,
        schema: expect.objectContaining({ format: 'uuid' }) as object,
      }),
    ]);
    expect(op?.description).toMatch(/Res\. 5596 de 2015/);
    expect(op?.description).toMatch(/I = 0 min/);
    expect(op?.description).toMatch(/II = 30 min/);
    expect(schemaOf(doc, 'QueueDto').properties).toMatchObject({
      serverNow: { type: 'string', format: 'date-time' },
      waitingTriage: {
        type: 'array',
        items: { $ref: '#/components/schemas/QueueItemDto' },
      },
      triaged: {
        type: 'array',
        items: { $ref: '#/components/schemas/QueueItemDto' },
      },
      inCare: {
        type: 'array',
        items: { $ref: '#/components/schemas/QueueItemDto' },
      },
    });
  });

  it('R2: QueueItemDto y QueuePatientDto documentan exactamente los campos de R2, sin datos personales (R7)', () => {
    const doc = buildOpenApiDocument(app);
    const item = schemaOf(doc, 'QueueItemDto');
    expect(Object.keys(item.properties ?? {}).sort()).toEqual(
      [
        'encounterId',
        'siteId',
        'siteName',
        'status',
        'finalLevel',
        'arrivalAt',
        'waitMinutes',
        'maxWaitMinutes',
        'overdue',
        'patient',
      ].sort(),
    );
    expect(item.properties).toMatchObject({
      finalLevel: { type: 'integer', minimum: 1, maximum: 5, nullable: true },
      waitMinutes: { type: 'integer', nullable: true },
      maxWaitMinutes: { type: 'integer', nullable: true },
      overdue: { type: 'boolean' },
      patient: { $ref: '#/components/schemas/QueuePatientDto' },
    });
    const patient = schemaOf(doc, 'QueuePatientDto');
    expect(Object.keys(patient.properties ?? {}).sort()).toEqual([
      'ageYears',
      'initials',
      'sex',
    ]);
    expect(patient.properties).toMatchObject({
      initials: { type: 'string', nullable: true },
      ageYears: { type: 'integer', nullable: true },
      sex: { enum: ['M', 'F', 'X'], nullable: true },
    });
    expect(JSON.stringify([item, patient])).not.toMatch(
      /fullName|document|birthDate|patientId|chiefComplaint/,
    );
  });

  it('R10: POST start-care (R9) y close declaran bearer, sin cuerpo (o {}) y 200 EncounterDto', () => {
    const doc = buildOpenApiDocument(app);
    for (const action of ['start-care', 'close']) {
      const op = doc.paths[`/api/v1/encounters/{id}/${action}`].post;
      expect([action, op?.security]).toEqual([action, [{ bearer: [] }]]);
      expect(op?.responses['200']).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/EncounterDto' },
          },
        },
      });
      expect(op?.requestBody).toMatchObject({
        required: false,
        content: {
          'application/json': {
            schema: { type: 'object', additionalProperties: false },
          },
        },
      });
    }
  });

  it('R15: GET /queue documenta 400, 401 y 403, y start-care y close 400, 401, 403, 404 y 409, todos como problem+json', () => {
    const doc = buildOpenApiDocument(app);
    const cases: [string, 'get' | 'post', string, string[]][] = [
      ['/api/v1/queue', 'get', '200', ['400', '401', '403']],
      [
        '/api/v1/encounters/{id}/start-care',
        'post',
        '200',
        ['400', '401', '403', '404', '409'],
      ],
      [
        '/api/v1/encounters/{id}/close',
        'post',
        '200',
        ['400', '401', '403', '404', '409'],
      ],
    ];
    for (const [path, method, ok, errors] of cases) {
      const responses = doc.paths[path][method]?.responses ?? {};
      expect([path, Object.keys(responses).sort()]).toEqual([
        path,
        [ok, ...errors, 'default'].sort(),
      ]);
      for (const code of [...errors, 'default']) {
        expect([path, code, responses[code]]).toMatchObject([
          path,
          code,
          isProblem,
        ]);
      }
    }
  });
});
