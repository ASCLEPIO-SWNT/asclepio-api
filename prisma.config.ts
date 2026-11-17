// Configuración del CLI de Prisma 7 (ADR 0003).
// El CLI (migrate deploy, validate) usa DIRECT_URL (conexión directa o de sesión, 5432): las migraciones no
// funcionan a través de pgbouncer en modo transacción. La app en runtime usa DATABASE_URL (pooler 6543) vía @prisma/adapter-pg.
// F-09-api: `npx prisma db seed` ejecuta `npm run db:seed` (compila y lanza dist/scripts/seed.js, sin tsx). El seed usa
// DATABASE_URL y aborta si alguna URL no es localhost/127.0.0.1, salvo ALLOW_REMOTE_SEED=1 (paso manual del humano).
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'npm run -s db:seed' },
  datasource: { url: process.env.DIRECT_URL },
});
