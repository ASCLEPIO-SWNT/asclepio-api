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
| `triage`     | Decisiones humanas (VALIDATE/CORRECT/MANUAL)                                                                                                    | `triage_decisions`                                                                       | `encounters`, `ai`, `audit`, `users` (nombre del responsable)              |
| `ai`         | Sugerencia: `LlmClient` (`GroqAdapter`, `OpenRouterAdapter`), `TriagePromptBuilder`, `TriageResponseValidator`, `SafetyGuards`, `TriageAdvisor` | `triage_suggestions`                                                                     | `encounters` (solo lectura de la captura), `audit`, `users` (nombre del responsable) |
| `queue`      | Cola priorizada (F-06: solo lectura con `listActiveForQueue`; no usa `triage`)                                                                  | —                                                                                        | `encounters`, `triage`                                                     |
| `reports`    | Tiempos, cumplimiento, concordancia y CSV (F-07: solo lectura; audita la descarga del CSV)                                                      | —                                                                                        | `encounters`, `triage`, `ai`, `audit` (y la constante pura `queue.rules`)  |
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
- `EncountersService.transition(...)` es la transición genérica exportada para F-05/F-06 (UPDATE condicional sobre el estado leído; nunca a `TRIAGED`); F-06 la usa en `startCare` y `close`. `EncounterStateMachine` es una función pura.
- Rutas del paciente bajo `/patient/…`; el paciente sale solo de `pid` y `tid` del token.

## Captura clínica (F-03)

- Vive en `encounters` (D1 de specs/F-03-api/design.md): `ClinicalCaptureService` es el único usuario de `vital_signs` y `symptom_findings` (solo `create` y lecturas) y **se exporta** desde `EncountersModule` para que `ai` (F-04) lea la captura. `ClinicalCaptureController` expone `POST /encounters/{id}/vital-signs`, `POST /encounters/{id}/symptom-findings` (`NURSE`) y `GET /encounters/{id}/clinical-capture` (`NURSE`, `PHYSICIAN`).
- `vital-signs.rules.ts` (puro): `VITAL_SIGN_DEFINITIONS`, `VITAL_SIGN_COHERENCE_RULES` y `validateVitalSigns` (422 de R4–R6), única fuente de la lista de signos y de los rangos **PROVISIONALES** (PA-F03-1, PA-F03-2). `symptom-findings.rules.ts`: tipos de hallazgo y límites técnicos.
- `EncountersService.lockForCapture(...)` bloquea la atención en `WAITING_TRIAGE` con un UPDATE condicional de `updated_at` dentro de la transacción de la captura (0 filas → 404/409). Ningún método modifica `chief_complaint_text` (R10).
- `createValidationPipe()` (`app.setup.ts`) aplana los errores anidados de `class-validator` con la ruta del campo (`items.0.kind`).

## Sugerencia de triage (F-04)

- Vive en `ai`, dueño de `triage_suggestions` (solo `create` y lecturas). `AiCoreModule` (sin Prisma) reúne la configuración del LLM (`loadLlmConfig`), los dos adaptadores (`GROQ_CLIENT`, `OPENROUTER_CLIENT`: un solo `OpenAiCompatibleAdapter` sobre `fetch` con distinta `baseUrl`, clave, modelo y `extraBody`), `TriagePromptBuilder` (`ai/prompts/triage-v1.md`) y `TriageAdvisor`; lo usan `AiModule` y `npm run ai:eval`. `AiModule` añade `TriageSuggestionsService` y `TriageSuggestionsController` (`POST` `NURSE`, `GET` `NURSE`/`PHYSICIAN` en `/encounters/{id}/triage-suggestions`).
- Funciones puras: `triage-input.ts` (instantánea D7 y edad en Bogotá), `redaction.ts` (saneamiento del nombre y el documento), `triage-response.validator.ts` (`TRIAGE_OUTPUT_SCHEMA`), `news2.ts` y `safety-guards.ts` (tabla y reglas **PROVISIONALES**, una sola definición cada una) y `vignette-eval.ts`.
- `ai` lee la captura **solo** con `ClinicalCaptureService.getForSuggestion(tenantId, encounterId)` (exportado por `encounters`; trae el nombre y el documento del paciente para sanear, nunca se serializa), usa `EncountersService.findCaptureHeader` para el 404 del `GET`, `AuditService` (misma transacción) y `UsersService.findNames` (nombre de `requestedBy`).
- El LLM se llama **fuera** de la transacción (D6); un fallo del proveedor es un resultado de negocio (201 con `status` `INVALID_OUTPUT`/`TIMEOUT`/`FAILED`), no un error HTTP. En las pruebas, `GROQ_CLIENT` y `OPENROUTER_CLIENT` se sustituyen por un `LlmClient` falso.

## Decisión de triage (F-05)

- Vive en `triage`, dueño de `triage_decisions` (solo `create` y lecturas). `TriageDecisionsController` expone `POST /encounters/{id}/triage-decision` (`NURSE`) y `GET` (`NURSE`, `PHYSICIAN`). Reglas puras en `triage-decision.rules.ts` (`decide`: R1–R3, R6–R8) y en `dto/triage-decision.dto.ts` (`validateDecisionBody`: 422 de R5).
- Una transacción (D2): `EncountersService.lockForCapture(…, conflictDetail)` bloquea la atención en `WAITING_TRIAGE` (404/409) → `TriageSuggestionsService.findCurrent(tenantId, encounterId, tx)` (sugerencia vigente, exportado por `AiModule`) → `decide` → INSERT de la decisión → **`EncountersService.recordTriage`**, la **única vía a `TRIAGED`** (UPDATE condicional, `final_level`/`triaged_at`/`triaged_by`, evento `TRIAGE_DECIDED` y auditoría). `transition` sigue rechazando `TRIAGED`.
- El `GET` lee el nivel sugerido de la sugerencia decidida con `TriageSuggestionsService.findSuggestedLevel(tenantId, suggestionId)` (por la carrera de D4 la vigente puede no ser la decidida) y el nombre del responsable con `UsersService.findNames`.
- `EncounterSummaryDto` (personal) añade `finalLevel`, `triagedAt` y `triagedBy`; los DTO del paciente no cambian (R18).

## Cola y paso a atención (F-06)

- `queue` no tiene tablas: `QueueService` lee con **`EncountersService.listActiveForQueue(tenantId, siteId?)`** (una consulta a `encounters` por tenant, sede opcional y `WAITING_TRIAGE`/`TRIAGED`/`IN_CARE`; la sede y el paciente salen de `TenancyService.findSiteNames` y `PatientsService.findManyByIds`) y aplica `buildQueue` con un único `Clock.now()` por petición (`serverNow`). `QueueController` expone `GET /queue` (`PHYSICIAN`, `NURSE`, `ADMIN`; solo `siteId` UUID). La cola no usa `triage`: el nivel final vive en `encounters`.
- `queue.rules.ts` (puro): `MAX_WAIT_MINUTES_BY_LEVEL` (I = 0, II = 30, Res. 5596 de 2015; III–V sin tiempo máximo, PA-F06-1), `waitMinutes`, `isOverdue`, `initials` y `buildQueue` (tres secciones y su orden). El nombre del paciente solo se usa para las iniciales: `QueueItemDto` no lleva nombre, documento, fecha de nacimiento, id del paciente ni motivo.
- DT-02-api: `listActiveForQueue` devuelve también `triaged_at`; la alerta (`overdue`, tiempo exacto en ms) y el orden de `triaged` (`minutesSinceTriage`) se cuentan desde la clasificación, como la Res. 256 de 2016; `waitMinutes` sigue desde la llegada.
- La edad (`ageInYears`) vive en `common/clock/age.ts` y la comparten F-04 (`triage-input.ts`, que la reexporta) y la cola.
- `EncountersService.startCare` y `close` abren su transacción y llaman a `transition(…, 'IN_CARE' | 'CLOSED', …)`, como `cancel`: el UPDATE condicional hace que dos peticiones simultáneas den un 200 y un 409. `EncountersController` expone `POST /encounters/{id}/start-care` y `POST /encounters/{id}/close` (`PHYSICIAN`, sin cuerpo o `{}`, 200 con `EncounterDto`).

## Reportes (F-07)

- `reports` no tiene tablas y solo es para `ADMIN`. `ReportsController` expone `GET /reports/summary` (JSON) y `GET /reports/encounters.csv` (`text/csv`), con el mismo `ReportQueryDto` (`from`, `to` en `YYYY-MM-DD`, `siteId?` UUID; `forbidNonWhitelisted`).
- `ReportsService` carga la población en **tres consultas mediante services** (D2), sin tocar tablas ajenas:
  - **`EncountersService.listForReport(tenantId, start, end, siteId?)`**: atenciones por `arrival_at` en `[start, end)`, con la sede de `TenancyService.findSiteNames` y, en la misma consulta, `in_care_at`/`closed_at` de sus `encounter_events` `STATUS_CHANGED`. Sin datos del paciente ni motivo.
  - **`TriageDecisionsService.listByEncounters(tenantId, ids)`**: sin `reason`. **`TriageModule` exporta ahora `TriageDecisionsService`.**
  - **`TriageSuggestionsService.listByEncounters(tenantId, ids)`**: sin instantánea, respuesta cruda, explicación ni intentos.
- Después aplica funciones puras: `report-period.ts` (periodo en Bogotá, −05:00 fijo; 400/422), `report-stats.ts` (mediana, p90 por rango más cercano, porcentajes y kappa de Cohen ponderado cuadrático), `report-rows.ts` (`buildRows`: una fila por atención, con la sugerencia decidida o, si no la hay, la vigente; `summarize`) y `report-csv.ts` (`toCsv`: RFC 4180, CRLF, horas `-05:00` y neutralización de fórmulas).
- El cumplimiento del nivel II se mide de `triaged_at` a `IN_CARE` (Res. 256 de 2016) con el `30` **importado** de `queue/queue.rules.ts` (`MAX_WAIT_MINUTES_BY_LEVEL`). No se duplica.
- La descarga del CSV se audita con `REPORT_EXPORTED` mediante `AuditService`. Los logs solo llevan recuentos. Formato del CSV: docs/reports-csv.md (interno).

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
