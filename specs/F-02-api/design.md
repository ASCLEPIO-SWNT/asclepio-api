# F-02-api — Diseño

## Resumen
Se construyen el perfil del paciente en la app, el pre-registro con expiración a las 6 h, la bandeja y la confirmación de llegada de recepción (que verifica la identidad de la cuenta y crea la atención con `arrival_at` = hora del servidor), el rechazo de pre-registros, la búsqueda y el alta de pacientes (incluidos NN y menores), el registro directo, la máquina de estados de la atención con su cancelación, la línea de tiempo append-only (`encounter_events`) y la consulta de atenciones. Reutiliza los patrones de F-01-api: guard global con `@StaffRoles`/`@PatientOnly`, tenant tomado del token, `Clock`, `AuditService` en la misma transacción, `PrismaService`, `problem+json`, throttling y `npm run test:int` con PostgreSQL en Docker.

| Lugar | Qué aporta |
|---|---|
| `modules/patients` | `PatientsService` ampliado: `findByDocument` (ya existe), `findById(tenantId, id, tx?)`, `findManyByIds(tenantId, ids)`, `createByReception(...)`, `getProfile(tenantId, patientId)`, `updateProfile(...)`, `markIdentityVerified(tenantId, patientId, at, tx)`. `PatientsController` (`GET/POST /patients`, RECEPTION) y `PatientProfileController` (`GET/PATCH /patient/profile`, `@PatientOnly`). Dueño de `patients`. |
| `modules/encounters` | `EncounterStateMachine` (pura, sin Nest), `PreRegistrationsService` (crear, expirar, listar, confirmar, rechazar), `EncountersService` (crear desde pre-registro o directo, `transition(...)` exportado para F-05/F-06, cancelar, consultar), `EncounterEventsService` (solo `INSERT` y lectura). Controladores `PatientPreRegistrationsController` (`/patient/pre-registrations`), `PreRegistrationsController` (`/pre-registrations`) y `EncountersController` (`/encounters`). **Dueño de `encounters`, `encounter_events` y `pre_registrations`.** |
| `modules/auth` | Exporta `PatientAccountsService` con dos métodos nuevos: `markIdentityVerified(tenantId, patientId, tx): Promise<{ accountId, changed }>` y `findIdentityFlags(tenantId, patientIds): Promise<Map<patientId, boolean>>`. |
| `modules/users` | `UsersService.findNames(tenantId, ids): Promise<Map<id, fullName>>` para el responsable en la línea de tiempo. |
| `modules/tenancy` | `TenancyService.findSiteInTenant(tenantId, id, tx?)` → `{ id, name } \| null` (sin lanzar 404; el llamador decide 422) y `findSiteNames(tenantId, ids)`. |
| `modules/audit` | Nuevas acciones en `AuditAction` y claves prohibidas nuevas en `metadata`. |
| `src/common/` | `age.ts` se mueve de `modules/auth/age.ts` a `src/common/clock/age.ts` (lo usan `auth` y `patients`; `patients` no puede importar de `auth`). Nuevo decorador `@Throttled()` en `common/throttle/` (límite de R39 de F-01 sin `@Public()`). |

Dependencias entre módulos (cambios respecto a docs/architecture.md): `encounters → patients, tenancy, auth, users, audit` (se añaden `tenancy`, `auth` y `users`). Sin ciclos: `auth → users, patients, tenancy, audit`; `patients → audit`; ningún módulo de los anteriores importa `encounters`.

## Decisiones
| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| D1 | **`pre_registrations` pertenece a `encounters`.** Confirmar convierte un pre-registro en atención en la misma transacción, con el mismo dueño. | Un módulo propio `pre-registrations`; ponerla en `patients`. | ADR 0001 y C3 fijan 10 módulos (`src/modules/` no admite uno nuevo). En `patients` obligaría a `patients → encounters` y a `encounters → patients`: ciclo. El pre-registro es la antesala de la atención y comparte motivo, fuente y sede. |
| D2 | **Expiración perezosa**: al crear se guarda `expires_at = pre_registered_at + 6 h` (constante `PRE_REGISTRATION_TTL_MS`). Las lecturas calculan el estado efectivo con `Clock` (R10); las consultas de pendientes filtran `status = PENDING AND expires_at > :now`; confirmar y rechazar exigen la misma condición. Solo al crear un pre-registro nuevo se materializan a `EXPIRED` los vencidos de ese paciente (R11), para liberar el índice único parcial. | Job programado (cron/`@nestjs/schedule`) que marque `EXPIRED`; `pg_cron`. | No hay infraestructura de jobs ni despliegue con proceso permanente garantizado; un cron en memoria se duplica con varias instancias y deja ventanas en las que un pre-registro vencido sigue `PENDING`. El cálculo con `expires_at` es exacto al milisegundo, determinista y se prueba con `FixedClock`. |
| D3 | **Materialización auditada**: al pasar un vencido a `EXPIRED` (R11) `resolved_at = expires_at` (el instante real de la expiración, no el de la escritura) y se audita `PRE_REGISTRATION_EXPIRED` con `actor_type = SYSTEM`. | No materializar nunca (solo cálculo). | Sin materializar, el índice único parcial "un `PENDING` por paciente" impediría para siempre un nuevo pre-registro tras uno vencido. RNF-01 exige auditar todo cambio de datos. |
| D4 | **Concurrencia al confirmar**: `UPDATE pre_registrations SET status='CONFIRMED', … WHERE id=:id AND tenant_id=:t AND status='PENDING' AND expires_at > :now` (`updateMany`) dentro de la transacción. Si afecta 0 filas se relee para responder 404 (no existe u otro tenant) o 409 (R20). En READ COMMITTED la segunda confirmación concurrente espera el bloqueo de fila, reevalúa el `WHERE` y afecta 0 filas. Respaldo en la base: `encounter_id` único y el índice único parcial de atención activa (D7); un `P2002` se traduce a 409. | `SELECT … FOR UPDATE` seguido de `UPDATE`; bloqueo optimista con columna `version`; transacción `SERIALIZABLE`. | El `UPDATE` condicional es una sola sentencia atómica, no necesita columna extra ni reintentos por fallos de serialización, y Prisma lo expresa sin SQL crudo. |
| D5 | **Transiciones por `UPDATE` condicional**: `EncountersService.transition(tenantId, id, to, actor, tx, opts)` valida con `EncounterStateMachine.canTransition(from, to)` y ejecuta `updateMany WHERE id, tenant_id, status = from`; 0 filas → 409 (R33). Rechaza `to = TRIAGED` (R34): F-05 añadirá su propia vía con `triage_decisions` (RNF-03). | Endpoint genérico `POST /encounters/{id}/transitions`; validar solo en memoria. | Sin el `WHERE status = from`, dos cambios concurrentes podrían saltarse la máquina. Un endpoint genérico abriría `IN_CARE`/`CLOSED` antes de decidir quién los hace (PA-F02-4). |
| D6 | **La atención se inserta directamente con `status = WAITING_TRIAGE`** y se escriben dos eventos (`ENCOUNTER_CREATED` con `to_status = REGISTERED` y `STATUS_CHANGED REGISTERED → WAITING_TRIAGE`), con el mismo `occurred_at` = `arrival_at`; el orden lo da `id` (R37, R42). | Insertar en `REGISTERED` y luego hacer `UPDATE`. | Mismo resultado observable con una escritura menos (PA-F02-2 aceptada: paso automático con dos eventos). |
| D7 | **Unicidad en la base con índices únicos parciales** (SQL manual en la migración): `pre_registrations(patient_id) WHERE status = 'PENDING'` (R8) y `encounters(patient_id) WHERE status NOT IN ('CLOSED','CANCELLED')` (R9, R22, R32). El service comprueba antes para dar 409 con mensaje claro y el `P2002` cubre la carrera. | Solo comprobación en el service; bloqueos de aplicación (`pg_advisory_xact_lock`). | Una comprobación sin restricción tiene carrera. Los índices parciales no requieren bloqueos explícitos (PA-F02-6 aceptada). |
| D8 | **Identidad verificada en dos sitios**: la cuenta (`patient_accounts.identity_verified`, dueño `auth`, decisión de F-01) y el paciente (`patients.identity_verified_at`, dueño `patients`). Al confirmar se fijan ambos en la misma transacción (R18). `identity_verified_at` también se fija al crear un paciente con documento por recepción (R26), que lo registra en persona. Solo `identity_verified_at` bloquea la edición del perfil (R3). | Un solo flag en la cuenta y que `patients` consulte a `auth` para permitir la edición. | `patients → auth` crearía un ciclo (`auth → patients` ya existe). El flag del paciente también cubre a los pacientes creados por recepción que luego abren cuenta vinculada (R44 de F-01), que así no pueden alterar sus datos. |
| D9 | **El registro directo no verifica la cuenta**: si el paciente tiene cuenta y recepción lo registra directamente, `identity_verified` de la cuenta no cambia. | Verificarla también en el registro directo. | La decisión humana dice que la verificación ocurre "en el primer pre-registro". Cambiarlo es una decisión de producto. |
| D10 | **`encounter_events.actor_type` + `actor_id` sin FK**, reutilizando el enum `actor_type` de F-01. `actor_id` NULL solo si `actor_type = SYSTEM` (CHECK). | FK `actor_id → users` (diagrama de docs/data-model.md). | Igual que `audit_log` (D12 de F-01): futuros eventos de F-04 serán del sistema y una tabla append-only no debe depender de FKs que impidan archivar usuarios. La línea de tiempo resuelve el nombre con `UsersService.findNames`. |
| D11 | **FKs compuestas con el tenant**: `encounters(patient_id, tenant_id) → patients(id, tenant_id)`, `encounters(site_id, tenant_id) → sites(id, tenant_id)`, igual en `pre_registrations`, `pre_registrations(encounter_id, tenant_id) → encounters(id, tenant_id)` y `encounter_events(encounter_id, tenant_id) → encounters(id, tenant_id)`. Requiere un único nuevo `sites(id, tenant_id)`. | FKs simples por id. | La base impide que una atención mezcle paciente, sede o eventos de tenants distintos (RNF-11), como ya hace `patient_accounts`. |
| D12 | **FKs de `encounter_events` con `ON DELETE RESTRICT ON UPDATE RESTRICT`** (también hacia `tenants`). | El valor por defecto de Prisma (`ON UPDATE CASCADE`) o `SET NULL`. | Hallazgo de la revisión de F-01: las acciones referenciales se ejecutan como dueño de la tabla y saltarían los grants append-only. Ninguna FK desde una tabla append-only puede modificarla. |
| D13 | **Permisos mínimos**: `encounters` y `pre_registrations` con `SELECT, INSERT, UPDATE` (sin `DELETE`); `encounter_events` solo `SELECT, INSERT` y `USAGE` de su secuencia. | CRUD completo como en las tablas de F-01. | Ninguna funcionalidad borra atenciones ni pre-registros. Las pruebas usan tenants propios y no borran estas filas (como `audit_log`). |
| D14 | **Columnas de F-05 fuera**: `final_level`, `triaged_at` y `triaged_by` no se crean en F-02; las añade la migración de F-05 junto con `triage_decisions`. | Crear ya todas las columnas del diagrama de docs/data-model.md. | Columnas sin escritor ni prueba; F-05 cerrará su tipo y sus CHECK con su spec. |
| D15 | **Tipo de evento como `text`** con unión TypeScript (`ENCOUNTER_CREATED`, `STATUS_CHANGED`) y `from_status`/`to_status` como columnas tipadas con el enum `encounter_status`. | Enum de PostgreSQL para el tipo; todo en `payload`. | Cada feature añadirá tipos (sugerencia, decisión) sin `ALTER TYPE`. Las columnas de estado permiten consultas de reportes (F-07) sin leer JSON. |
| D16 | **Motivos (cancelación y rechazo) en columnas de la tabla dueña**, no en eventos ni en auditoría; `metadata` solo lleva `reasonProvided: true`. Se añaden a `FORBIDDEN_KEYS` de `AuditService`: `chiefcomplainttext`, `complainttext`, `cancellationreason`, `rejectionreason`, `estimatedageyears`. `reason` no se prohíbe porque F-01 lo usa para códigos (`metadata.reason` de `AUTH_LOGIN_FAILED`). | Guardar el motivo en `payload`. | Texto libre = posible dato personal (RNF-05, R41). |
| D17 | **Referencias del cuerpo → 422; ids de la ruta → 404.** Un `siteId` o `patientId` del cuerpo que no es del tenant da 422 (R6, R31); un `{id}` de la ruta inexistente o de otro tenant da 404 con el mismo cuerpo (R13, R21, R44). En el filtro `siteId` de la bandeja, otro tenant da lista vacía (R16). | 404 para todo. | Coincide con F-01 (`tenantId` del cuerpo de una IPS no activa → 422) y con la tabla de errores de conventions.md. |
| D18 | **Rutas del paciente bajo `/patient/…`** (`/patient/profile`, `/patient/pre-registrations`), separadas de las de personal; el paciente se identifica solo por `pid` y `tid` del token. | `/patients/me`, `/pre-registrations` compartida entre principales. | Evita mezclar en un mismo endpoint `@PatientOnly` y `@StaffRoles` con respuestas distintas (el paciente nunca debe recibir campos de personal). Sigue el prefijo `/auth/patient/…` de F-01. |
| D19 | **Throttling de los endpoints de escritura del paciente** (R14) con `@Throttled()` = `UseGuards(ThrottlerGuard)` + respuesta 429 documentada, reutilizando el `ThrottleModule` de F-01 (10/60 s por IP y ruta). | Sin límite (solo la regla de un pendiente). | ADR 0008 pide rate limiting en los endpoints de paciente. Los de lectura quedan sin límite (no escriben y exigen token). |
| D20 | **Búsqueda devuelve una lista** (`[]` o `[paciente]`) con documento exacto, sin normalizar (igual que el login de F-01). | 404 si no existe; búsqueda parcial. | "No encontrado" no es un error para recepción (es el paso previo al alta). La búsqueda parcial expondría más datos personales. |
| D21 | **Orden y paginación**: bandeja sin paginar (acotada por la ventana de 6 h); lista de atenciones con `limit`/`offset` (`limit` 1–100, por defecto 50) ordenada por `arrival_at DESC, id DESC`; lista del paciente fija en 20. | Paginación por cursor. | Volúmenes de MVP; el orden total con `id` hace la paginación estable. La cola priorizada es F-06. |
| D22 | **Una sola hora por operación**: cada operación toma `const now = clock.now()` una vez y la usa para `arrival_at`, `resolved_at`, `occurred_at` y la auditoría. Los DTOs no declaran ninguna hora; `forbidNonWhitelisted` responde 400 (R47). | Rellenar cada columna con `now()` de PostgreSQL. | La API, no la base, es la fuente del reloj probado (`FixedClock`), y la llegada, el cierre del pre-registro y los eventos coinciden exactamente. |
| D23 | **Longitudes técnicas**: `chiefComplaintText` 1–2 000 caracteres no en blanco; motivos de cancelación y rechazo 1–500; `fullName` ≤ 200 (como F-01); `documentNumber` ≤ 64 (como F-01). | Sin límite. | Acotan el tamaño de filas y peticiones; no son valores clínicos. |
| D24 | **Matriz de roles** (RNF-12, R45): `RECEPTION` → `GET/POST /patients`, `GET /pre-registrations`, `POST /pre-registrations/{id}/confirm`, `POST /pre-registrations/{id}/reject`, `POST /encounters`; `RECEPTION` y `NURSE` → `POST /encounters/{id}/cancel` (PA-F02-3); `RECEPTION`, `NURSE`, `PHYSICIAN` y `ADMIN` → `GET /encounters`, `GET /encounters/{id}`; paciente (`@PatientOnly`) → `/patient/profile`, `/patient/pre-registrations`, `/patient/pre-registrations/{id}`. | Dar a `ADMIN` permisos de escritura. | Sigue el brief: recepción registra y confirma; enfermería, medicina y administración consultan. |

## Impacto en contrato
Versión: **0.2.1 → 0.3.0** (menor: solo endpoints y esquemas nuevos; nada existente cambia). `API_CONTRACT_VERSION` en `src/app.setup.ts` pasa a `0.3.0`. Todos los errores siguen la respuesta `default` en `application/problem+json`; en los endpoints con `@Throttled()` se documenta además 429 con `Retry-After`. Todas las rutas protegidas declaran el esquema `bearer`.

Esquemas comunes:
- `ComplaintSource` = `"TYPED" | "VOICE_ON_DEVICE"`; `EncounterStatus` = `"REGISTERED" | "WAITING_TRIAGE" | "TRIAGED" | "IN_CARE" | "CLOSED" | "CANCELLED"`; `EncounterOrigin` = `"PRE_REGISTRATION" | "DIRECT"`; `PreRegistrationStatus` = `"PENDING" | "CONFIRMED" | "EXPIRED" | "REJECTED"`; `DocumentType` = `"CC" | "TI" | "CE" | "PA" | "RC"`.
- `PatientDto { id, documentType|null, documentNumber|null, fullName|null, birthDate|null (YYYY-MM-DD), estimatedAgeYears|null, sex|null, isNN }`.
- `PatientProfileDto { id, documentType, documentNumber, fullName, birthDate, sex, editable }`.
- `PatientPreRegistrationDto { id, siteId, siteName, status, preRegisteredAt, expiresAt, encounter: { id, status } | null }` (sin nivel, sin motivo de rechazo).
- `PendingPreRegistrationDto { id, siteId, siteName, preRegisteredAt, expiresAt, chiefComplaintText, complaintSource, identityVerified, patient: PatientDto }`.
- `EncounterSummaryDto { id, siteId, siteName, status, origin, arrivalAt, preRegistrationId|null, preRegisteredAt|null, chiefComplaintText, complaintSource, cancellationReason|null, registeredBy: { id, fullName }, patient: PatientDto }`.
- `EncounterDto` = `EncounterSummaryDto` + `events: EncounterEventDto[]`; `EncounterEventDto { id (string, bigint serializado), type, fromStatus|null, toStatus|null, payload (object), actor: { type: "STAFF"|"PATIENT"|"SYSTEM", id|null, fullName|null }, occurredAt }`.
- Todas las horas en ISO-8601 con `Z`.

| Método y ruta | Acceso | Request | Response | Errores (problem+json) |
|---|---|---|---|---|
| `GET /api/v1/patient/profile` | `@PatientOnly` | — | 200 `PatientProfileDto` | 401 · 403 |
| `PATCH /api/v1/patient/profile` | `@PatientOnly` + `@Throttled` | `UpdatePatientProfileDto { fullName?, birthDate?, sex? }` (al menos uno) | 200 `PatientProfileDto` | 400 · 401 · 403 · 409 (R3) · 422 (R4) · 429 |
| `POST /api/v1/patient/pre-registrations` | `@PatientOnly` + `@Throttled` | `CreatePreRegistrationDto { siteId, chiefComplaintText, complaintSource }` | 201 `PatientPreRegistrationDto` | 400 · 401 · 403 · 409 (R8, R9) · 422 (R6) · 429 |
| `GET /api/v1/patient/pre-registrations` | `@PatientOnly` | — | 200 `PatientPreRegistrationDto[]` | 401 · 403 |
| `GET /api/v1/patient/pre-registrations/{id}` | `@PatientOnly` | — | 200 `PatientPreRegistrationDto` | 401 · 403 · 404 |
| `GET /api/v1/patients?documentType&documentNumber` | `RECEPTION` | query obligatoria | 200 `PatientDto[]` (0 o 1) | 400 · 401 · 403 |
| `POST /api/v1/patients` | `RECEPTION` | `CreatePatientDto { documentType?, documentNumber?, fullName?, birthDate?, estimatedAgeYears?, sex }` (reglas de R26, R27, R29) | 201 `PatientDto` | 400 · 401 · 403 · 409 (R28) · 422 (R29) |
| `GET /api/v1/pre-registrations?siteId` | `RECEPTION` | `siteId` opcional (uuid) | 200 `PendingPreRegistrationDto[]` | 400 · 401 · 403 |
| `POST /api/v1/pre-registrations/{id}/confirm` | `RECEPTION` | `ConfirmPreRegistrationDto { identityVerified: true }` | 201 `EncounterDto` | 400 · 401 · 403 · 404 · 409 (R20, R22) · 422 (R19) |
| `POST /api/v1/pre-registrations/{id}/reject` | `RECEPTION` | `RejectPreRegistrationDto { reason }` | 200 `RejectedPreRegistrationDto { id, status: "REJECTED", resolvedAt }` | 400 · 401 · 403 · 404 · 409 |
| `POST /api/v1/encounters` | `RECEPTION` | `CreateEncounterDto { patientId, siteId, chiefComplaintText, complaintSource }` | 201 `EncounterDto` | 400 · 401 · 403 · 409 (R32) · 422 (R31) |
| `GET /api/v1/encounters?status&siteId&patientId&limit&offset` | `RECEPTION`, `NURSE`, `PHYSICIAN`, `ADMIN` | query opcional | 200 `{ items: EncounterSummaryDto[] }` | 400 · 401 · 403 |
| `GET /api/v1/encounters/{id}` | `RECEPTION`, `NURSE`, `PHYSICIAN`, `ADMIN` | — | 200 `EncounterDto` | 401 · 403 · 404 |
| `POST /api/v1/encounters/{id}/cancel` | `RECEPTION`, `NURSE` | `CancelEncounterDto { reason }` | 200 `EncounterDto` | 400 · 401 · 403 · 404 · 409 (R36) |

Los endpoints `{id}` validan el UUID con `ParseUUIDPipe`; un id mal formado responde 404 (mismo cuerpo que inexistente, como `TenancyService.findSite`), no 400. Ningún DTO de petición declara horas, `tenantId`, `status` ni `patientId` (en los del paciente).

## Impacto en datos
**Migración: sí** (dos). Se crean con `prisma migrate dev --create-only` **contra el PostgreSQL local de Docker** (`DIRECT_URL` de `docker-compose.test.yml` fijada en la línea de comandos; nunca contra Supabase), se aplican en Docker con `npm run test:int` y en Supabase solo con `prisma migrate deploy`, que ejecuta el responsable de backend (RNF-16, ADR 0003). Las migraciones de F-01 no se tocan.

### Migración 1 — `f02_patients_encounters` (SQL generado por Prisma + bloque manual al final)
Generado desde `schema.prisma` (todo con `@@schema("asclepio")`, ids `uuid` con `gen_random_uuid()`, horas `Timestamptz(6)`):
- Enums: `complaint_source` (`TYPED`, `VOICE_ON_DEVICE`), `encounter_status` (`REGISTERED`, `WAITING_TRIAGE`, `TRIAGED`, `IN_CARE`, `CLOSED`, `CANCELLED`), `encounter_origin` (`PRE_REGISTRATION`, `DIRECT`), `pre_registration_status` (`PENDING`, `CONFIRMED`, `EXPIRED`, `REJECTED`).
- `patients` (completa): añade `estimated_age_years smallint NULL` (PA-F02-1), `identity_verified_at timestamptz NULL` (D8) y `updated_at timestamptz NOT NULL DEFAULT now()` (las filas existentes reciben la hora de la migración). Las filas de F-01 quedan con `identity_verified_at` NULL (todas las creó una cuenta sin verificar): no hace falta backfill.
- `sites`: nuevo único `(id, tenant_id)` (D11).
- `encounters`: `id`, `tenant_id` NOT NULL FK → tenants, `site_id`, `patient_id`, `status encounter_status` NOT NULL, `origin encounter_origin` NOT NULL, `arrival_at timestamptz` NOT NULL (sin default: lo pone la API), `chief_complaint_text text` NOT NULL, `complaint_source` NOT NULL, `registered_by uuid` NOT NULL FK → users(id), `cancellation_reason text` NULL, `created_at`, `updated_at`. Único `(id, tenant_id)`. FKs compuestas `(patient_id, tenant_id) → patients(id, tenant_id)` y `(site_id, tenant_id) → sites(id, tenant_id)`. Índices `(tenant_id, arrival_at DESC)`, `(tenant_id, status, arrival_at)` y `(tenant_id, patient_id)`.
- `pre_registrations`: `id`, `tenant_id`, `patient_id`, `site_id`, `chief_complaint_text` NOT NULL, `complaint_source` NOT NULL, `status pre_registration_status` NOT NULL DEFAULT `PENDING`, `pre_registered_at timestamptz` NOT NULL, `expires_at timestamptz` NOT NULL, `resolved_at timestamptz` NULL, `resolved_by uuid` NULL FK → users(id), `encounter_id uuid` NULL único, `rejection_reason text` NULL, `updated_at`. FKs compuestas a `patients`, `sites` y `(encounter_id, tenant_id) → encounters(id, tenant_id)` (MATCH SIMPLE: no se comprueba mientras `encounter_id` es NULL). Índices `(tenant_id, status, expires_at)` (bandeja) y `(patient_id, pre_registered_at DESC)` (lista del paciente).
- `encounter_events`: `id bigint` (`BIGSERIAL`), `tenant_id` NOT NULL, `encounter_id` NOT NULL, `type text` NOT NULL, `from_status encounter_status` NULL, `to_status encounter_status` NULL, `payload jsonb` NOT NULL DEFAULT `'{}'`, `actor_type actor_type` NOT NULL, `actor_id uuid` NULL (sin FK, D10), `occurred_at timestamptz` NOT NULL. FKs `(encounter_id, tenant_id) → encounters(id, tenant_id)` y `tenant_id → tenants(id)`, **ambas `onDelete: Restrict, onUpdate: Restrict`** en el schema (D12). Índices `(encounter_id, occurred_at, id)` y `(tenant_id, occurred_at)`.

Bloque SQL manual añadido al final de la misma migración (Prisma no los modela; si Prisma 7 admitiera índices parciales en el schema, el implementer lo comprueba con Context7 y los declara allí):
- `CREATE UNIQUE INDEX pre_registrations_one_pending_per_patient ON asclepio.pre_registrations(patient_id) WHERE status = 'PENDING';` (D7, PA-F02-6)
- `CREATE UNIQUE INDEX encounters_one_active_per_patient ON asclepio.encounters(patient_id) WHERE status NOT IN ('CLOSED','CANCELLED');` (D7, PA-F02-6)
- `CHECK ((document_type IS NULL) = (document_number IS NULL))` en `patients` (las filas de F-01 lo cumplen).
- `CHECK (estimated_age_years IS NULL OR (document_number IS NULL AND birth_date IS NULL AND estimated_age_years BETWEEN 0 AND 120))` en `patients` (PA-F02-1).
- `CHECK (expires_at > pre_registered_at)` en `pre_registrations`.
- `CHECK ((actor_type = 'SYSTEM') = (actor_id IS NULL))` en `encounter_events`.
- Comprobación manual del SQL generado: ninguna FK de `encounter_events` con `CASCADE` ni `SET NULL`.

### Migración 2 — `f02_app_role_grants` (SQL escrito a mano en la migración vacía de `--create-only`, antes de aplicarla)
- `GRANT SELECT, INSERT, UPDATE ON asclepio.encounters, asclepio.pre_registrations TO asclepio_app;` (sin `DELETE`, D13).
- `GRANT SELECT, INSERT ON asclepio.encounter_events TO asclepio_app;` y `GRANT USAGE ON SEQUENCE asclepio.encounter_events_id_seq TO asclepio_app;` (sin `UPDATE`, `DELETE` ni `TRUNCATE`, RNF-02).
- `patients` y `sites` ya tienen CRUD desde F-01; no cambian. Sin `ALTER DEFAULT PRIVILEGES` (igual que F-01).

### Inmutabilidad y tiempo
- `encounter_events` es append-only por grants (R40) y por código: `EncounterEventsService` solo expone `append` y lecturas; ningún módulo usa `prisma.encounterEvent.update/delete`.
- `encounters` y `pre_registrations` solo se actualizan junto con su evento y su auditoría en la misma transacción.
- `arrival_at`, `pre_registered_at`, `expires_at`, `resolved_at`, `occurred_at` e `identity_verified_at` salen del `Clock` (RNF-10, D22).
- Una migración futura que necesite índices parciales (D7) debe revisar en su `--create-only` que Prisma no genere `DROP INDEX` de los índices manuales.

### Datos de prueba
Tenants `DEV-test-…-<sufijo>` propios por suite. Como `encounters`, `pre_registrations` y `encounter_events` no admiten `DELETE` para `asclepio_app` y están referenciados con `RESTRICT`, las suites de F-02 no borran sus pacientes, sedes ni atenciones (se documenta en docs/verification.md).

### Paso del humano
Aplicar las dos migraciones en Supabase con `npx prisma migrate deploy` lo hace **solo el responsable de backend** (ADR 0003), avisando al equipo antes y después, y después de las tres migraciones de F-01 si aún no estaban aplicadas. Ningún agente ejecuta comandos contra Supabase.

## Riesgos y pruebas
**Riesgos**
- Un pre-registro creado mientras se confirma el anterior del mismo paciente puede quedar `PENDING` con una atención ya activa; su confirmación fallaría con 409 por el índice de D7 y expiraría a las 6 h. Aceptado.
- La materialización de R11 solo ocurre al crear; los vencidos de pacientes que no vuelven quedan `PENDING` en la base (su estado efectivo es `EXPIRED`). F-07 debe usar el estado efectivo (documentado en docs/data-model.md).
- Si el hook del harness bloqueara rellenar la migración vacía (está permitido mientras no esté versionada), el implementer se detiene y lo documenta en `progress/current/F-02-api.md`.
- Mover `age.ts` a `common/` toca código de F-01: sus pruebas deben seguir pasando sin cambios de comportamiento.
- El 409 de R28 revela que un documento existe en el tenant; solo lo ve `RECEPTION`.

**Unitarias (`*.spec.ts`, sin base)**
- `EncounterStateMachine` (R33, R34): tabla completa 6 × 6 de transiciones permitidas y rechazadas; `TRIAGED` rechazado como destino de la transición genérica.
- Estado efectivo y `expires_at` (R5, R10) con `FixedClock`: justo antes, exactamente en y después de las 6 h.
- Validación de `CreatePatientDto` (R29) y `UpdatePatientProfileDto` (R4) con `class-validator`.
- `assertSafeMetadata` con las claves nuevas (R41).

**e2e sin base (`test/*.e2e-spec.ts`)**
- Matriz de roles (R45) sobre los 14 endpoints: rol no permitido → 403, paciente en ruta de personal y personal en ruta de paciente → 403, sin token → 401.
- Campos prohibidos y horas del cliente → 400 (R46, R47) y throttling (R14).
- Contrato: `info.version = 0.3.0` y las rutas nuevas.

**Integración con base (`test/*.int-spec.ts`, Docker)**
- Grants y FKs (R40): `UPDATE`/`DELETE` en `encounter_events` como `asclepio_app` → `42501`; borrar o cambiar el id de una atención o tenant con eventos → error de FK; índices parciales y CHECK.
- Perfil (R1–R4), pre-registro (R5–R13), bandeja (R15, R16), confirmación con dos peticiones simultáneas (`Promise.all`) (R17–R22), rechazo (R23), pacientes (R24–R29, NN múltiples y mismo documento en dos tenants), registro directo con carrera (R30–R32), cancelación (R35, R36), línea de tiempo y auditoría (R37–R39, R42–R44), fallo de auditoría simulado con el `AuditService` de prueba de F-01 (R39).
- Privacidad (R41, R48): captura del logger y lectura de `payload`/`metadata` buscando el nombre, el documento, el motivo y los textos de cancelación y rechazo de los datos de prueba.

## Cambios de documentación (los hace el implementer)
- docs/architecture.md: `encounters` es dueño también de `pre_registrations` y puede usar `patients`, `tenancy`, `auth`, `users` y `audit`; `auth` exporta `PatientAccountsService`; `age.ts` en `common/clock/`; `@Throttled()`.
- docs/data-model.md: columnas cerradas de `patients`, `encounters`, `pre_registrations` y `encounter_events` (actor sin FK, FKs `RESTRICT`), índices parciales, expiración perezosa y estado efectivo, y que `final_level`/`triaged_*` llegan en F-05.
- docs/verification.md: las suites de F-02 no borran atenciones ni pre-registros; paso del humano para `migrate deploy`.
- docs/glossary.md: "Pre-registro" y "Cuenta de paciente" pasan de "Por definir" a sus tablas.
