import { Injectable } from '@nestjs/common';
import type { StaffRole } from '../../common/auth/principal.js';
import {
  PrismaService,
  type PrismaTx,
} from '../../common/prisma/prisma.service.js';
import { TenancyService } from '../tenancy/tenancy.service.js';

export interface StaffUser {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: StaffRole;
  active: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
}

export interface StaffUserWithHash extends StaffUser {
  passwordHash: string;
}

const PUBLIC_FIELDS = {
  id: true,
  tenantId: true,
  email: true,
  fullName: true,
  role: true,
  active: true,
  failedAttempts: true,
  lockedUntil: true,
} as const;

/** Normalización única del email del personal (D7): sin espacios y en minúsculas. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Dueño de users. */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
  ) {}

  /** Para el login: incluye el hash y si la IPS del usuario está activa. */
  async findForLogin(
    email: string,
  ): Promise<{ user: StaffUserWithHash; tenantActive: boolean } | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { ...PUBLIC_FIELDS, passwordHash: true },
    });
    if (!user) return null;
    return { user, tenantActive: await this.tenancy.isActive(user.tenantId) };
  }

  async findById(id: string): Promise<StaffUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: PUBLIC_FIELDS,
    });
  }

  /** Nombres del personal del tenant, para el responsable en la línea de tiempo (F-02, R42). */
  async findNames(
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { tenantId, id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }

  async existsByEmail(email: string): Promise<boolean> {
    const n = await this.prisma.user.count({
      where: { email: normalizeEmail(email) },
    });
    return n > 0;
  }

  async create(
    data: {
      tenantId: string;
      email: string;
      passwordHash: string;
      fullName: string;
      role: StaffRole;
    },
    tx?: PrismaTx,
  ): Promise<{ id: string }> {
    return (tx ?? this.prisma).user.create({
      data: { ...data, email: normalizeEmail(data.email) },
      select: { id: true },
    });
  }

  /** Incremento atómico del contador (D8). Devuelve el valor tras el incremento. */
  async incrementFailedAttempts(id: string, tx: PrismaTx): Promise<number> {
    const { failedAttempts } = await tx.user.update({
      where: { id },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });
    return failedAttempts;
  }

  async lock(id: string, lockedUntil: Date, tx: PrismaTx): Promise<void> {
    await tx.user.update({
      where: { id },
      data: { lockedUntil, failedAttempts: 0 },
    });
  }

  async resetFailedAttempts(id: string, tx: PrismaTx): Promise<void> {
    await tx.user.update({
      where: { id },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  }
}
