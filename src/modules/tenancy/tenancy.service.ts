import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PrismaService,
  type PrismaTx,
} from '../../common/prisma/prisma.service.js';
import { isUuid } from '../../common/uuid.js';

export interface TenantRef {
  id: string;
  name: string;
}

export interface PublicTenant {
  id: string;
  name: string;
  sites: { id: string; name: string }[];
}

/** Mismo error para "no existe" y "es de otro tenant" (R16, D5). */
const NOT_FOUND = 'El recurso no existe.';

/** Dueño de tenants y sites. Todo método que lee datos de una IPS recibe tenantId primero (D5). */
@Injectable()
export class TenancyService {
  constructor(private readonly prisma: PrismaService) {}

  async findSite(
    tenantId: string,
    id: string,
  ): Promise<{ id: string; tenantId: string; name: string }> {
    const site = isUuid(id)
      ? await this.prisma.site.findFirst({
          where: { id, tenantId },
          select: { id: true, tenantId: true, name: true },
        })
      : null;
    if (!site) throw new NotFoundException(NOT_FOUND);
    return site;
  }

  /** true solo si la IPS existe y está activa. */
  async isActive(tenantId: string, tx?: PrismaTx): Promise<boolean> {
    if (!isUuid(tenantId)) return false;
    const tenant = await (tx ?? this.prisma).tenant.findUnique({
      where: { id: tenantId },
      select: { active: true },
    });
    return tenant?.active === true;
  }

  async findByName(name: string): Promise<TenantRef | null> {
    return this.prisma.tenant.findUnique({
      where: { name },
      select: { id: true, name: true },
    });
  }

  /** Crea la IPS por nombre si no existe (tenants.name es único). Usado por los scripts CLI. */
  async findOrCreateByName(
    name: string,
    tx?: PrismaTx,
  ): Promise<TenantRef & { created: boolean }> {
    const db = tx ?? this.prisma;
    const existing = await db.tenant.findUnique({
      where: { name },
      select: { id: true, name: true },
    });
    if (existing) return { ...existing, created: false };
    const created = await db.tenant.create({
      data: { name },
      select: { id: true, name: true },
    });
    return { ...created, created: true };
  }

  async findSiteByName(
    tenantId: string,
    name: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.site.findUnique({
      where: { tenantId_name: { tenantId, name } },
      select: { id: true },
    });
  }

  async createSite(
    tenantId: string,
    name: string,
    tx?: PrismaTx,
  ): Promise<{ id: string }> {
    return (tx ?? this.prisma).site.create({
      data: { tenantId, name },
      select: { id: true },
    });
  }

  /** IPS activas ordenadas por nombre, cada una con sus sedes ordenadas por nombre; solo id y nombre (R37). */
  async listActiveWithSites(): Promise<PublicTenant[]> {
    return this.prisma.tenant.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        sites: { orderBy: { name: 'asc' }, select: { id: true, name: true } },
      },
    });
  }
}
