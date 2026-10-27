import type { INestApplication, LoggerService } from '@nestjs/common';
import type { StaffRole } from '../../src/common/auth/principal.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { PasswordHasher } from '../../src/modules/auth/password/password-hasher.js';
import { testName } from './db.js';

export const PASSWORD = 'DEV-clave-correcta-123';
export const WRONG = 'DEV-clave-incorrecta-9';

/** Crea datos de prueba DEV-test-… y los limpia al terminar (salvo tenants y audit_log: append-only, D15). */
export class Fixtures {
  readonly prisma: PrismaService;
  private readonly hasher = new PasswordHasher();
  private readonly tenants: string[] = [];
  private passwordHash?: string;

  constructor(app: INestApplication) {
    this.prisma = app.get(PrismaService);
  }

  async hash(): Promise<string> {
    this.passwordHash ??= await this.hasher.hash(PASSWORD);
    return this.passwordHash;
  }

  async tenant(
    label: string,
    active = true,
  ): Promise<{ id: string; name: string }> {
    const t = await this.prisma.tenant.create({
      data: { name: testName(label), active },
      select: { id: true, name: true },
    });
    this.tenants.push(t.id);
    return t;
  }

  track(tenantId: string): void {
    this.tenants.push(tenantId);
  }

  async user(
    tenantId: string,
    opts: { role?: StaffRole; active?: boolean; email?: string } = {},
  ) {
    const email =
      opts.email ??
      `dev-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    return this.prisma.user.create({
      data: {
        tenantId,
        email,
        passwordHash: await this.hash(),
        fullName: 'DEV-test Usuario Prueba',
        role: opts.role ?? 'NURSE',
        active: opts.active ?? true,
      },
    });
  }

  async patient(tenantId: string, documentNumber = randomDoc()) {
    return this.prisma.patient.create({
      data: {
        tenantId,
        documentType: 'CC',
        documentNumber,
        fullName: 'DEV-test Paciente Existente',
        birthDate: new Date('1970-01-01T00:00:00Z'),
        sex: 'F',
      },
    });
  }

  async patientAccount(
    tenantId: string,
    opts: { active?: boolean; documentNumber?: string } = {},
  ) {
    const patient = await this.patient(tenantId, opts.documentNumber);
    const account = await this.prisma.patientAccount.create({
      data: {
        tenantId,
        patientId: patient.id,
        passwordHash: await this.hash(),
        consentAt: new Date(),
        consentVersion: '2026-10-v1',
        active: opts.active ?? true,
      },
    });
    return { patient, account };
  }

  audits(where: { entityId?: string; tenantId?: string; action?: string }) {
    return this.prisma.auditLog.findMany({ where, orderBy: { id: 'asc' } });
  }

  async cleanup(): Promise<void> {
    const where = { tenantId: { in: this.tenants } };
    await this.prisma.patientAccount.deleteMany({ where });
    await this.prisma.patient.deleteMany({ where });
    await this.prisma.user.deleteMany({ where });
    await this.prisma.site.deleteMany({ where });
  }
}

export function randomDoc(): string {
  return String(Math.floor(1e9 + Math.random() * 9e9));
}

/** Logger que acumula todo lo que se registra, para comprobar que no hay datos personales (R35). */
export class CapturingLogger implements LoggerService {
  readonly lines: string[] = [];
  private push(level: string, args: unknown[]) {
    this.lines.push(`${level} ${JSON.stringify(args)}`);
  }
  log(...args: unknown[]) {
    this.push('log', args);
  }
  error(...args: unknown[]) {
    this.push('error', args);
  }
  warn(...args: unknown[]) {
    this.push('warn', args);
  }
  debug(...args: unknown[]) {
    this.push('debug', args);
  }
  verbose(...args: unknown[]) {
    this.push('verbose', args);
  }
  fatal(...args: unknown[]) {
    this.push('fatal', args);
  }
  text(): string {
    return this.lines.join('\n');
  }
}
