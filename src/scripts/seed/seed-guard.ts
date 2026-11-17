// Guardián del seed (F-09-api): solo escribe en una base local salvo que el humano lo autorice con ALLOW_REMOTE_SEED=1.
// Ningún agente ejecuta el seed contra Supabase (progress/current/F-09-api.md). Nunca imprime la URL (lleva credenciales).

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
/** URLs que comprueba: la que usa el seed (DATABASE_URL, PrismaService) y la del CLI de Prisma (DIRECT_URL). */
export const SEED_URL_VARS = ['DATABASE_URL', 'DIRECT_URL'] as const;

export class SeedGuardError extends Error {}

/**
 * Lanza SeedGuardError si DATABASE_URL falta, alguna URL no es válida o alguna no apunta a localhost/127.0.0.1, salvo
 * ALLOW_REMOTE_SEED=1 (exactamente "1"). DIRECT_URL es opcional: si está definida también tiene que ser local.
 */
export function assertSeedTarget(env: NodeJS.ProcessEnv): void {
  if (!env.DATABASE_URL) {
    throw new SeedGuardError('DATABASE_URL no está definida.');
  }
  if (env.ALLOW_REMOTE_SEED === '1') return;
  for (const name of SEED_URL_VARS) {
    const raw = env[name];
    if (raw === undefined || raw === '') continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new SeedGuardError(`${name} no es una URL válida.`);
    }
    // pg-connection-string prioriza ?host= (y libpq ?hostaddr=) sobre el host de la URL: también deben ser locales.
    const hosts = [
      url.hostname,
      ...url.searchParams.getAll('host'),
      ...url.searchParams.getAll('hostaddr'),
    ];
    if (hosts.some((h) => !LOCAL_HOSTS.has(h))) {
      throw new SeedGuardError(
        `${name} no apunta a localhost/127.0.0.1. Abortado: el seed solo se aplica en local salvo ALLOW_REMOTE_SEED=1 (paso manual del humano, docs/verification.md).`,
      );
    }
  }
}
