import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { STAFF_ROLES, type StaffRole } from '../src/common/auth/principal.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { createApp, problem } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';

const TENANT = '22222222-2222-4222-8222-222222222222';
const SITE = '55555555-5555-4555-8555-555555555555';
const OK_QUERY = 'from=2026-11-01&to=2026-11-10';
const PATHS = ['/reports/summary', '/reports/encounters.csv'];

/** F-07-api · T8: autorización y parámetros sin base (el guard, el ValidationPipe y parsePeriod van antes de leer). */
describe('F-07: autorización y parámetros de los reportes (e2e, sin base)', () => {
  let app: INestApplication<App>;
  const staff = new Map<StaffRole, string>();
  let patient: string;
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: GROQ_CLIENT, useValue: fake },
        { provide: OPENROUTER_CLIENT, useValue: fake },
      ],
    });
    const tokens = app.get(TokenService);
    for (const role of STAFF_ROLES) {
      staff.set(
        role,
        (
          await tokens.issueStaff({
            id: '11111111-1111-4111-8111-111111111111',
            tenantId: TENANT,
            role,
          })
        ).accessToken,
      );
    }
    patient = (
      await tokens.issuePatient({
        id: '33333333-3333-4333-8333-333333333333',
        tenantId: TENANT,
        patientId: '44444444-4444-4444-8444-444444444444',
      })
    ).accessToken;
  });
  afterAll(() => app.close());

  const get = (path: string, token?: string) => {
    const req = request(app.getHttpServer()).get(`/api/v1${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('R18: RECEPTION, NURSE y PHYSICIAN → 403; paciente → 403; sin token o con token inválido → 401 (problem+json)', async () => {
    expect(STAFF_ROLES.filter((r) => r !== 'ADMIN').sort()).toEqual(
      ['NURSE', 'PHYSICIAN', 'RECEPTION'].sort(),
    );
    for (const path of PATHS) {
      for (const role of ['RECEPTION', 'NURSE', 'PHYSICIAN'] as StaffRole[]) {
        const res = await get(`${path}?${OK_QUERY}`, staff.get(role));
        expect([path, role, res.status]).toEqual([path, role, 403]);
        expect(problem(res).status).toBe(403);
      }
      const p = await get(`${path}?${OK_QUERY}`, patient);
      expect([path, 'PATIENT', p.status]).toEqual([path, 'PATIENT', 403]);
      expect(problem(p).status).toBe(403);
      for (const token of [undefined, 'no-es-un-jwt']) {
        const res = await get(`${path}?${OK_QUERY}`, token);
        expect([path, res.status]).toEqual([path, 401]);
        expect(problem(res).status).toBe(401);
      }
    }
  });

  it('R1: from o to ausentes, mal formados o imposibles, siteId no UUID o un parámetro desconocido → 400 problem+json con el campo, sin repetir el valor', async () => {
    const cases: [string, string[]][] = [
      ['to=2026-11-10', ['from']],
      ['from=2026-11-01', ['to']],
      ['', ['from', 'to']],
      ['from=2026-11-1&to=2026-11-10', ['from']],
      ['from=01/11/2026&to=2026-11-10', ['from']],
      ['from=2026-11-01&to=2026-02-30', ['to']],
      ['from=2026-11-01&to=2026-11-10T05:00:00Z', ['to']],
      ['from=2026-11-01&from=2026-11-02&to=2026-11-10', ['from']],
      [`${OK_QUERY}&siteId=zz-no-uuid`, ['siteId']],
      [`${OK_QUERY}&siteId=`, ['siteId']],
      [`${OK_QUERY}&status=CLOSED`, ['status']],
      [`${OK_QUERY}&tenantId=${TENANT}`, ['tenantId']],
    ];
    for (const path of PATHS) {
      for (const [query, fields] of cases) {
        const res = await get(`${path}?${query}`, staff.get('ADMIN'));
        expect([path, query, res.status]).toEqual([path, query, 400]);
        const p = problem(res);
        expect([
          path,
          query,
          [...new Set(p.errors?.map((e) => e.field))].sort(),
        ]).toEqual([path, query, [...fields].sort()]);
        const text = JSON.stringify(p);
        for (const value of [
          'zz-no-uuid',
          '2026-02-30',
          '01/11/2026',
          'CLOSED',
        ]) {
          expect(text).not.toContain(value);
        }
      }
    }
  });

  it('R2: from posterior a to → 422 (campo from) y un periodo de 367 días → 422 (campo to), antes de leer la base', async () => {
    for (const path of PATHS) {
      const after = await get(
        `${path}?from=2026-11-11&to=2026-11-10`,
        staff.get('ADMIN'),
      );
      expect([path, after.status]).toEqual([path, 422]);
      const pa = problem(after);
      expect(pa.errors?.map((e) => e.field)).toEqual(['from']);
      expect(JSON.stringify(pa)).not.toContain('2026-11-11');

      const long = await get(
        `${path}?from=2025-01-01&to=2026-01-02&siteId=${SITE}`,
        staff.get('ADMIN'),
      );
      expect([path, long.status]).toEqual([path, 422]);
      expect(problem(long).errors?.map((e) => e.field)).toEqual(['to']);
    }
  });
});
