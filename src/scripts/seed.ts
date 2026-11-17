// npm run db:seed (o npx prisma db seed, que ejecuta lo mismo desde prisma.config.ts) → datos sintéticos DEV-<nombre>-
// (F-09-api). Idempotente. Guardián: solo localhost/127.0.0.1 salvo ALLOW_REMOTE_SEED=1 (paso manual del humano).
// SEED_NAME (opcional, por defecto "demo") fija el prefijo DEV-<nombre>-. Necesita el mismo .env que la API
// (DATABASE_URL, JWT_SECRET, PATIENT_CONSENT_*, GROQ_*/OPENROUTER_*), aunque nunca llama al LLM.
import { existsSync } from 'node:fs';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FixedClock } from '../common/clock/clock.js';
import { out } from './cli.js';
import { SeedNameError, seedIdentity, seedName } from './seed/seed-data.js';
import { assertSeedTarget, SeedGuardError } from './seed/seed-guard.js';
import { SeedLlm } from './seed/seed-llm.js';
import { SeedModule } from './seed/seed.module.js';
import { runSeed, SeedError } from './seed/seed-runner.js';

async function main(): Promise<void> {
  // Mismo patrón que los scripts CLI: process.loadEnvFile no sobrescribe variables ya definidas.
  if (existsSync('.env')) process.loadEnvFile('.env');
  assertSeedTarget(process.env);
  const id = seedIdentity(seedName(process.env.SEED_NAME));
  const now = new Date();
  const clock = new FixedClock(now);
  const llm = new SeedLlm();
  let app: INestApplicationContext | undefined;
  try {
    app = await NestFactory.createApplicationContext(
      SeedModule.register(clock, llm),
      { logger: false, abortOnError: false },
    );
    const r = await runSeed(app, clock, llm, id, now);
    // Solo ids y conteos: nada de nombres, documentos ni contraseñas en la salida.
    const created = Object.entries(r.created)
      .map(([k, n]) => `${k}=${n}`)
      .join(' ');
    const total = Object.values(r.created).reduce((a, b) => a + b, 0);
    out(
      `Seed ${id.prefix}: IPS ${r.tenantId}, sede ${r.siteId}. ${total === 0 ? 'Ya estaba completo: no se ha creado nada.' : `Creado: ${created}.`}`,
    );
  } finally {
    await app?.close();
  }
}

main().then(
  () => {
    process.exitCode = 0;
  },
  (e: unknown) => {
    // Mensajes propios (sin datos personales) o solo el tipo de error, como los scripts CLI (R35 de F-01).
    if (
      e instanceof SeedGuardError ||
      e instanceof SeedError ||
      e instanceof SeedNameError
    ) {
      process.stderr.write(`Seed abortado: ${e.message}\n`);
    } else {
      const code = (e as { code?: unknown }).code;
      const status = (e as { status?: unknown }).status;
      process.stderr.write(
        `Seed falló (${e instanceof Error ? e.name : 'unknown'}${typeof code === 'string' ? ` ${code}` : ''}${typeof status === 'number' ? ` ${status}` : ''}).\n`,
      );
    }
    process.exitCode = 1;
  },
);
