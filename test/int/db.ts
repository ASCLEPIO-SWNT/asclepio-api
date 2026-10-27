import { randomUUID } from 'node:crypto';
import pg from 'pg';

/** Cliente pg conectado como asclepio_app (DATABASE_URL) para comprobar restricciones y permisos. */
export async function appClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

/** Sufijo único por ejecución: los tenants de prueba no se borran (audit_log los referencia y es append-only). */
export function testName(label: string): string {
  return `DEV-test-${label}-${randomUUID().slice(0, 8)}`;
}

export async function pgErrorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? 'unknown';
  }
  return 'no-error';
}
