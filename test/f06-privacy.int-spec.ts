import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Clock, FixedClock } from '../src/common/clock/clock.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { createApp, problem } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { F02Fixtures, type Staff } from './int/f02-fixtures.js';
import { CapturingLogger } from './int/fixtures.js';

const NOW = new Date('2026-11-09T17:00:00.000Z');
const FULL_NAME = 'DEV-test Wenceslao Ortiz Vélez';
const COMPLAINT_R15 = 'DEV-test cefalea pulsátil R15 xyzzy';

describe('F-06: roles, errores y logs (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  const clock = new FixedClock(NOW);
  const logger = new CapturingLogger();
  const fake = new FakeLlmClient('GROQ', 'x', { fail: 'NETWORK' });
  let t: { id: string; siteId: string };
  const staff = new Map<string, Staff>();
  let patientToken: string;
  let documentNumber: string;
  let encounterId: string;

  beforeAll(async () => {
    app = await createApp({
      overrides: [
        { provide: Clock, useValue: clock },
        { provide: GROQ_CLIENT, useValue: fake },
        { provide: OPENROUTER_CLIENT, useValue: fake },
      ],
      logger,
    });
    fx = new F02Fixtures(app);
    t = await fx.tenant('f06-privacy');
    for (const role of ['RECEPTION', 'NURSE', 'PHYSICIAN', 'ADMIN'] as const) {
      staff.set(role, await fx.staff(t.id, role));
    }
    patientToken = (await fx.patientUser(t.id)).token;
    const p = await fx.patient(t.id, { fullName: FULL_NAME });
    documentNumber = (
      await fx.prisma.patient.findUniqueOrThrow({
        where: { id: p.id },
        select: { documentNumber: true },
      })
    ).documentNumber!;
    encounterId = (
      (
        await fx
          .http('post', '/encounters', staff.get('RECEPTION')!.token)
          .send({
            patientId: p.id,
            siteId: t.siteId,
            chiefComplaintText: COMPLAINT_R15,
            complaintSource: 'TYPED',
          })
          .expect(201)
      ).body as { id: string }
    ).id;
    await fx
      .http(
        'post',
        `/encounters/${encounterId}/triage-decision`,
        staff.get('NURSE')!.token,
      )
      .send({ action: 'MANUAL', level: 2 })
      .expect(201);
  });
  afterAll(() => app.close());

  it('R14: con datos reales, RECEPTION no lee la cola; NURSE, RECEPTION y ADMIN no hacen start-care ni close; el paciente, 403 en todo; sin token, 401; sin modificar nada', async () => {
    const before = await fx.prisma.encounter.findUniqueOrThrow({
      where: { id: encounterId },
      select: { status: true, updatedAt: true },
    });
    const denied: [string, 'get' | 'post', string][] = [
      ['RECEPTION', 'get', '/queue'],
      ...(['NURSE', 'RECEPTION', 'ADMIN'] as const).flatMap(
        (r) =>
          [
            [r, 'post', `/encounters/${encounterId}/start-care`],
            [r, 'post', `/encounters/${encounterId}/close`],
          ] as [string, 'post', string][],
      ),
    ];
    for (const [role, method, path] of denied) {
      const res = await fx.http(method, path, staff.get(role)!.token);
      expect([role, path, res.status]).toEqual([role, path, 403]);
      expect(problem(res).status).toBe(403);
    }
    for (const [method, path] of [
      ['get', '/queue'],
      ['post', `/encounters/${encounterId}/start-care`],
      ['post', `/encounters/${encounterId}/close`],
    ] as ['get' | 'post', string][]) {
      const p = await fx.http(method, path, patientToken);
      expect([path, p.status]).toEqual([path, 403]);
      expect(problem(p).status).toBe(403);
      const anon = await fx.http(method, path);
      expect([path, anon.status]).toEqual([path, 401]);
      expect(problem(anon).status).toBe(401);
    }
    expect(
      await fx.prisma.encounter.findUniqueOrThrow({
        where: { id: encounterId },
        select: { status: true, updatedAt: true },
      }),
    ).toEqual(before);
    for (const role of ['PHYSICIAN', 'NURSE', 'ADMIN']) {
      await fx.http('get', '/queue', staff.get(role)!.token).expect(200);
    }
  });

  it('R15: los errores de F-06 son problem+json y los logs del flujo de la cola no contienen datos del paciente', async () => {
    const doc = staff.get('PHYSICIAN')!.token;
    // 409, 404, 400 de cuerpo y de consulta.
    const errors = [
      await fx.http('post', `/encounters/${encounterId}/close`, doc),
      await fx.http(
        'post',
        '/encounters/0d6c1f6a-0000-4000-8000-000000000000/start-care',
        doc,
      ),
      await fx
        .http('post', `/encounters/${encounterId}/start-care`, doc)
        .send({ status: 'CLOSED' }),
      await fx.http('get', '/queue?siteId=zz', doc),
    ];
    expect(errors.map((r) => r.status)).toEqual([409, 404, 400, 400]);
    for (const r of errors) {
      const p = problem(r);
      expect(p).toMatchObject({ type: expect.any(String) as string });
      expect(p.title).toBeTruthy();
    }

    await fx.http('get', '/queue', doc).expect(200);
    await fx.http('get', `/queue?siteId=${t.siteId}`, doc).expect(200);
    await fx
      .http('post', `/encounters/${encounterId}/start-care`, doc)
      .expect(200);
    await fx.http('get', '/queue', doc).expect(200);
    await fx.http('post', `/encounters/${encounterId}/close`, doc).expect(200);

    const text = logger.text();
    expect(text).toContain('queue_read');
    for (const s of [
      'Wenceslao',
      'Ortiz',
      'Vélez',
      FULL_NAME,
      documentNumber,
      'xyzzy',
      COMPLAINT_R15,
    ]) {
      expect([s, text.includes(s)]).toEqual([s, false]);
    }
  });
});
