import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import {
  GROQ_CLIENT,
  OPENROUTER_CLIENT,
} from '../src/modules/ai/llm/llm-client.js';
import { createApp, problem } from './e2e-app.js';
import { FakeLlmClient } from './int/fake-llm.js';
import { F02Fixtures } from './int/f02-fixtures.js';
import { F03Fixtures } from './int/f03-fixtures.js';
import { CapturingLogger, randomDoc } from './int/fixtures.js';

/** Valores fáciles de buscar como texto en logs y metadata. */
const VITALS = {
  respiratoryRate: 27,
  oxygenSaturation: 91,
  supplementalOxygen: true,
  systolicBp: 173,
  heartRate: 137,
  consciousness: 'V',
  temperatureC: 38.7,
  diastolicBp: 109,
  glucoseMgDl: 247,
};
const RAW = 'zz-respuesta-cruda-privada {"level": 9}';

describe('F-04: privacidad de logs y auditoría, y 403 sin filas (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let f3: F03Fixtures;
  const logger = new CapturingLogger();
  const groq = new FakeLlmClient('GROQ', 'openai/gpt-oss-120b', {
    content: RAW,
  });
  const openRouter = new FakeLlmClient('OPENROUTER', 'openai/gpt-oss-120b', {
    fail: 'NETWORK',
  });

  beforeAll(async () => {
    app = await createApp({
      logger,
      overrides: [
        { provide: GROQ_CLIENT, useValue: groq },
        { provide: OPENROUTER_CLIENT, useValue: openRouter },
      ],
    });
    fx = new F02Fixtures(app);
    f3 = new F03Fixtures(fx);
  });
  afterAll(() => app.close());

  it('R27: los logs y audit_log.metadata del flujo completo no contienen la instantánea, el motivo, los hallazgos, los signos, la respuesta cruda ni datos del paciente', async () => {
    const t = await fx.tenant('f04-privacy');
    const rec = await fx.staff(t.id);
    const nurse = await fx.staff(t.id, 'NURSE');
    const physician = await fx.staff(t.id, 'PHYSICIAN');
    const documentNumber = randomDoc();
    const patient = await fx.patient(t.id, {
      fullName: 'Eustaquio Bermúdez Saldarriaga',
      documentNumber,
    });
    const complaint = 'zz-motivo-privado dolor abdominal';
    const created = await fx
      .http('post', '/encounters', rec.token)
      .send({
        patientId: patient.id,
        siteId: t.siteId,
        chiefComplaintText: complaint,
        complaintSource: 'TYPED',
      })
      .expect(201);
    const id = (created.body as { id: string }).id;
    const finding = 'zz-hallazgo-privado abdomen en tabla';
    await fx
      .http('post', `/encounters/${id}/vital-signs`, nurse.token)
      .send(VITALS)
      .expect(201);
    await fx
      .http('post', `/encounters/${id}/symptom-findings`, nurse.token)
      .send({ items: [{ kind: 'FINDING', description: finding }] })
      .expect(201);
    logger.lines.length = 0;

    // INVALID_OUTPUT (guarda la respuesta cruda) y después FAILED.
    await fx
      .http('post', `/encounters/${id}/triage-suggestions`, nurse.token)
      .expect(201);
    groq.script({ fail: 'HTTP', http: 500 });
    await fx
      .http('post', `/encounters/${id}/triage-suggestions`, nurse.token)
      .expect(201);
    await fx
      .http('get', `/encounters/${id}/triage-suggestions`, physician.token)
      .expect(200);

    const noIds = (x: string) =>
      x.replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '<id>',
      );
    // La latencia real (ms) podría coincidir por azar con un signo: se sustituye antes de buscar.
    const logs = noIds(logger.text()).replace(
      /"latencyMs":\d+/g,
      '"latencyMs":<n>',
    );
    expect(logs).toContain('triage_suggestion_created');
    expect(logs).toContain('triage_suggestions_read');
    const audits = await fx.prisma.auditLog.findMany({
      where: { tenantId: t.id, action: 'TRIAGE_SUGGESTION_CREATED' },
    });
    expect(audits).toHaveLength(2);
    for (const a of audits) {
      expect(Object.keys(a.metadata as object).sort()).toEqual([
        'encounterId',
        'guardApplied',
        'status',
      ]);
    }
    const stored = noIds(JSON.stringify(audits.map((a) => a.metadata)));
    const sensitive = [
      ...Object.values(VITALS)
        .filter((v) => typeof v === 'number')
        .map(String),
      complaint,
      finding,
      'zz-',
      RAW,
      'Eustaquio',
      'Bermúdez',
      'Saldarriaga',
      documentNumber,
      'input_snapshot',
      'inputSnapshot',
      'chief_complaint_text',
      'gsk-test-ficticia',
      'sk-or-test-ficticia',
    ];
    for (const s of sensitive) {
      expect(['logs', s, logs.includes(s)]).toEqual(['logs', s, false]);
      expect(['audit', s, stored.includes(s)]).toEqual(['audit', s, false]);
    }
  });

  it('R28: un 403 por rol (RECEPTION, ADMIN, PHYSICIAN en el POST, paciente) no llama al LLM ni inserta sugerencias ni auditoría', async () => {
    const t = await fx.tenant('f04-403');
    const rec = await fx.staff(t.id);
    const nurse = await fx.staff(t.id, 'NURSE');
    const admin = await fx.staff(t.id, 'ADMIN');
    const physician = await fx.staff(t.id, 'PHYSICIAN');
    const p = await fx.patientUser(t.id);
    const id = await f3.encounter(t, rec);
    await fx
      .http('post', `/encounters/${id}/vital-signs`, nurse.token)
      .send(VITALS)
      .expect(201);
    groq.script();
    openRouter.script();
    for (const token of [rec.token, admin.token, physician.token, p.token]) {
      const res = await fx.http(
        'post',
        `/encounters/${id}/triage-suggestions`,
        token,
      );
      expect(res.status).toBe(403);
      expect(problem(res).status).toBe(403);
    }
    for (const token of [rec.token, admin.token, p.token]) {
      await fx
        .http('get', `/encounters/${id}/triage-suggestions`, token)
        .expect(403);
    }
    expect(groq.requests.length + openRouter.requests.length).toBe(0);
    expect(
      await fx.prisma.triageSuggestion.count({ where: { encounterId: id } }),
    ).toBe(0);
    expect(
      await fx.prisma.auditLog.count({
        where: { tenantId: t.id, action: 'TRIAGE_SUGGESTION_CREATED' },
      }),
    ).toBe(0);
  });
});
