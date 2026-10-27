# F-01-api — Diseño

## Resumen
Se construye la autenticación del personal y del paciente, la autorización por rol y por tipo de principal con denegación por defecto, el aislamiento por tenant, `GET /me`, el alta de cuenta de paciente con consentimiento y mayoría de edad, dos endpoints públicos de apoyo a la app del paciente (IPS con sedes y consentimiento vigente), el límite de peticiones en los endpoints públicos, los scripts `npm run users:create` y `npm run sites:create` y la primera migración del proyecto (esquema `asclepio`, rol `asclepio_app` y `audit_log` append-only). También la infraestructura de pruebas de integración contra un PostgreSQL local en Docker.

Capas y módulos (docs/architecture.md, ADR 0001):

| Lugar | Qué aporta |
|---|---|
| `src/common/prisma/` | `PrismaService` (Prisma 7 + `@prisma/adapter-pg` sobre `DATABASE_URL`). |
| `src/common/clock/` | `Clock` inyectable (`now(): Date` y `todayInBogota(): string` `YYYY-MM-DD`); `SystemClock` en runtime, `FixedClock` en pruebas. |
| `src/common/auth/` | Tipos `Principal` (`StaffPrincipal` / `PatientPrincipal`), decoradores `@Public()`, `@StaffRoles(...)`, `@PatientOnly()`, `@CurrentPrincipal()`. Solo metadatos y tipos: no importa de `modules/`. |
| `src/common/throttle/` | Configuración de `@nestjs/throttler` y decorador `@PublicThrottled()` (= `@Public()` + límite de R39). |
| `modules/auth` | `AuthController` (logins, alta de cuenta de paciente, `GET /me`), `ConsentController` (`GET /public/consent`), `TokenService` (jose), `PasswordHasher` (scrypt), `LoginAttemptPolicy` (bloqueo), `ConsentService` (versión y texto), `AuthGuard` global. **Dueño de `patient_accounts`** (ver "Cambios de documentación"). |
| `modules/users` | `UsersService`: buscar por email/id, crear, actualizar contadores de bloqueo. Dueño de `users`. |
| `modules/tenancy` | `TenancyService`: `findSite(tenantId, id)` con 404 entre tenants, `isActive(tenantId)`, `findOrCreateByName(name)`, `findOrCreateSite(tenantId, name)`, `listActiveWithSites()`; `PublicTenantsController` (`GET /public/tenants`). Dueño de `tenants`, `sites`. |
| `modules/patients` | `PatientsService` mínimo: `findByDocument(tenantId, type, number)` y `create(...)`. Dueño de `patients` (F-02 la amplía). |
| `modules/audit` | `AuditService.record(entry, tx?)`: solo `INSERT` en `audit_log`. |
| `src/scripts/users-create.ts` | Script de R40–R43: contexto de aplicación Nest (`NestFactory.createApplicationContext`) que usa `UsersService`, `TenancyService`, `PasswordHasher` y `AuditService`; no toca Prisma directamente. |
| `src/scripts/sites-create.ts` | Script de R48–R51: mismo patrón que `users-create.ts`, usando `TenancyService` (`findOrCreateByName`, `findOrCreateSite`) y `AuditService`. |

Dependencias entre módulos: `auth → users, patients, tenancy, audit`; `users → tenancy`. `auth → patients` y `auth → tenancy` son nuevas respecto a docs/architecture.md (el login y el alta del paciente son por IPS + documento).

## Decisiones
| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| D1 | Hash con **scrypt de `node:crypto`** (parámetros OWASP: N = 2^17, r = 8, p = 1, sal de 16 bytes, clave de 64 bytes, `maxmem` 256 MiB), formato autodescriptivo `scrypt$N$r$p$<sal b64>$<hash b64>` y comparación con `timingSafeEqual`. | `argon2` (paquete nativo); `bcrypt`/`bcryptjs`. | scrypt está en la biblioteca estándar y OWASP lo acepta cuando no hay Argon2id: cero dependencias y sin compilación nativa. bcrypt trunca a 72 bytes. El formato con parámetros permite subirlos sin migrar datos. |
| D2 | JWT con **`jose`** (`SignJWT` / `jwtVerify`), HS256 fijado en `algorithms`, `issuer` y `audience` verificados, `JWT_SECRET` de al menos 32 bytes (la API no arranca si es más corto). | `@nestjs/jwt` (+ `jsonwebtoken`) y `passport-jwt`. | El proyecto es ESM; `jose` es ESM nativo, sin dependencias y obliga a declarar algoritmo y audiencia. Passport añade una capa de estrategias inútil con un solo esquema Bearer. |
| D3 | Los principales se distinguen por la **audiencia** del token: `aud = "asclepio-staff"` (claims `sub`, `tid`, `role`) frente a `aud = "asclepio-patient"` (claims `sub`, `tid`, `pid`, sin `role`). Mismo emisor y secreto. | Un solo token con claim `kind`; secretos distintos por principal. | La audiencia es el mecanismo estándar y `jwtVerify` la comprueba (R9). Un segundo secreto suma configuración sin cambiar la garantía, porque el guard ya separa por audiencia (R12, R13). |
| D4 | **Guard global** (`APP_GUARD`) con **denegación por defecto**: `@Public()` → pasa sin token; si no, exige Bearer válido (401); después exige `@StaffRoles(...roles)` o `@PatientOnly()`; sin ninguno → 403 (R10). Un endpoint puede declarar ambos (`GET /me`). | Guards por controlador (`@UseGuards`) y lista de rutas públicas en configuración. | Con un guard opt-in, olvidar el decorador deja el endpoint abierto; aquí olvidarlo da 403 y una prueba lo detecta (RNF-12). |
| D5 | **Tenant propagado explícitamente**: el guard construye el `Principal` desde `tid`, `@CurrentPrincipal()` lo entrega al controlador y todo método de service que lea datos de una IPS recibe `tenantId` como primer parámetro y filtra con `where: { id, tenantId }`. "No encontrado" y "de otro tenant" lanzan la misma `NotFoundException` (R16). En los endpoints públicos de paciente (alta y login) el `tenantId` del cuerpo solo se usa antes de autenticar y se valida contra IPS activas (R4, R47). | `AsyncLocalStorage` o una extensión de Prisma que inyecte el filtro; RLS de PostgreSQL. | El parámetro explícito es visible en la revisión (C3) y trivial de probar. La extensión oculta el filtro y no cubre `$queryRaw`. RLS acopla la autorización a la base y al pooler (ADR 0003). |
| D6 | **Token sin estado**: el guard valida firma y claims sin ir a la base. `GET /me` sí lee la cuenta y responde 401 si ya no existe o está inactiva (R19). Sin endpoint de logout: el cliente descarta el token. | Comprobar `active` en la base en cada petición; lista de revocación. | No hay UI para desactivar usuarios en el MVP y el token dura un turno (PA-F01-1). Riesgo aceptado: un usuario desactivado conserva el token hasta 8 h. |
| D7 | **Email único global y en minúsculas** (`users.email` normalizado con `lower()` e índice único). El login del personal no pide tenant. | Email único por tenant y login con tenant. | PA-F01-3 fija un tenant por usuario y el login es email + contraseña (AC1): con unicidad por tenant el login sería ambiguo. |
| D8 | **Bloqueo atómico**: `failed_attempts` y `locked_until` en `users` y `patient_accounts`; el incremento es `UPDATE … SET failed_attempts = failed_attempts + 1 … RETURNING` en la transacción del intento, y al llegar a 5 se fija `locked_until = now + 15 min` (`Clock`) y se reinicia el contador (R5). Para cuentas inexistentes se calcula igualmente un scrypt contra un hash ficticio, para igualar tiempos (R4). | Contador en memoria o tabla de intentos. | El contador en memoria se pierde al reiniciar y no funciona con varias instancias. El límite por IP lo cubre R39. |
| D9 | **Una sola vía de emisión de tokens**: el alta de paciente responde 201 sin token y la app llama después a `POST /auth/patient/login`. | Devolver el token en el alta. | Todo token nace de un login auditado (R28) con la misma política de bloqueo. |
| D10 | **Consentimiento**: la versión vigente es `PATIENT_CONSENT_VERSION` (obligatoria al arrancar; inicial `2026-10-v1`). El texto se lee **una vez al arrancar** del archivo indicado por `PATIENT_CONSENT_TEXT_PATH` (por defecto `docs/legal/consentimiento.md`, resuelto contra `process.cwd()`, que en desarrollo, pruebas y demo es la raíz del repo); si el archivo no existe o está vacío, la API no arranca. `consent_at` lo pone el `Clock` del servidor; el DTO no acepta horas (R26). | Copiar el archivo a `dist/` con `assets` de `nest-cli.json`; guardar el texto en una variable de entorno; tabla `consent_versions`. | El texto lo redacta el equipo en el hub `docs/` y debe haber una sola copia; copiarlo a `dist/` crea una segunda que se puede desincronizar, y `assets` de Nest solo copia desde `src/`. Un texto legal largo no cabe con comodidad en una variable de entorno. Una tabla sería un catálogo sin UI ni dueño. La ruta configurable cubre un despliegue que no arranque desde la raíz. |
| D11 | Errores de reglas de negocio (consentimiento, versión, menor de edad, IPS no activa) → 422; errores de forma del DTO (longitud de contraseña, enums, fecha mal formada, campos de más) → 400 con `errors[]`; documento con cuenta existente → 409 (PA-7). Límite técnico de 128 caracteres en la contraseña para acotar el coste de scrypt. | Todo como 400. | Coincide con la tabla de errores de conventions.md y con el ejemplo de docs/specs.md. |
| D12 | `audit_log.actor_type` (`STAFF` \| `PATIENT` \| `SYSTEM`, nullable) + `actor_id uuid` **sin FK**. `SYSTEM` (con `actor_id` NULL) es el actor del script `users:create`. | Dos columnas FK (`actor_user_id`, `actor_patient_account_id`). | El actor puede ser de dos tablas, del sistema o ninguno (fallos de login); una tabla append-only no debe depender de FKs que algún día impidan archivar cuentas. La integridad la garantiza `AuditService`, único escritor. |
| D13 | Login exitoso, reinicio de contadores y auditoría en **una transacción** (`prisma.$transaction`); si el `INSERT` de auditoría falla no se emite token (R33). Los fallos de login se auditan en su propia transacción junto con el incremento del contador. Lo mismo en el alta (cuenta + `patients` + auditoría). | Auditoría "best effort" fuera de la transacción. | AC5 exige que todo login quede auditado; fallar cerrado es lo seguro. |
| D14 | JSON de la API en **camelCase** (`accessToken`, `documentType`); tablas y columnas en snake_case con `@map`/`@@map`. | snake_case en el JSON. | Es lo natural en NestJS/TypeScript y en los tipos generados por `openapi-typescript` y Kotlin. |
| D15 | Pruebas de integración con **PostgreSQL 17 en Docker** (`docker-compose.test.yml`, puerto local 54329, credenciales locales ficticias) y un script `npm run test:int` que: (1) comprueba que la URL apunta a `localhost`/`127.0.0.1` y aborta si no; (2) `docker compose up -d --wait`; (3) `prisma migrate deploy` con `DIRECT_URL` de la base local; (4) da contraseña local a `asclepio_app` (`ALTER ROLE … LOGIN PASSWORD`) como superusuario local; (5) ejecuta Jest con `test/jest-int.json` (`*.int-spec.ts`), con la app conectada como `asclepio_app`. `init.sh` y `npm test` no cambian y siguen sin necesitar base. | Testcontainers; meter las pruebas con base en `npm test`/`init.sh`. | Decisión humana: Docker local, nunca Supabase (ADR 0003, verification.md). Testcontainers es una dependencia pesada más; meterlas en `init.sh` obligaría a todos a tener Docker y contradice "init.sh nunca escribe en la base". El guardián de `localhost` evita usar por error el `.env` de Supabase. |
| D16 | `PrismaClient` se instancia con `new PrismaPg({ connectionString: DATABASE_URL })` y sin `$connect()` en el arranque (conexión perezosa), para que `npm test` y `openapi:export` sigan funcionando sin base. | `$connect()` en `onModuleInit`. | El export del contrato y las pruebas e2e sin base no deben depender de la red. |
| D17 | **Límite de peticiones con `@nestjs/throttler`**: `ThrottlerModule` con almacenamiento en memoria, ventana 60 s y límite 10, aplicado solo a los endpoints de R39 mediante `@PublicThrottled()` (el `ThrottlerGuard` no es global; `GET /health` no lo lleva). La clave es la IP del cliente más el endpoint (comportamiento por defecto del guard: el contador es por IP y por ruta). `ThrottlerException` es una `HttpException` 429, así que el filtro existente la convierte en `problem+json`; el guard añade `Retry-After`. Límite y ventana configurables (`THROTTLE_LIMIT`, `THROTTLE_TTL_MS`) solo para que las demás pruebas de integración no choquen con el límite; la prueba de R39 usa los valores por defecto. | `express-rate-limit` como middleware de Express; un guard propio; almacenamiento compartido en PostgreSQL o Redis. | `@nestjs/throttler` es el paquete oficial de Nest: se declara por decorador junto al endpoint (visible en la revisión, como los roles) y sus errores pasan por el filtro global sin código extra. `express-rate-limit` vive fuera del ciclo de Nest, se configura por rutas en texto y responde con su propio formato. Un guard propio reinventa la ventana y las cabeceras. Un almacén compartido solo hace falta con varias instancias, que el MVP no tiene. |
| D18 | **Mayoría de edad**: `Clock.todayInBogota()` obtiene la fecha civil con `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' })` (sin dependencias). El paciente es mayor si `birthDate` + 18 años ≤ hoy, comparando año, mes y día; quien nació un 29 de febrero cumple el 1 de marzo en años no bisiestos. | `date-fns-tz` o `luxon`; calcular con milisegundos (365,25 días/año). | `Intl` trae la base de zonas horarias de Node. El cálculo por milisegundos falla en los días frontera. |
| D19 | **Vinculación a `patients` existente (R44)**: la cuenta se vincula sin modificar `full_name`, `birth_date` ni `sex` del paciente existente; los datos declarados en el alta solo se usan para validar (mayoría de edad con el `birthDate` declarado). | Sobrescribir los datos del paciente con los del alta. | El paciente existente lo registró recepción y la cuenta aún no tiene identidad verificada (`identity_verified = false`, PA-6): sobrescribir permitiría a un tercero alterar datos clínicos de identificación. La conciliación es de F-02. |
| D20 | **Script `users:create`**: lee la contraseña por la entrada estándar (sin eco si es una TTY), nunca por argumento, para que no quede en el historial de la shell; crea la IPS por nombre si no existe (`tenants.name` único) y es idempotente por email (R41). Se ejecuta con `DATABASE_URL` (rol `asclepio_app`). Las sedes las crea `sites:create` (D21). | Contraseña por argumento `--password`; endpoint HTTP de alta de personal. | Un argumento queda en el historial y en la lista de procesos. El registro de personal desde la UI o la API está fuera de alcance (F-01.md). |
| D21 | **Script `sites:create`** con el mismo patrón que `users:create` (contexto de aplicación Nest, `DATABASE_URL`, services de `tenancy` y `audit`); idempotente por `(tenant_id, name)` gracias al único de `sites`, con la creación de la IPS compartida con `users:create` (`TenancyService.findOrCreateByName`). | Un flag `--site` repetible en `users:create`; endpoint HTTP de administración de sedes. | Un script por entidad mantiene cada uno simple y permite crear sedes sin crear usuarios. La administración de tenants y sedes desde la UI o la API está fuera de alcance (F-01.md). |

### Decisiones confirmadas por el humano (2026-10-26)
Al aprobar la spec, el humano confirmó: (1) el límite de R39 cuenta por IP y por endpoint (D17); (2) el alta que se vincula a un `patients` existente no sobrescribe sus datos (D19, R44); (3) IPS inactiva → 401 genérico en el login (R4) y 422 en el alta (R47); (4) valores de `sex`: `M`, `F`, `X` (PA-5).

## Impacto en contrato
Versión: **0.1.0 → 0.2.0** (menor: solo endpoints y esquemas nuevos). `API_CONTRACT_VERSION` en `src/app.setup.ts` pasa a `0.2.0`. Se añade el esquema de seguridad `bearer` (JWT) al documento y se aplica a los endpoints protegidos. Todos los errores siguen la respuesta `default` en `application/problem+json`; en los endpoints de R39 se documenta además la respuesta 429 con la cabecera `Retry-After`.

| Método y ruta | Acceso | Request | Response | Errores (problem+json) |
|---|---|---|---|---|
| `POST /api/v1/auth/login` | Público + límite | `StaffLoginDto { email, password }` | 200 `AccessTokenDto { accessToken, tokenType: "Bearer", expiresAt: ISO-8601 Z }` | 400 · 401 genérico (R4) · 429 (R39) |
| `POST /api/v1/auth/patient/login` | Público + límite | `PatientLoginDto { tenantId (uuid), documentType, documentNumber, password }` | 200 `AccessTokenDto` | 400 · 401 genérico (R4) · 429 |
| `POST /api/v1/auth/patient/accounts` | Público + límite | `CreatePatientAccountDto { tenantId (uuid), documentType: "CC" \| "CE" \| "PA", documentNumber, fullName, birthDate (YYYY-MM-DD), sex: "M" \| "F" \| "X", password (10–128), consentAccepted: true, consentVersion }` | 201 `PatientAccountCreatedDto { id, patientId }` | 400 (R23, R26, R46) · 409 (R25) · 422 (R21, R22, R24, R47) · 429 |
| `GET /api/v1/public/tenants` | Público + límite | — | 200 `PublicTenantDto[] { id, name, sites: { id, name }[] }` | 429 |
| `GET /api/v1/public/consent` | Público + límite | — | 200 `ConsentDto { version, text }` | 429 |
| `GET /api/v1/me` | `@StaffRoles(RECEPTION, NURSE, PHYSICIAN, ADMIN)` + `@PatientOnly()` | — | 200 `MeDto` = `StaffMeDto { kind: "STAFF", id, tenantId, email, fullName, role }` \| `PatientMeDto { kind: "PATIENT", id, tenantId, patientId, consentVersion, identityVerified }` (`oneOf` con discriminador `kind`) | 401 (R9, R19) |

`GET /api/v1/health` sigue público, sin límite y sin cambios. No hay endpoint de refresh ni de logout (R2, D6). `users:create` y `sites:create` son scripts y no forman parte del contrato.

## Impacto en datos
**Migración: sí** (la primera del proyecto). Se crea con `prisma migrate dev --create-only` **contra el PostgreSQL local de Docker** (nunca contra Supabase) y se aplica en Supabase solo con `prisma migrate deploy`, que ejecuta el responsable de backend (RNF-16, ADR 0003).

`prisma/schema.prisma`: cada modelo y enum lleva `@@schema("asclepio")`; ids `uuid` con `@default(dbgenerated("gen_random_uuid()"))`; horas `@db.Timestamptz(6)` con `@default(now())` (hora del servidor, RNF-10).

### Migración 1 — `f01_auth_tenancy` (SQL generado por Prisma)
- `CREATE SCHEMA IF NOT EXISTS "asclepio"` y los enums `user_role` (`RECEPTION`, `NURSE`, `PHYSICIAN`, `ADMIN`), `actor_type` (`STAFF`, `PATIENT`, `SYSTEM`) y `patient_sex` (`M`, `F`, `X`; propuesta de valores, PA-5).
- `tenants`: `id`, `name` (único), `active boolean` NOT NULL default true, `created_at`.
- `sites`: `id`, `tenant_id` FK → tenants, `name`, `created_at`; único `(tenant_id, name)`.
- `users`: `id`, `tenant_id` FK NOT NULL, `email` (único, guardado en minúsculas), `password_hash`, `full_name`, `role user_role` NOT NULL, `active` (default true), `failed_attempts int` (default 0), `locked_until timestamptz` NULL, `created_at`, `updated_at`; índice `(tenant_id)`.
- `patients` (dueño `patients`): `id`, `tenant_id` FK NOT NULL, `document_type text`, `document_number text` NULL (NN), `full_name text` NULL, `birth_date date` NULL, `sex patient_sex` NULL, `created_at`; único `(tenant_id, document_type, document_number)` y único `(id, tenant_id)` (para la FK compuesta). Las columnas son nullables en la base porque F-02 registra pacientes NN o graves sin todos los datos; el alta de F-01 las exige en el DTO (R46). `document_type` es `text` (no enum) porque F-02 admitirá tipos que el alta del paciente excluye (`TI`, `RC`).
- `patient_accounts` (dueño `auth`): `id`, `tenant_id`, `patient_id`, FK compuesta `(patient_id, tenant_id)` → `patients(id, tenant_id)` para que la cuenta no pueda cruzar tenants, `password_hash`, `consent_at timestamptz` NOT NULL, `consent_version text` NOT NULL, `identity_verified boolean` NOT NULL default false, `active` (default true), `failed_attempts`, `locked_until`, `created_at`, `updated_at`; único `(patient_id)`. Junto con el único de `patients` por `(tenant_id, document_type, document_number)`, garantiza **una cuenta por documento y tenant** (PA-4); el mismo documento puede tener otra cuenta en otra IPS.
- `audit_log` (dueño `audit`): `id bigint` identity, `tenant_id` FK NULL (los fallos con cuenta inexistente no tienen tenant), `actor_type` NULL, `actor_id uuid` NULL, `action text` NOT NULL, `entity text` NOT NULL, `entity_id text` NULL, `metadata jsonb` NOT NULL default `'{}'`, `occurred_at timestamptz` NOT NULL default `now()`; índice `(tenant_id, occurred_at)`.

### Migración 2 — `f01_app_role_grants` (SQL escrito a mano en la migración vacía de `--create-only`, antes de aplicarla en ningún sitio)
- `CREATE ROLE asclepio_app NOLOGIN` si no existe (bloque `DO`). La contraseña y el `LOGIN` **no** van en la migración (RNF-18): en Supabase los fija el responsable de backend fuera de banda; en Docker, el script de `test:int`.
- `REVOKE ALL ON SCHEMA asclepio FROM PUBLIC`; `GRANT USAGE ON SCHEMA asclepio TO asclepio_app`.
- `GRANT SELECT, INSERT, UPDATE, DELETE` sobre `tenants`, `sites`, `users`, `patients`, `patient_accounts`.
- **`audit_log`: solo `GRANT SELECT, INSERT`** (sin `UPDATE`, `DELETE` ni `TRUNCATE`, RNF-02) y `GRANT USAGE` sobre su secuencia de identidad.
- Sin `ALTER DEFAULT PRIVILEGES`: cada migración futura concede sus permisos explícitamente, para que una tabla append-only nueva (p. ej. `encounter_events`) nunca herede `UPDATE`/`DELETE`.

### Inmutabilidad y tiempo
- `audit_log` es append-only por grants (R34) y por código: `AuditService` solo expone `record`; ningún módulo usa `prisma.auditLog.update/delete`.
- `consent_at`, `locked_until` y `occurred_at` se fijan con el reloj del servidor (`Clock` o `now()`), nunca con horas del cliente (RNF-10). `birth_date` es un dato declarado (fecha civil, no hora legal) y la comparación de edad usa la fecha del servidor en `America/Bogota` (D18).
- Las pruebas usan tenants propios con prefijo `DEV-test-…` y no borran filas de `audit_log` (docs/verification.md).

### Configuración (`.env.example`)
- `DATABASE_URL` (runtime, usuario `asclepio_app`) y `DIRECT_URL` (CLI) ya existen.
- Nuevas: `PATIENT_CONSENT_VERSION=2026-10-v1`, `PATIENT_CONSENT_TEXT_PATH=docs/legal/consentimiento.md`, `THROTTLE_LIMIT=10`, `THROTTLE_TTL_MS=60000` y `TEST_DATABASE_URL` / `TEST_DIRECT_URL` con las URLs locales de Docker (credenciales ficticias de desarrollo).
- `JWT_SECRET`: el valor de ejemplo debe tener ≥ 32 caracteres para que la API arranque (D2).

### Archivo de consentimiento
- `docs/legal/consentimiento.md`: lo crea la tarea como **marcador** que empieza con el aviso "Texto pendiente de redacción por el equipo. No válido legalmente." El equipo lo sustituye por el texto real (Ley 1581) y, al cambiarlo, sube `PATIENT_CONSENT_VERSION`.

### Dependencias nuevas (C3)
`jose` (D2), `@nestjs/throttler` (D17), `@prisma/client` y `@prisma/adapter-pg` (+ `pg`, que exige el adaptador) para el runtime de Prisma 7 (ADR 0003). El hash, la zona horaria y la lectura del archivo no añaden dependencias (D1, D18, D10). El implementer confirma con Context7 las APIs vigentes de Prisma 7 (`PrismaPg`, `@@schema`), de `jose` y de `@nestjs/throttler` (compatibilidad con NestJS 12, clave por IP y por ruta, `Retry-After`) antes de usarlas.

### Cambios de documentación (los hace el implementer en T19)
- docs/architecture.md: `auth` pasa a ser dueño de `patient_accounts` y puede usar `patients` y `tenancy`; se añaden `src/scripts/`, `npm run users:create`, `npm run sites:create` y `npm run test:int`.
- docs/data-model.md: sustituir la propuesta de `patient_accounts` por las columnas cerradas aquí (incluido `identity_verified`), añadir `tenants.active`, `patients.sex` como enum y `audit_log.actor_type`.
- docs/verification.md: cómo levantar Docker, ejecutar `npm run test:int` y crear usuarios y sedes con `npm run users:create` y `npm run sites:create`.

## Riesgos y pruebas
**Riesgos**
- El hook del harness podría bloquear la escritura del SQL de la migración 2 dentro de `prisma/migrations/`. Si ocurre, el implementer se detiene y lo documenta en `progress/current/F-01-api.md` (no edita migraciones ya aplicadas en ningún caso).
- `process.loadEnvFile('.env')` en `prisma.config.ts` podría cargar la URL de Supabase si el script no fija `DIRECT_URL` antes: el guardián de `localhost` de `test:int` aborta antes de cualquier `migrate`.
- Pooler de Supabase en modo transacción con `pg`: el implementer verifica que `@prisma/adapter-pg` no use sentencias preparadas con nombre; las pruebas corren contra Docker sin pooler, así que este punto se comprueba a mano cuando el responsable aplique la migración en la base compartida.
- Token sin estado (D6): un usuario desactivado mantiene acceso hasta 8 h.
- Límite en memoria (D17): con varias instancias el límite sería por instancia; detrás de un proxy inverso la IP vista sería la del proxy (hay que configurar `trust proxy` cuando exista un despliegue; hoy no lo hay).
- El 409 de R25 revela que un documento ya tiene cuenta en la IPS (aceptado por el humano en PA-7); R39 limita la enumeración.
- La app arranca desde la raíz del repo (D10); un despliegue desde otro directorio debe fijar `PATIENT_CONSENT_TEXT_PATH`.

**Unitarias (`src/**/*.spec.ts`, sin base)**
- `PasswordHasher` (R27): hash distinto por sal, verificación correcta/incorrecta, formato y parámetros.
- `TokenService` (R1, R3, R9): claims, audiencias, `exp - iat = 28 800`, rechazo de `alg: none`, HS512, firma ajena, `iss`/`aud` desconocidos y expirado con `FixedClock`.
- `LoginAttemptPolicy` (R5, R6, R7) con `FixedClock`.
- Mayoría de edad (R24) con `FixedClock`: cumple hoy, cumple mañana, 29 de febrero, fecha futura, y medianoche UTC frente a la fecha de Bogotá.
- `ConsentService` (R38): lee el archivo y la versión; falla al arrancar si falta el archivo o la variable.

**e2e sin base (`test/*.e2e-spec.ts`, `npm test`)**
- `AuthGuard` con un controlador de prueba registrado solo en el módulo de prueba (rutas sin decorador, `@StaffRoles(NURSE)`, `@PatientOnly()`) y tokens firmados con el `TokenService`: R8, R9, R10, R11, R12, R13, R15, R36.
- `GET /public/consent` (R38) y límite (R39): la petición 11 en 60 s a un endpoint limitado recibe 429 `problem+json` con `Retry-After`; otro endpoint limitado y `GET /health` siguen respondiendo.
- Contrato: el documento OpenAPI tiene `info.version = 0.2.0` y las seis rutas nuevas.

**Integración con base (`test/*.int-spec.ts`, `npm run test:int`, Docker)**
- Logins, bloqueo y auditoría: R1–R7, R28–R30, R32, R33 (fallo de auditoría simulado con un `AuditService` de prueba que lanza).
- Alta de cuenta: R20–R26, R31, R44–R47.
- `GET /public/tenants`: R37 (IPS inactiva excluida, sin campos de más, orden).
- `GET /me`: R17, R18, R19.
- Tenancy: R14 (rol inválido o `tenant_id` nulo falla), R16 (`TenancyService.findSite` y controlador de prueba con dos tenants).
- Script `users:create`: R40–R43, ejecutado como proceso hijo contra la base de Docker, comprobando código de salida, filas creadas y que la salida no contiene la contraseña (R27, R35).
- Script `sites:create`: R48–R51, igual que el anterior (código de salida, filas creadas, idempotencia, prefijo `DEV-` y auditoría `SITE_CREATED`).
- Grants: R34 (como `asclepio_app`: `INSERT` y `SELECT` sobre `audit_log` funcionan; `UPDATE` y `DELETE` fallan con `42501`).
- Logs: R35 (se captura la salida del logger durante logins, alta y el script y se comprueba que no aparecen email, documento, nombre, fecha de nacimiento, contraseña ni token).
