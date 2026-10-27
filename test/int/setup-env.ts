// Nest 12 es ESM y @nestjs/throttler es CJS: se precargan @nestjs/common y @nestjs/core para que Jest no
// detecte un ciclo require(esm) al cargar el throttler (en Node, fuera de Jest, no hace falta).
import '@nestjs/common';
import '@nestjs/core';
// Entorno de las pruebas de integración (npm run test:int). DATABASE_URL y DIRECT_URL las fija scripts/test-int.sh.
// Segunda barrera tras scripts/assert-local-db.mjs: si la URL no es local, ninguna prueba llega a conectarse.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
  const raw = process.env[name];
  if (!raw || !LOCAL_HOSTS.has(new URL(raw).hostname)) {
    throw new Error(
      `${name} debe apuntar al PostgreSQL local de Docker (ejecuta npm run test:int).`,
    );
  }
}
process.env.JWT_SECRET = 'int-test-secret-0123456789abcdef0123456789abcdef';
process.env.PATIENT_CONSENT_VERSION = '2026-10-v1';
process.env.PATIENT_CONSENT_TEXT_PATH = 'docs/legal/consentimiento.md';
// Límite alto para que el resto de pruebas no choque con R39 (que se prueba con los valores por defecto).
process.env.THROTTLE_LIMIT = '100000';
process.env.THROTTLE_TTL_MS = '60000';
