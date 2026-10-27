# Arquitectura — asclepio-api

Monolito modular NestJS 12 + TypeScript estricto, en ESM (`"type": "module"`, imports relativos con `.js`), con Jest (ts-jest ESM) (ADR 0001). PostgreSQL en Supabase vía Prisma, en el esquema `asclepio` (ADR 0003).

## Estructura
```
src/
├── main.ts                 # bootstrap: prefijo /api/v1, Swagger, filtro problem+json, logger
├── app.module.ts
├── app.setup.ts            # prefijo, ValidationPipe, filtro problem+json, OpenAPI (compartido con pruebas y export)
├── openapi-export.ts       # npm run openapi:export
├── generated/prisma/       # cliente Prisma generado (no versionado)
├── common/                 # transversal: health, problem+json, auth (decoradores y tipos de principal),
│                           # clock (Clock/SystemClock/FixedClock), config (validación al arrancar), prisma, throttle
├── modules/
│   ├── auth/  users/  tenancy/
│   ├── patients/  encounters/  triage/  ai/
│   ├── queue/  reports/  audit/
└── scripts/                # CLI: users-create.ts (npm run users:create), sites-create.ts (npm run sites:create)
prisma/
├── schema.prisma           # provider postgresql, schemas = ["asclepio"] (Prisma 7: sin URLs aquí)
├── migrations/             # inmutables una vez creadas
└── seed.ts                 # idempotente (F-09)
openapi/asclepio-api.v1.json
ai/prompts/  ai/vignettes/
prisma.config.ts            # CLI de Prisma: DIRECT_URL (migraciones). Runtime: adapter pg con DATABASE_URL
test/                       # e2e sin base (*.e2e-spec.ts, npm test) e integración con Docker (*.int-spec.ts, npm run test:int)
docker-compose.test.yml     # PostgreSQL 17 LOCAL para npm run test:int (puerto 54329, credenciales ficticias)
scripts/                    # test-int.sh y su guardián assert-local-db.mjs (aborta si la URL no es localhost)
```

## Módulos y datos

| Módulo | Responsabilidad | Tablas propias | Puede usar (services) |
|---|---|---|---|
| `auth` | Login del personal y del paciente, JWT, guard global (rol y tipo de principal), alta de cuenta de paciente, consentimiento, `GET /me` | `patient_accounts` | `users`, `patients`, `tenancy`, `audit` |
| `users` | Usuarios y roles | `users` | `tenancy` |
| `tenancy` | Tenants, sedes y contexto de tenant por petición | `tenants`, `sites` | — |
| `patients` | Búsqueda y alta de pacientes (en F-01, mínimo: `findByDocument` y `create`) | `patients` | `audit` |
| `encounters` | Atenciones, máquina de estados, línea de tiempo y captura clínica | `encounters`, `encounter_events`, `vital_signs`, `symptom_findings` | `patients`, `audit` |
| `triage` | Decisiones humanas (VALIDATE/CORRECT/MANUAL) | `triage_decisions` | `encounters`, `ai`, `audit` |
| `ai` | Sugerencia: `LlmClient` (`GroqAdapter`, `OpenRouterAdapter`), `TriagePromptBuilder`, `TriageResponseValidator`, `SafetyGuards`, `TriageAdvisor` | `triage_suggestions` | `encounters` (solo lectura de la captura) |
| `queue` | Cola priorizada | — | `encounters`, `triage` |
| `reports` | Tiempos, cumplimiento, concordancia y CSV | — | `encounters`, `triage`, `ai` |
| `audit` | Escritura append-only de `audit_log` | `audit_log` | — |

## Dependencias

**Permitidas**
- `modules/*` → `common/*`.
- `modules/A` → el **service exportado** por `modules/B`, si figura en la tabla anterior.
- Solo el módulo dueño de una tabla usa su delegado Prisma (`prisma.<tabla>`).

**Prohibidas**
- Un módulo que consulta tablas de otro (`prisma.encounters` desde `queue`, por ejemplo).
- Dependencias circulares entre módulos.
- `common/` que importa de `modules/`.
- Llamadas HTTP al LLM fuera de los adaptadores de `ai`.
- Leer la hora del cliente para campos legales: se usa el `Clock` de `common/` (inyectable, para poder probarlo).
- Supabase JS, Supabase Auth, Storage o REST.

## Contrato
- `@nestjs/swagger` genera el OpenAPI, y `npm run openapi:export` lo escribe en `openapi/asclepio-api.v1.json` (ADR 0007).
- Prefijo `/api/v1`. Los errores siguen `application/problem+json` mediante un filtro global.

## Autenticación y tenancy (F-01)
- Guard global (`APP_GUARD`, `modules/auth/auth.guard.ts`) con **denegación por defecto**: `@Public()` pasa sin token; el resto exige Bearer válido (401) y `@StaffRoles(...)` o `@PatientOnly()` (403). Decoradores en `common/auth/`.
- El tenant sale **solo** del claim `tid` (`@CurrentPrincipal()`); los services que leen datos de una IPS reciben `tenantId` primero y responden 404 igual para "no existe" y "de otro tenant".
- `@PublicThrottled()` (`common/throttle/`) = `@Public()` + límite de 10 peticiones / 60 s por IP y endpoint (`@nestjs/throttler`, en memoria).
- `TenancyModule` exporta solo el service (lo usan los scripts CLI); `TenancyHttpModule` añade `GET /public/tenants`.

## Scripts y pruebas
- `npm run users:create -- --email … --full-name … --role … --tenant …` (contraseña por stdin) y `npm run sites:create -- --tenant … --name …`: compilan y ejecutan `src/scripts/*` con un contexto Nest mínimo (`CliModule`) sobre `DATABASE_URL`. Fuera de `production` exigen el prefijo `DEV-`.
- `npm test` no necesita base. `npm run test:int` levanta el PostgreSQL local de Docker, aplica las migraciones con `migrate deploy` y ejecuta `test/*.int-spec.ts` como `asclepio_app`.

## Qué es "buen trabajo" aquí
- El cambio vive en el módulo correcto y respeta la tabla de dependencias.
- Cada `R<n>` tiene su prueba `R<n>: …` y pasa.
- No hay datos personales en logs, eventos ni payloads al LLM.
- La decisión humana es obligatoria antes de cualquier nivel final.
- Las migraciones son nuevas, nunca se editan, y se crean con `--create-only`.
- El snapshot OpenAPI está actualizado si cambió un endpoint.
