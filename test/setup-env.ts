// Nest 12 es ESM y @nestjs/throttler es CJS: se precargan @nestjs/common y @nestjs/core para que Jest no
// detecte un ciclo require(esm) al cargar el throttler (en Node, fuera de Jest, no hace falta).
import '@nestjs/common';
import '@nestjs/core';
// Entorno de las pruebas e2e sin base (npm test). Sin DATABASE_URL: Prisma no conecta (conexión perezosa, D16).
process.env.JWT_SECRET = 'e2e-test-secret-0123456789abcdef0123456789abcdef';
process.env.PATIENT_CONSENT_VERSION = '2026-10-v1';
process.env.PATIENT_CONSENT_TEXT_PATH = 'docs/legal/consentimiento.md';
// Sin THROTTLE_*: R39 se prueba con los valores por defecto (10 peticiones / 60 s).
delete process.env.THROTTLE_LIMIT;
delete process.env.THROTTLE_TTL_MS;
delete process.env.DATABASE_URL;
