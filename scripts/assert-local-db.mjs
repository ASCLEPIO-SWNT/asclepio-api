// Guardián de npm run test:int: aborta si alguna URL de base no apunta a localhost/127.0.0.1.
// Evita aplicar migraciones o ejecutar pruebas contra Supabase por error (D15 de F-01-api, ADR 0003).
// Uso: node scripts/assert-local-db.mjs <url> [<url>...]. Nunca imprime la URL (puede llevar credenciales).
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const urls = process.argv.slice(2);
if (urls.length === 0) {
  process.stderr.write('assert-local-db: no se recibió ninguna URL.\n');
  process.exit(1);
}
for (const [i, raw] of urls.entries()) {
  let host;
  try {
    host = new URL(raw).hostname;
  } catch {
    process.stderr.write(`assert-local-db: la URL nº ${i + 1} no es válida. Abortado.\n`);
    process.exit(1);
  }
  if (!LOCAL_HOSTS.has(host)) {
    process.stderr.write(
      `assert-local-db: la URL nº ${i + 1} no apunta a localhost/127.0.0.1. Abortado: las pruebas de integración solo usan el PostgreSQL local de Docker.\n`,
    );
    process.exit(1);
  }
}
