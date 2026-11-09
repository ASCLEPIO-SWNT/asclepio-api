import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { StaffRole } from '../../src/common/auth/principal.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { testName } from './db.js';
import { randomDoc } from './fixtures.js';

const TRIAGE_REQUIRED = new Set(['TRIAGED', 'IN_CARE', 'CLOSED']);

/**
 * Columnas de triage que exige el CHECK de F-05 (R11) cuando una prueba fuerza en la base TRIAGED, IN_CARE o CLOSED
 * sin pasar por la decisión de triage. En los demás estados no añade nada.
 */
export function forcedTriage(
  status: string,
  triagedBy: string,
): { finalLevel?: number; triagedAt?: Date; triagedBy?: string } {
  return TRIAGE_REQUIRED.has(status)
    ? { finalLevel: 3, triagedAt: new Date(), triagedBy }
    : {};
}

export interface Staff {
  id: string;
  fullName: string;
  token: string;
}
export interface PatientUser {
  accountId: string;
  patientId: string;
  documentNumber: string;
  token: string;
}

/**
 * Datos de prueba de F-02 (DEV-test-…). No se limpian: encounters, pre_registrations y encounter_events no admiten
 * DELETE para asclepio_app y referencian pacientes, sedes y usuarios con RESTRICT (design.md, "Datos de prueba").
 */
export class F02Fixtures {
  readonly prisma: PrismaService;
  private readonly tokens: TokenService;

  constructor(private readonly app: INestApplication<App>) {
    this.prisma = app.get(PrismaService);
    this.tokens = app.get(TokenService);
  }

  async tenant(
    label: string,
  ): Promise<{ id: string; siteId: string; siteName: string }> {
    const t = await this.prisma.tenant.create({
      data: { name: testName(label) },
      select: { id: true },
    });
    const site = await this.site(t.id, 'DEV-test Sede Norte');
    return { id: t.id, siteId: site.id, siteName: site.name };
  }

  site(tenantId: string, name: string) {
    return this.prisma.site.create({
      data: { tenantId, name },
      select: { id: true, name: true },
    });
  }

  async staff(tenantId: string, role: StaffRole = 'RECEPTION'): Promise<Staff> {
    const fullName = `DEV-test ${role} ${Math.random().toString(36).slice(2, 7)}`;
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: `dev-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: 'x',
        fullName,
        role,
      },
      select: { id: true },
    });
    const { accessToken } = await this.tokens.issueStaff({
      id: user.id,
      tenantId,
      role,
    });
    return { id: user.id, fullName, token: accessToken };
  }

  async patientUser(
    tenantId: string,
    opts: {
      identityVerified?: boolean;
      fullName?: string;
      verifiedAt?: Date;
    } = {},
  ): Promise<PatientUser> {
    const documentNumber = randomDoc();
    const patient = await this.prisma.patient.create({
      data: {
        tenantId,
        documentType: 'CC',
        documentNumber,
        fullName: opts.fullName ?? 'DEV-test Paciente App',
        birthDate: new Date('1985-03-04T00:00:00Z'),
        sex: 'F',
        identityVerifiedAt: opts.verifiedAt ?? null,
      },
      select: { id: true },
    });
    const account = await this.prisma.patientAccount.create({
      data: {
        tenantId,
        patientId: patient.id,
        passwordHash: 'x',
        consentAt: new Date(),
        consentVersion: '2026-10-v1',
        identityVerified: opts.identityVerified ?? false,
      },
      select: { id: true },
    });
    const { accessToken } = await this.tokens.issuePatient({
      id: account.id,
      tenantId,
      patientId: patient.id,
    });
    return {
      accountId: account.id,
      patientId: patient.id,
      documentNumber,
      token: accessToken,
    };
  }

  /** Paciente creado por recepción (sin cuenta). */
  patient(tenantId: string, data: Record<string, unknown> = {}) {
    return this.prisma.patient.create({
      data: {
        tenantId,
        documentType: 'CC',
        documentNumber: randomDoc(),
        fullName: 'DEV-test Paciente Recepción',
        birthDate: new Date('1970-01-01T00:00:00Z'),
        sex: 'M',
        ...data,
      },
      select: { id: true },
    });
  }

  audits(where: { entityId?: string; tenantId?: string; action?: string }) {
    return this.prisma.auditLog.findMany({ where, orderBy: { id: 'asc' } });
  }

  http(method: 'get' | 'post' | 'patch', path: string, token?: string) {
    const req = request(this.app.getHttpServer())[method](`/api/v1${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  /** Pre-registro enviado por la app con el token del paciente. */
  async preRegister(
    p: PatientUser,
    siteId: string,
    over: Record<string, unknown> = {},
  ): Promise<{ id: string; status: string }> {
    const res = await this.http('post', '/patient/pre-registrations', p.token)
      .send({
        siteId,
        chiefComplaintText: 'DEV-test dolor torácico desde la mañana',
        complaintSource: 'TYPED',
        ...over,
      })
      .expect(201);
    return res.body as { id: string; status: string };
  }
}

export const COMPLAINT = 'DEV-test dolor torácico desde la mañana';
