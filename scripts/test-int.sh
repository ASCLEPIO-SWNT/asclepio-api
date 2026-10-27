#!/usr/bin/env bash
# npm run test:int — pruebas de integración contra el PostgreSQL LOCAL de Docker (D15 de F-01-api).
# 1) Guardián: las URLs deben apuntar a localhost/127.0.0.1 (nunca Supabase). Este script NO lee .env.
# 2) docker compose up --wait. 3) prisma migrate deploy contra la base local.
# 4) Da LOGIN y contraseña local a asclepio_app (solo en Docker; en Supabase lo hace el responsable de backend).
# 5) Compila (los scripts CLI se prueban como proceso hijo desde dist/) y ejecuta Jest con test/jest-int.json.
# El contenedor queda levantado para repetir; se detiene con: docker compose -f docker-compose.test.yml down
set -euo pipefail
cd "$(dirname "$0")/.."

TEST_DIRECT_URL="${TEST_DIRECT_URL:-postgresql://asclepio_test:asclepio_test_local@localhost:54329/asclepio_test}"
TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://asclepio_app:asclepio_app_local@localhost:54329/asclepio_test}"
APP_PASSWORD=$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.argv[1]).password))' "$TEST_DATABASE_URL")

node scripts/assert-local-db.mjs "$TEST_DIRECT_URL" "$TEST_DATABASE_URL"

docker compose -f docker-compose.test.yml up -d --wait

# prisma.config.ts carga .env con process.loadEnvFile, que NO sobrescribe variables ya definidas:
# DIRECT_URL y DATABASE_URL se fijan aquí explícitamente con las URLs locales ya verificadas.
DIRECT_URL="$TEST_DIRECT_URL" DATABASE_URL="$TEST_DATABASE_URL" npx --no-install prisma migrate deploy

docker compose -f docker-compose.test.yml exec -T db \
  psql -v ON_ERROR_STOP=1 -q -U asclepio_test -d asclepio_test \
  -c "ALTER ROLE asclepio_app LOGIN PASSWORD '${APP_PASSWORD}'"

npm run -s build

DATABASE_URL="$TEST_DATABASE_URL" DIRECT_URL="$TEST_DIRECT_URL" \
  node --experimental-vm-modules node_modules/jest/bin/jest.js --config test/jest-int.json --runInBand "$@"
