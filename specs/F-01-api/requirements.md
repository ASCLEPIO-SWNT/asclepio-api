# F-01-api — Autenticación, roles y tenancy

Brief global: docs/product/features/F-01.md (F-01.AC1–AC5, AC7, AC8; AC6 pertenece a F-01-web)
Contrato: produce 0.2.0 (menor: endpoints nuevos; parte de 0.1.0)
RNF aplicables: RNF-01, RNF-02, RNF-05, RNF-10, RNF-11, RNF-12, RNF-14, RNF-15, RNF-16, RNF-18
Decisiones humanas de partida: progress/current/F-01-api.md, ADR 0003 y ADR 0008 (PA-F01-1..4, PA-PAC-1, PA-PAC-5, PA-PAC-6), y las respuestas a PA-1..PA-9 de esta spec (humano, 2026-10-26).

Glosario de la spec:
- **Principal de personal**: un `users` autenticado (token con audiencia `asclepio-staff`).
- **Principal de paciente**: una `patient_accounts` autenticada (token con audiencia `asclepio-patient`).
- **Endpoint público**: el que declara `@Public()`; todo lo demás es protegido.
- **IPS activa**: un `tenants` con `active = true`.
- **Respuesta 401 genérica**: `401` en `application/problem+json` con `type`, `title` y `detail` fijos e idénticos para cualquier causa de fallo de login.
- **Fecha actual en Bogotá**: la fecha civil (`YYYY-MM-DD`) de la hora del servidor convertida a `America/Bogota`.

## Requisitos

### Inicio de sesión del personal
- **R1** (Por evento) Cuando se reciba `POST /api/v1/auth/login` con un `email` y una `password` que correspondan a un usuario activo, no bloqueado y de una IPS activa, el sistema deberá responder 200 con `accessToken`, `tokenType = "Bearer"` y `expiresAt`, donde `accessToken` es un JWT HS256 con `iss = "asclepio-api"`, `aud = "asclepio-staff"`, `sub` = id del usuario, `tid` = tenant del usuario, `role` = rol del usuario y `exp` = `iat` + 28 800 s (8 h), comparando el `email` sin distinguir mayúsculas de minúsculas. (→ F-01.AC1, F-01.AC2)
- **R2** (Ubicuo) El sistema deberá emitir únicamente tokens de acceso: ninguna respuesta de login contendrá un refresh token y no existirá un endpoint de renovación de tokens. (→ F-01.AC1)

### Inicio de sesión del paciente
- **R3** (Por evento) Cuando se reciba `POST /api/v1/auth/patient/login` con `tenantId`, `documentType`, `documentNumber` y `password` que correspondan a una cuenta de paciente activa y no bloqueada de esa IPS activa, el sistema deberá responder 200 con `accessToken`, `tokenType = "Bearer"` y `expiresAt`, donde `accessToken` es un JWT HS256 con `iss = "asclepio-api"`, `aud = "asclepio-patient"`, `sub` = id de la cuenta de paciente, `tid` = tenant de la cuenta, `pid` = id del paciente, sin claim `role`, y `exp` = `iat` + 28 800 s. (→ F-01.AC7)

### Fallos de login y bloqueo (personal y paciente)
- **R4** (No deseado) Si en cualquiera de los dos endpoints de login la cuenta no existe, la contraseña es incorrecta, la cuenta está inactiva, la cuenta está bloqueada, la IPS de la cuenta está inactiva o (en el login de paciente) el `tenantId` no corresponde a una IPS activa, entonces el sistema deberá responder la respuesta 401 genérica, con el mismo cuerpo en todos los casos y sin emitir token. (→ F-01.AC1, F-01.AC7)
- **R5** (Por evento) Cuando una cuenta existente (de personal o de paciente) acumule 5 intentos fallidos consecutivos por contraseña incorrecta, el sistema deberá fijar `locked_until` = hora del servidor + 15 min y poner `failed_attempts` a 0. (→ F-01.AC1, F-01.AC7)
- **R6** (Por estado) Mientras `locked_until` sea posterior a la hora del servidor, el sistema deberá rechazar el login de esa cuenta con la respuesta 401 genérica aunque la contraseña sea correcta, sin incrementar `failed_attempts`. (→ F-01.AC1, F-01.AC7)
- **R7** (Por evento) Cuando un login sea exitoso, el sistema deberá poner `failed_attempts` a 0 y `locked_until` a NULL en esa cuenta. (→ F-01.AC1, F-01.AC7)

### Autenticación y autorización de endpoints
- **R8** (Ubicuo) El sistema deberá tratar como protegido todo endpoint que no declare `@Public()`; en F-01 los únicos públicos son `GET /api/v1/health`, `POST /api/v1/auth/login`, `POST /api/v1/auth/patient/login`, `POST /api/v1/auth/patient/accounts`, `GET /api/v1/public/tenants` y `GET /api/v1/public/consent`. (→ F-01.AC3)
- **R9** (No deseado) Si una petición a un endpoint protegido llega sin cabecera `Authorization: Bearer`, con un token mal formado, con firma inválida, con algoritmo distinto de HS256, con `iss` o `aud` no reconocidos o con `exp` vencido según la hora del servidor, entonces el sistema deberá responder 401 en `application/problem+json`. (→ F-01.AC3)
- **R10** (No deseado) Si un endpoint protegido no declara ni roles de personal ni acceso de paciente, entonces el sistema deberá responder 403 en `application/problem+json` a cualquier token válido (denegación por defecto). (→ F-01.AC3)
- **R11** (No deseado) Si un token de personal válido llega a un endpoint cuyo conjunto de roles permitidos no incluye el claim `role`, entonces el sistema deberá responder 403 en `application/problem+json`. (→ F-01.AC2, F-01.AC3)
- **R12** (No deseado) Si un token de paciente válido llega a un endpoint de personal, entonces el sistema deberá responder 403 en `application/problem+json`. (→ F-01.AC7)
- **R13** (No deseado) Si un token de personal válido llega a un endpoint exclusivo de paciente, entonces el sistema deberá responder 403 en `application/problem+json`. (→ F-01.AC7)
- **R14** (Ubicuo) El sistema deberá restringir en la base de datos `users.role` a `RECEPTION`, `NURSE`, `PHYSICIAN` o `ADMIN` y exigir `users.tenant_id` no nulo, de modo que todo usuario tenga exactamente un rol y un tenant. (→ F-01.AC2)

### Tenancy
- **R15** (Ubicuo) En las peticiones autenticadas, el sistema deberá tomar el tenant exclusivamente del claim `tid` del token e ignorar cualquier identificador de tenant enviado en cabeceras, query o cuerpo. (→ F-01.AC4)
- **R16** (No deseado) Si una petición autenticada solicita por id un recurso que pertenece a otro tenant, entonces el sistema deberá responder 404 en `application/problem+json` con el mismo cuerpo que para un id inexistente. (→ F-01.AC4)

### Identidad actual
- **R17** (Por evento) Cuando se reciba `GET /api/v1/me` con un token de personal válido, el sistema deberá responder 200 con `kind = "STAFF"`, `id`, `tenantId`, `email`, `fullName` y `role`, sin `password_hash`, `failed_attempts` ni `locked_until`. (→ F-01.AC2)
- **R18** (Por evento) Cuando se reciba `GET /api/v1/me` con un token de paciente válido, el sistema deberá responder 200 con `kind = "PATIENT"`, `id` (cuenta), `tenantId`, `patientId`, `consentVersion` e `identityVerified`, tomados de la cuenta identificada por el token y nunca de parámetros de la petición. (→ F-01.AC7)
- **R19** (No deseado) Si en `GET /api/v1/me` la cuenta del token ya no existe o está inactiva, entonces el sistema deberá responder 401 en `application/problem+json`. (→ F-01.AC1, F-01.AC7)

### Alta de cuenta de paciente
- **R20** (Por evento) Cuando se reciba `POST /api/v1/auth/patient/accounts` con `tenantId` de una IPS activa, `documentType` ∈ {`CC`, `CE`, `PA`}, `documentNumber`, `fullName`, `birthDate` (`YYYY-MM-DD`) de un mayor de edad, `sex`, `password` válida, `consentAccepted = true` y `consentVersion` igual a `PATIENT_CONSENT_VERSION`, y no exista un `patients` con ese tipo y número de documento en ese tenant, el sistema deberá crear, en una sola transacción, el `patients` (con `full_name`, `birth_date` y `sex`) y la cuenta de paciente vinculada a él, con `consent_at` = hora del servidor, `consent_version` = versión aceptada e `identity_verified = false`, y responder 201 con `id` y `patientId`, sin emitir token. (→ F-01.AC7, F-01.AC8)
- **R21** (No deseado) Si `consentAccepted` falta o es distinto de `true`, entonces el sistema deberá responder 422 en `application/problem+json` sin crear ninguna fila. (→ F-01.AC8)
- **R22** (No deseado) Si `consentVersion` falta o no coincide con el valor de la variable de entorno `PATIENT_CONSENT_VERSION`, entonces el sistema deberá responder 422 en `application/problem+json` sin crear ninguna fila. (→ F-01.AC8)
- **R23** (No deseado) Si `password` tiene menos de 10 caracteres o más de 128, entonces el sistema deberá responder 400 en `application/problem+json` con un elemento en `errors[]` cuyo `field` sea `password`, sin crear ninguna fila. (→ F-01.AC7)
- **R24** (No deseado) Si en la fecha actual en Bogotá el paciente aún no ha cumplido 18 años según el `birthDate` declarado (incluida una fecha futura), entonces el sistema deberá responder 422 en `application/problem+json` sin crear ninguna fila. (→ F-01.AC7)
- **R25** (No deseado) Si ya existe una cuenta de paciente para ese tipo y número de documento en el mismo tenant, entonces el sistema deberá responder 409 en `application/problem+json` sin crear ni modificar ninguna fila. (→ F-01.AC7)
- **R26** (No deseado) Si la petición de alta incluye `consentAt`, `identityVerified` o cualquier otro campo no declarado en el DTO, entonces el sistema deberá responder 400 en `application/problem+json` sin crear ninguna fila. (→ F-01.AC8)
- **R44** (Por evento) Cuando se reciba un alta válida según R20 salvo que ya exista en el tenant un `patients` con ese tipo y número de documento y sin cuenta de paciente, el sistema deberá crear la cuenta vinculada a ese `patients` existente, sin modificar sus datos, con `consent_at` = hora del servidor, `consent_version` = versión aceptada e `identity_verified = false`, y responder 201 con `id` y `patientId`. (→ F-01.AC7, F-01.AC8)
- **R45** (Ubicuo) El sistema deberá crear toda cuenta de paciente con `identity_verified = false` y no deberá ofrecer en F-01 ningún endpoint que cambie ese valor. (→ F-01.AC7)
- **R46** (No deseado) Si en el alta falta alguno de `tenantId`, `documentType`, `documentNumber`, `fullName`, `birthDate` o `sex`, o `documentType` no está en {`CC`, `CE`, `PA`} (incluidos `TI` y `RC`), o `birthDate` no es una fecha `YYYY-MM-DD` válida, o `sex` no es uno de los valores admitidos, o `tenantId` no es un UUID, entonces el sistema deberá responder 400 en `application/problem+json` con el campo en `errors[]`, sin crear ninguna fila. (→ F-01.AC7)
- **R47** (No deseado) Si en el alta el `tenantId` no corresponde a una IPS activa, entonces el sistema deberá responder 422 en `application/problem+json` sin crear ninguna fila. (→ F-01.AC7)

### Endpoints públicos de apoyo a la app del paciente
- **R37** (Por evento) Cuando se reciba `GET /api/v1/public/tenants`, el sistema deberá responder 200 con la lista de las IPS activas ordenada por nombre, cada una solo con `id`, `name` y `sites` (lista de `{ id, name }` ordenada por nombre), sin ningún otro campo. (→ F-01.AC7)
- **R38** (Por evento) Cuando se reciba `GET /api/v1/public/consent`, el sistema deberá responder 200 con `{ version, text }`, donde `version` es el valor de `PATIENT_CONSENT_VERSION` y `text` es el contenido del archivo de consentimiento configurado. (→ F-01.AC8)
- **R39** (No deseado) Si una misma IP supera 10 peticiones en una ventana de 60 s a un mismo endpoint de entre `POST /api/v1/auth/login`, `POST /api/v1/auth/patient/login`, `POST /api/v1/auth/patient/accounts`, `GET /api/v1/public/tenants` y `GET /api/v1/public/consent`, entonces el sistema deberá responder 429 en `application/problem+json` con la cabecera `Retry-After` hasta que termine la ventana, sin procesar la petición; `GET /api/v1/health` queda fuera del límite. (→ F-01.AC1, F-01.AC7)

### Contraseñas
- **R27** (Ubicuo) El sistema deberá guardar las contraseñas de personal y de paciente solo como hash scrypt con sal aleatoria por contraseña, y nunca deberá devolverlas ni su hash en ninguna respuesta ni en la salida del script de R40. (→ F-01.AC5, F-01.AC7)

### Alta del personal (script CLI)
- **R40** (Por evento) Cuando se ejecute `npm run users:create` con `--email`, `--full-name`, `--role` y `--tenant` (nombre de la IPS) y la contraseña leída por la entrada estándar, y no exista un usuario con ese email, el sistema deberá crear la IPS si no existe un `tenants` con ese nombre, crear el usuario con el email en minúsculas, el hash de R27 y `active = true`, insertar en `audit_log` una fila `USER_CREATED` con `actor_type = "SYSTEM"`, y terminar con código 0. (→ F-01.AC2)
- **R41** (No deseado) Si al ejecutar `npm run users:create` ya existe un usuario con ese email, entonces el sistema deberá terminar con código 0 informando que el usuario ya existe, sin crear ni modificar ninguna fila. (→ F-01.AC2)
- **R42** (No deseado) Si al ejecutar `npm run users:create` falta un argumento, el email no es válido, el rol no es `RECEPTION`, `NURSE`, `PHYSICIAN` ni `ADMIN`, o la contraseña tiene menos de 10 o más de 128 caracteres, entonces el sistema deberá terminar con código distinto de 0 sin crear ninguna fila. (→ F-01.AC2)
- **R43** (Por estado) Mientras `NODE_ENV` no sea `production`, el sistema deberá rechazar en `npm run users:create`, con código distinto de 0 y sin crear filas, un `--full-name` o un `--tenant` que no empiecen por `DEV-`. (→ F-01.AC2)

### Alta de sedes (script CLI)
- **R48** (Por evento) Cuando se ejecute `npm run sites:create -- --tenant <IPS> --name <sede>` y no exista en esa IPS una sede con ese nombre, el sistema deberá crear la IPS si no existe un `tenants` con ese nombre (igual que R40), crear la sede en esa IPS, insertar en `audit_log` una fila `SITE_CREATED` con `actor_type = "SYSTEM"`, `entity = "site"`, `entity_id` y `tenant_id`, y terminar con código 0. (→ F-01.AC7)
- **R49** (No deseado) Si al ejecutar `npm run sites:create` ya existe en esa IPS una sede con ese nombre, entonces el sistema deberá terminar con código 0 informando que la sede ya existe, sin crear ni modificar ninguna fila. (→ F-01.AC7)
- **R50** (No deseado) Si al ejecutar `npm run sites:create` falta `--tenant` o `--name`, o alguno está vacío, entonces el sistema deberá terminar con código distinto de 0 sin crear ninguna fila. (→ F-01.AC7)
- **R51** (Por estado) Mientras `NODE_ENV` no sea `production`, el sistema deberá rechazar en `npm run sites:create`, con código distinto de 0 y sin crear filas, un `--tenant` o un `--name` que no empiecen por `DEV-`. (→ F-01.AC7)

### Auditoría
- **R28** (Por evento) Cuando un login (de personal o de paciente) sea exitoso, el sistema deberá insertar en `audit_log`, en la misma transacción que R7, una fila con `action = "AUTH_LOGIN_SUCCEEDED"`, `actor_type` (`STAFF` o `PATIENT`), `actor_id`, `tenant_id`, `entity` (`user` o `patient_account`), `entity_id` y `occurred_at` = hora del servidor. (→ F-01.AC5)
- **R29** (Por evento) Cuando un login falle, el sistema deberá insertar en `audit_log` una fila con `action = "AUTH_LOGIN_FAILED"`, `actor_id` NULL, `entity` (`user` o `patient_account`), `entity_id` y `tenant_id` de la cuenta si existe (NULL si no existe), `metadata.reason` en {`UNKNOWN_ACCOUNT`, `BAD_PASSWORD`, `INACTIVE`, `LOCKED`} y `occurred_at` = hora del servidor. (→ F-01.AC5)
- **R30** (Por evento) Cuando R5 bloquee una cuenta, el sistema deberá insertar en `audit_log`, en la misma transacción, una fila con `action = "AUTH_ACCOUNT_LOCKED"`, la entidad y el tenant de la cuenta y `metadata.lockedUntil`. (→ F-01.AC5)
- **R31** (Por evento) Cuando se cree una cuenta de paciente (R20 o R44), el sistema deberá insertar en `audit_log`, en la misma transacción, una fila con `action = "PATIENT_ACCOUNT_CREATED"`, `actor_type = "PATIENT"`, `actor_id` = id de la cuenta, `entity = "patient_account"`, `tenant_id`, `metadata.consentVersion` y `metadata.linkedExistingPatient` (booleano). (→ F-01.AC8)
- **R32** (Ubicuo) El sistema deberá excluir de `audit_log.metadata` la contraseña, su hash, el email, el tipo y número de documento, nombres, fecha de nacimiento, sexo y tokens. (→ F-01.AC5)
- **R33** (No deseado) Si la inserción en `audit_log` de R28 o R31 falla, entonces el sistema deberá revertir la transacción, no emitir token ni crear la cuenta y responder 500 en `application/problem+json`. (→ F-01.AC5)
- **R34** (Ubicuo) El sistema deberá conectarse en runtime con el rol de base de datos `asclepio_app`, que sobre `audit_log` solo tiene `SELECT` e `INSERT`, de modo que un `UPDATE` o `DELETE` sobre `audit_log` con ese rol falle con permiso denegado. (→ F-01.AC5)

### Logs y errores
- **R35** (Ubicuo) El sistema deberá emitir logs sin contraseñas, hashes, emails, tipos ni números de documento, nombres, fechas de nacimiento ni tokens, tanto en logins exitosos y fallidos como en el alta de cuenta de paciente y en `npm run users:create`. (→ F-01.AC5)
- **R36** (Ubicuo) El sistema deberá responder todos los errores de los endpoints de F-01 en `application/problem+json`, sin repetir en `detail` ni en `errors[].message` los valores enviados por el cliente. (→ F-01.AC1, F-01.AC3)

> Numeración: R37–R47 se añadieron tras las respuestas del 2026-10-26 y R48–R51 tras la respuesta a PA-10; R27 se movió de sección sin cambiar su número. Ningún número se ha reutilizado.

## Preguntas abiertas
- [x] PA-1 ¿Cómo se crea el primer `ADMIN` y el resto del personal? → Script CLI idempotente `npm run users:create` (email, nombre, rol, tenant y contraseña con la política de R23 y el hash de R27); en desarrollo los datos llevan el prefijo `DEV-` (humano, 2026-10-26). Cubierto por R40–R43.
- [x] PA-2 ¿Cómo se verifica la mayoría de edad? → El paciente declara `birthDate` en el alta y se exigen 18 años cumplidos a la fecha actual del servidor en `America/Bogota`; si es menor, 422. Se añade `patients.birth_date` (humano, 2026-10-26). Cubierto por R20 y R24.
- [x] PA-3 ¿Cómo identifica la app la IPS sin token? → Endpoint público que lista las IPS activas con sus sedes (solo id y nombre); el alta y el login de paciente reciben `tenantId` (humano, 2026-10-26). Cubierto por R3, R4, R20, R37 y R47.
- [x] PA-4 ¿Cuenta por tenant o global? → Una cuenta por tenant (humano, 2026-10-26). Cubierto por R25 y la restricción única descrita en design.md.
- [x] PA-5 Datos mínimos del alta → `documentType` ∈ {CC, CE, PA} (TI y RC quedan fuera por ser de menores), `documentNumber`, `fullName`, `birthDate` y `sex` (humano, 2026-10-26). Cubierto por R20 y R46. **Propuesta de valores** de `sex`: `M`, `F`, `X` (pendiente de confirmar por producto; no bloquea: la lista vive en un enum y cambiarla es una migración nueva).
- [x] PA-6 ¿Qué pasa si ya existe un `patients` con ese documento y sin cuenta? → Se vincula la cuenta a él, pero toda cuenta nueva nace con `identity_verified = false` hasta que recepción verifique la identidad en el primer pre-registro (F-02). F-01 solo guarda el flag (humano, 2026-10-26). Cubierto por R44 y R45.
- [x] PA-7 ¿Respuesta si el documento ya tiene cuenta en el tenant? → 409 en `problem+json` (humano, 2026-10-26). Cubierto por R25.
- [x] PA-8 Versión y texto del consentimiento → versión vigente en `PATIENT_CONSENT_VERSION` (inicial `2026-10-v1`); endpoint público que devuelve `{ version, text }`, con el texto leído de `docs/legal/consentimiento.md`, que redacta el equipo (humano, 2026-10-26). Cubierto por R22 y R38.
- [x] PA-9 Rate limiting → entra en F-01: 10 peticiones por minuto por IP en los endpoints públicos de login, alta y los públicos nuevos (health excluido), con 429 en `problem+json`, usando `@nestjs/throttler` (humano, 2026-10-26). Cubierto por R39.
- [x] PA-10 ¿Cómo se crean las sedes (`sites`) antes del seed de F-09, que depende de F-07? → Script `npm run sites:create --tenant <IPS> --name <sede>`, idempotente (si la sede ya existe en esa IPS, termina con código 0 sin cambios), que crea la IPS si no existe igual que `users:create` y, mientras `NODE_ENV` no sea `production`, exige el prefijo `DEV-` en `--tenant` y `--name` (humano, 2026-10-26). Cubierto por R48–R51.
