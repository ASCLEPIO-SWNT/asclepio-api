import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../../generated/prisma/client.js';

/** Cliente transaccional que reciben los services dentro de prisma.$transaction. */
export type PrismaTx = Prisma.TransactionClient;

/**
 * Prisma 7 + @prisma/adapter-pg sobre DATABASE_URL (rol asclepio_app, ADR 0003).
 * Conexión perezosa (D16): no hay $connect() al arrancar, así npm test y openapi:export funcionan sin base.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
