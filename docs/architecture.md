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
│                           # clock (Clock/SystemClock/FixedClock, age), config (validación al arrancar), prisma, throttle, validation
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

| Módulo       | Responsabilidad                                                                                                                                 | Tablas propias                                                                           | Puede usar (services)                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `auth`       | Login del personal y del paciente, JWT, guard global (rol y tipo de principal), alta de cuenta de paciente, consentimiento, `GET /me`           | `patient_accounts`                                                                       | `users`, `patients`, `tenancy`, `audit`                                    |
| `users`      | Usuarios y roles                                                                                                                                | `users`                                                                                  | `tenancy`                                                                  |
| `tenancy`    | Tenants, sedes y contexto de tenant por petición                                                                                                | `tenants`, `sites`                                                                       | —                                                                          |
| `patients`   | Búsqueda y alta de pacientes (NN y menores) y perfil del paciente en la app (F-02)                                                              | `patients`                                                                               | `audit`                                                                    |
| `encounters` | Pre-registros, atenciones, máquina de estados, línea de tiempo y captura clínica                                                                | `pre_registrations`, `encounters`, `encounter_events`, `vital_signs`, `symptom_findings` | `patients`, `tenancy`, `auth` (`PatientAccountsService`), `users`, `audit` |
| `triage`     | Decisiones humanas (VALIDATE/CORRECT/MANUAL)                                                                                                    | `triage_decisions`                                                                       | `encounters`, `ai`, `audit`                                                |
| `ai`         | Sugerencia: `LlmClient` (`GroqAdapter`, `OpenRouterAdapter`), `TriagePromptBuilder`, `TriageResponseValidator`, `SafetyGuards`, `TriageAdvisor` | `triage_suggestions`                                                                     | `encounters` (solo lectura de la captura)                                  |
| `queue`      | Cola priorizada                                                                                                                                 | —                                                                                        | `encounters`, `triage`                                                     |
| `reports`    | Tiempos, cumplimiento, concordancia y CSV                                                                                                       | —                                                                                        | `encounters`, `triage`, `ai`                                               |
| `audit`      | Escritura append-only de `audit_log`                                                                                                            | `audit_log`                                                                              | —                                                                          |

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

## Pre-registro y atenciones (F-02)

- `auth` exporta `PatientAccountsService` (verificación de identidad de la cuenta e `identityVerified` de la bandeja) además de `TokenService`.
- `PatientsModule` exporta solo el service; `PatientsHttpModule` (solo en `AppModule`) añade `GET/POST /patients` y `GET/PATCH /patient/profile`.
- `@Throttled()` (`common/throttle/`) = mismo límite que `@PublicThrottled()` pero sin `@Public()`: lo usan `PATCH /patient/profile` y `POST /patient/pre-registrations`.
- Utilidades transversales movidas a `common/`: `clock/age.ts` (mayoría de edad en Bogotá), `validation/is-calendar-date.ts`, `validation/trimmed-length.ts` y `validation/uuid-param.pipe.ts` (un `{id}` mal formado → 404).
- `EncountersService.transition(...)` es la transición genérica exportada para F-05/F-06 (UPDATE condicional sobre el estado leído; nunca a `TRIAGED`). `EncounterStateMachine` es una función pura.
- Rutas del paciente bajo `/patient/…`; el paciente sale solo de `pid` y `tid` del token.

## Captura clínica (F-03)

- Vive en `encounters` (D1 de specs/F-03-api/design.md): `ClinicalCaptureService` es el único usuario de `vital_signs` y `symptom_findings` (solo `create` y lecturas) y **se exporta** desde `EncountersModule` para que `ai` (F-04) lea la captura. `ClinicalCaptureController` expone `POST /encounters/{id}/vital-signs`, `POST /encounters/{id}/symptom-findings` (`NURSE`) y `GET /encounters/{id}/clinical-capture` (`NURSE`, `PHYSICIAN`).
- `vital-signs.rules.ts` (puro): `VITAL_SIGN_DEFINITIONS`, `VITAL_SIGN_COHERENCE_RULES` y `validateVitalSigns` (422 de R4–R6), única fuente de la lista de signos y de los rangos **PROVISIONALES** (PA-F03-1, PA-F03-2). `symptom-findings.rules.ts`: tipos de hallazgo y límites técnicos.
- `EncountersService.lockForCapture(...)` bloquea la atención en `WAITING_TRIAGE` con un UPDATE condicional de `updated_at` dentro de la transacción de la captura (0 filas → 404/409). Ningún método modifica `chief_complaint_text` (R10).
- `createValidationPipe()` (`app.setup.ts`) aplana los errores anidados de `class-validator` con la ruta del campo (`items.0.kind`).

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
