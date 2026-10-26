// Configuración del CLI de Prisma 7 (ADR 0003).
// El CLI (migrate deploy, validate) usa DIRECT_URL (conexión directa o de sesión, 5432): las migraciones no
// funcionan a través de pgbouncer en modo transacción. La app en runtime usa DATABASE_URL (pooler 6543) vía @prisma/adapter-pg.
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DIRECT_URL },
});
