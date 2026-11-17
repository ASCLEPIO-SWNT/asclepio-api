# Verificación — asclepio-api

## Cómo se demuestra que algo funciona

1. `./init.sh`: entorno, harness, `.env`, estado y calidad (lint, typecheck, `prisma validate`, Jest).
2. `npm test`: pruebas unitarias y de integración.
3. `npm run openapi:export` sin diff, si la feature tocó el contrato.
4. Evidencia en `progress/impl_<id>.md` y el veredicto en `progress/review_<id>.md`.

## Trazabilidad R<n> → prueba

- Cada requisito `R<n>` de `specs/<id>/requirements.md` tiene al menos una prueba cuyo nombre empieza por `R<n>:`.
  ```ts
  it('R4: responde 403 si el rol no es NURSE', async () => { … });
  ```
- Para comprobarlo: `npx jest --listTests` más `grep -rn "R[0-9]\+:" src test`.
- `implementer` registra la tabla `R<n>` → `archivo::prueba` en `progress/impl_<id>.md`.

## Pruebas de integración contra la base

- Solo con datos de prueba prefijados (`DEV-<nombre>-test-…`), que se limpian al terminar. La limpieza nunca toca `audit_log` ni `encounter_events`: las pruebas usan un tenant de prueba propio y sus filas quedan, porque son append-only.
- Nunca `migrate reset`, `db push` ni `TRUNCATE`.
- **Decisión (humano, 2026-10-26):** las pruebas de integración usan un **PostgreSQL local o desechable (Docker)**, con su propia `DATABASE_URL` de pruebas. Nunca usan Supabase.
- **Cómo (F-01-api):** `npm run test:int` (`scripts/test-int.sh`):
  1. Comprueba con `scripts/assert-local-db.mjs` que `TEST_DIRECT_URL` y `TEST_DATABASE_URL` apuntan a `localhost`/`127.0.0.1` (por defecto, las de `docker-compose.test.yml`); si no, aborta. **No lee `.env`.**
  2. `docker compose -f docker-compose.test.yml up -d --wait` (PostgreSQL 17 en `127.0.0.1:54329`, credenciales ficticias).
  3. `prisma migrate deploy` con `DIRECT_URL` local fijada en la línea de comandos.
  4. Da `LOGIN` y contraseña local a `asclepio_app` (solo en Docker).
  5. `npm run build` (los scripts CLI se prueban como proceso hijo desde `dist/`) y Jest con `test/jest-int.json` (`test/*.int-spec.ts`), conectado como `asclepio_app`.
  - El contenedor queda levantado para repetir; se detiene con `docker compose -f docker-compose.test.yml down`.
  - Los tenants de prueba (`DEV-test-…-<sufijo>`) no se borran porque `audit_log` los referencia; sí se borran sus usuarios, sedes, pacientes y cuentas.
- **F-02-api:** las suites de F-02 (`test/f02-*.int-spec.ts`, `test/int/f02-fixtures.ts`) **no borran** sus tenants, sedes, usuarios, pacientes, atenciones ni pre-registros: `asclepio_app` no tiene `DELETE` sobre `encounters`, `pre_registrations` ni `encounter_events`, y las FKs con `RESTRICT` impiden borrar lo que referencian. Usan tenants `DEV-test-…-<sufijo>` propios por ejecución en el PostgreSQL desechable de Docker.
- **Paso del humano (F-02-api):** aplicar en Supabase las migraciones `f02_patients_encounters` y `f02_app_role_grants` (y las de F-01 si faltan) con `npx prisma migrate deploy` usando su `DIRECT_URL`, solo el responsable de backend y avisando antes y después; después comprobar que `asclepio_app` no tiene `UPDATE`/`DELETE` en `encounter_events`.
- **F-03-api:** las suites de F-03 (`test/f03-*.int-spec.ts`, `test/int/f03-fixtures.ts`) **no borran** tomas, hallazgos ni atenciones: `asclepio_app` solo tiene `SELECT` e `INSERT` sobre `vital_signs` y `symptom_findings`, y sus FKs son `RESTRICT`. Los estados que la API aún no alcanza (`REGISTERED`, `TRIAGED`, `IN_CARE`, `CLOSED`) se preparan como dueño de la base (`DIRECT_URL` local). Usan tenants `DEV-test-…-<sufijo>` propios por ejecución.
- **Paso del humano (F-03-api):** aplicar en Supabase `f03_clinical_capture` y `f03_app_role_grants` con `DIRECT_URL="<URL directa de Supabase, puerto 5432>" npx prisma migrate deploy`, solo el responsable de backend y avisando antes y después; después comprobar con `SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'asclepio_app' AND table_schema = 'asclepio' AND table_name IN ('vital_signs', 'symptom_findings');` que solo hay `SELECT` e `INSERT`.
- **F-04-api:** las suites de F-04 (`test/f04-*.int-spec.ts`) sustituyen `GROQ_CLIENT` y `OPENROUTER_CLIENT` por un `LlmClient` falso (`test/int/fake-llm.ts`): **ninguna prueba llama a Groq ni a OpenRouter** (R32). No borran sugerencias (`asclepio_app` solo tiene `SELECT` e `INSERT` sobre `triage_suggestions` y sus FKs son `RESTRICT`).
- **Paso del humano (F-04-api):** aplicar en Supabase `f04_triage_suggestions` y `f04_app_role_grants` con `DIRECT_URL="<URL directa de Supabase, puerto 5432>" npx prisma migrate deploy`, solo el responsable de backend y avisando antes y después; después comprobar con `SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee = 'asclepio_app' AND table_schema = 'asclepio' AND table_name = 'triage_suggestions';` que solo hay `SELECT` e `INSERT`. Añadir a `.env` `GROQ_MODEL`, `OPENROUTER_MODEL` (y opcionalmente `LLM_TIMEOUT_MS`, `LLM_TOTAL_BUDGET_MS`): sin ellas la API no arranca (R29).
- **F-05-api:** las suites de F-05 (`test/f05-*.int-spec.ts`, `test/int/f05-fixtures.ts`) insertan las sugerencias directamente como `asclepio_app`: **ninguna prueba llama a Groq ni a OpenRouter**. Las fixtures que fuerzan `TRIAGED`, `IN_CARE` o `CLOSED` fijan `final_level`, `triaged_at` y `triaged_by` (CHECK `encounters_triage_required`, R11).
- **Paso del humano (F-05-api):** antes de aplicar, comprobar en Supabase (solo lectura) que `SELECT count(*) FROM asclepio.encounters WHERE status IN ('TRIAGED', 'IN_CARE', 'CLOSED');` devuelve 0; si no, no aplicar. Después, `DIRECT_URL="<URL directa de Supabase, puerto 5432>" npx prisma migrate status` (solo deben estar pendientes `f05_triage_decisions` y `f05_app_role_grants`) y `... npx prisma migrate deploy`, solo el responsable de backend y avisando antes y después. Por último, comprobar en `information_schema.role_table_grants` que `asclepio_app` solo tiene `SELECT` e `INSERT` sobre `triage_decisions`, y que `encounters` sigue sin `DELETE`.
- **F-07-api:** las suites de F-07 (`test/f07-*.int-spec.ts`, `test/int/f07-fixtures.ts`) preparan las atenciones por la API real con un `FixedClock` (llegada, decisión, `start-care`, `close` y `cancel`, con un token emitido a la hora del reloj en cada paso) e insertan las sugerencias **como dueño de la base local** (`DIRECT_URL` de Docker, `insertSuggestionAsOwner`), con proveedor y guard conocidos: **ninguna prueba llama a Groq ni a OpenRouter**. Sin migraciones ni pasos del humano en Supabase.
- **F-09-api:** `test/f09-seed.int-spec.ts` ejecuta `dist/scripts/seed.js` como proceso hijo dos veces con un `SEED_NAME=test-<sufijo>` propio y comprueba que no se duplica nada, los roles, los niveles, el prefijo, la cola y `GET /reports/summary`. El LLM nunca se llama: las respuestas están programadas.
- `npm test` y `./init.sh` **no** necesitan base: las pruebas e2e (`test/*.e2e-spec.ts`) usan la app completa sin `DATABASE_URL` (Prisma conecta de forma perezosa).

## Alta de personal y sedes (scripts CLI, F-01-api)

- `npm run users:create -- --email <email> --full-name DEV-<nombre> --role <RECEPTION|NURSE|PHYSICIAN|ADMIN> --tenant DEV-<IPS>`; la contraseña (10–128 caracteres) se lee por la entrada estándar, sin eco. Idempotente por email.
- `npm run sites:create -- --tenant DEV-<IPS> --name DEV-<sede>`. Idempotente por IPS y nombre.
- Ambos crean la IPS si no existe, auditan (`USER_CREATED` / `SITE_CREATED`, actor `SYSTEM`) y, mientras `NODE_ENV` no sea `production`, exigen el prefijo `DEV-`. Usan `DATABASE_URL` (de `.env` o del entorno).

## Reportes (F-07-api, comprobación manual)

Con la API levantada (`npm run start:dev`) y un usuario `ADMIN` (`npm run users:create -- … --role ADMIN`):

1. Token: `TOKEN=$(curl -s -X POST localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"<admin>","password":"<clave>"}' | jq -r .accessToken)`.
2. Resumen: `curl -s "localhost:3000/api/v1/reports/summary?from=2026-11-01&to=2026-11-10" -H "Authorization: Bearer $TOKEN" | jq`. Comprueba:
   - `population.encounters` = atenciones con llegada en el periodo (hora de Bogotá) y `population.triaged` = las que tienen decisión.
   - `compliance` solo para el nivel 2, con `maxMinutes = 30`, contando de `triagedAt` a `start-care` (Res. 256 de 2016); el nivel 1 solo aparece en `timeToCare`, sin porcentaje.
   - `concordance.pairs` = decisiones `VALIDATE` + `CORRECT`, y `weightedKappa` es `null` con menos de 2 pares.
   - Los porcentajes con denominador 0 son `null`.
3. CSV: `curl -s -D - -o atenciones.csv "localhost:3000/api/v1/reports/encounters.csv?from=2026-11-01&to=2026-11-10" -H "Authorization: Bearer $TOKEN"`. Comprueba:
   - `Content-Type: text/csv; charset=utf-8` y `Content-Disposition: attachment; filename="asclepio-atenciones-2026-11-01_2026-11-10.csv"`.
   - Que el archivo tiene cabecera más `population.encounters` filas, con CRLF (`file atenciones.csv`).
   - Que no aparecen nombres, documentos ni motivos (`grep -i '<nombre del paciente>' atenciones.csv` no devuelve nada).
   - Que hay un `REPORT_EXPORTED` nuevo en `audit_log`.
4. Errores: `from` posterior a `to` → 422; `?from=2026-02-30&to=2026-03-01` → 400; un token de `NURSE` → 403. Todos en `application/problem+json`.
5. Columnas y formato del CSV: docs/reports-csv.md (formato **interno**, no Res. 373 ni SISPRO).

## Componentes de IA

- `TriageResponseValidator` y `SafetyGuards`: pruebas **sin mocks del LLM**, con respuestas JSON literales y entradas clínicas sintéticas.
- `TriageAdvisor`: se prueba con un `LlmClient` falso, que es un puerto y no un mock del proveedor real, para cubrir el fallback, el timeout, el reintento y `INVALID_OUTPUT`.
- Privacidad: hay una prueba que construye el payload con un paciente que tiene nombre y documento y verifica que no aparecen.

## Evaluación con viñetas (`npm run ai:eval`)

Se ejecuta **solo** cuando cambian el prompt (`ai/prompts/`, `prompt_version`) o el modelo (`GROQ_MODEL`/`OPENROUTER_MODEL`), y nunca dentro de `init.sh` ni de las pruebas.

1. Comprueba que `.env` tiene las claves reales del LLM (`GROQ_API_KEY`, `GROQ_MODEL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`).
2. Ejecuta `npm run ai:eval` (= `npm run -s build && node dist/scripts/ai-eval.js`). Recorre `ai/vignettes/*.json` y, por cada viñeta, ejecuta el mismo `TriageAdvisor` del endpoint (prompt → Groq → OpenRouter → validador → SafetyGuards) contra el LLM real, sin base de datos.
3. Revisa la salida: por viñeta, el nivel obtenido (tras los guards), si acertó (`nivel ∈ acceptable_levels`), si subclasificó (`nivel > max(acceptable_levels)`), si hubo guard, el proveedor, el modelo, `prompt_version`, la latencia y si está revisada; al final, el porcentaje de acierto y de subclasificación.
4. Guarda el resultado en `progress/impl_<id>.md` junto con `prompt_version` y el modelo.
5. Umbral (PA-F04-6): un cambio de prompt o modelo solo se acepta si **ninguna viñeta revisada de nivel I o II queda subclasificada o sin nivel**; si ocurre, el comando sale con código ≠ 0. Mientras ninguna viñeta esté revisada (`reviewed_by: null`), el umbral no es vinculante y el comando lo avisa.

## Datos sintéticos (seed, F-09-api)

`npm run db:seed` (o `npx prisma db seed`, que ejecuta lo mismo desde `prisma.config.ts` → `migrations.seed`) compila y lanza `dist/scripts/seed.js`. No usa `tsx` ni dependencias nuevas.

- **Idempotente (F-09.AC1):** cada fila tiene una clave determinista (nombre de la IPS y la sede, email, documento, motivo de consulta con prefijo) y solo se crea si falta. Una segunda ejecución imprime `Ya estaba completo: no se ha creado nada.` Si una ejecución se corta a medias, la siguiente completa el escenario desde el paso que falte. Nunca hay `UPDATE` ni `DELETE` sobre `audit_log` ni `encounter_events`: solo se insertan las filas que faltan.
- **Por los services reales:** cuentas de paciente, pacientes, pre-registros, confirmación, signos, sugerencias, decisiones, `start-care` y `close` pasan por los services de sus módulos, con un `FixedClock` en la hora de cada paso. Así cumplen los CHECK, generan sus eventos y auditorías y respetan la máquina de estados.
- **Sin LLM:** el `TriageAdvisor`, el validador y los SafetyGuards reales reciben respuestas programadas (`src/scripts/seed/seed-llm.ts`, sin HTTP). Las sugerencias sembradas llevan `model = DEV-seed-sin-llm`, y su `status`, `provider` (Groq, o OpenRouter tras un HTTP 429 simulado), `attempts`, `guard_applied` y `latency_ms` (simulada) son coherentes con los CHECK de F-04.
- **Rol:** usa `DATABASE_URL` (`asclepio_app`), como la API. Ese rol ya tiene todos los permisos que el seed necesita (`INSERT` en las tablas append-only e `INSERT`/`UPDATE` en `encounters` y `pre_registrations`), así que no hace falta el rol dueño (`DIRECT_URL`).
- **Entorno:** necesita el mismo `.env` que la API (`DATABASE_URL`, `JWT_SECRET`, `PATIENT_CONSENT_*` y las variables `GROQ_*`/`OPENROUTER_*`, que se validan aunque nunca se llama al LLM).
- **Guardián:** aborta con código 1, sin escribir, si `DATABASE_URL` o `DIRECT_URL` no apuntan a `localhost`/`127.0.0.1`, salvo con `ALLOW_REMOTE_SEED=1` (exactamente `1`). Nunca imprime la URL.
- `SEED_NAME` (opcional, por defecto `demo`) fija el prefijo `DEV-<nombre>-`. La prueba `test/f09-seed.int-spec.ts` usa uno distinto en cada ejecución.

**Qué crea (PA-F09-1, humano, 2026-11-17).** Todo es sintético y lleva el prefijo `DEV-demo-` (F-09.AC4): la IPS, la sede, los nombres, los documentos (`DEV-demo-1001`…), los motivos, los hallazgos y los motivos de corrección. Los emails van en minúsculas (`dev-demo-…`).

- 1 IPS (`DEV-demo-IPS Asclepio`), 1 sede (`DEV-demo-Sede Centro`) y 1 usuario por rol.
- 8 cuentas de paciente (`DEV-demo-1001`…`1008`) y 8 pacientes registrados por recepción (`DEV-demo-2001`…`2008`).
- 30 atenciones históricas `CLOSED`, repartidas en los 7 días anteriores (hora de Bogotá), con niveles I–V (2/6/10/9/3). De ellas: 5 correcciones (la concordancia queda por debajo del 100 %), 2 clasificaciones manuales (tras un `TIMEOUT` y un `FAILED`), 2 guards aplicados, 3 respuestas de OpenRouter y 2 atenciones de nivel II que superan los 30 min hasta la atención.
- 6 escenarios vivos, relativos a la hora de la ejecución:
  - 1 pre-registro pendiente (dictado).
  - El **caso de las 7:42** en `WAITING_TRIAGE`: `DEV-demo-Jorge Castaño`, hombre de 58 años, "dolor torácico opresivo de 40 minutos", llegada hace 11 min, con FC 112, PA 150/95 y SatO₂ 94 % ya registrados, sin sugerencia ni decisión.
  - Otra atención en espera de triage, sin signos.
  - 3 atenciones `TRIAGED` (II, III y IV). La de nivel II se clasificó hace 26 min, a 4 min de la alerta de DT-02, que cuenta desde la clasificación.

Los escenarios vivos se fijan en la **primera** ejecución y no se rejuvenecen: un seed repetido más tarde no los duplica ni los mueve. Para una demo "fresca" en local, recrea la base de Docker (`docker compose -f docker-compose.test.yml down -v` y luego `npm run test:int`, o `prisma migrate deploy`) y vuelve a sembrar, o usa otro `SEED_NAME`.

**Credenciales DEV (solo desarrollo; contraseña común `DEV-demo-clave-2026`):**

| Rol | Usuario |
|---|---|
| RECEPTION | `dev-demo-recepcion@asclepio.test` |
| NURSE | `dev-demo-enfermeria@asclepio.test` |
| PHYSICIAN | `dev-demo-medicina@asclepio.test` |
| ADMIN | `dev-demo-admin@asclepio.test` |
| Paciente (app) | IPS `DEV-demo-IPS Asclepio`, documento `CC DEV-demo-1001`…`DEV-demo-1008` (`1005` ya tiene un pre-registro pendiente) |

**En local (Docker).** La base de `npm run test:int` (`127.0.0.1:54329`) ya tiene las migraciones aplicadas:
```bash
DATABASE_URL=postgresql://asclepio_app:asclepio_app_local@localhost:54329/asclepio_test \
DIRECT_URL=postgresql://asclepio_test:asclepio_test_local@localhost:54329/asclepio_test \
npm run db:seed
```
`process.loadEnvFile` no sobrescribe las variables fijadas en la línea de comandos. El resto (`JWT_SECRET`, consentimiento, LLM) sale de `.env`. Arranca la API con las mismas dos URLs para la demo.

**Paso del humano: sembrar Supabase.** Lo hace solo el responsable de backend, avisando antes y después, y nunca un agente.
1. Comprueba que las migraciones están aplicadas: `DIRECT_URL="<URL directa de Supabase, 5432>" npx prisma migrate status`.
2. Ejecuta `ALLOW_REMOTE_SEED=1 npm run db:seed`, con `DATABASE_URL` de Supabase (`asclepio_app`, pooler 6543) en `.env` o en la línea de comandos.
3. Comprueba que una segunda ejecución imprime `Ya estaba completo`.
4. Los datos sembrados no se pueden borrar (`audit_log` y `encounter_events` son append-only y las FKs son `RESTRICT`), así que no siembres un `SEED_NAME` que no vayas a usar.

## Demo extremo a extremo (comprobación manual, F-09.AC5)

Requisitos: F-01…F-08 en `done`, el seed aplicado y, en local, la API (`npm run start:dev`, `:3000`), la web (`npm run dev` en `asclepio-web`, `:5173`) y el móvil (`asclepio-mobile`, con `adb reverse tcp:3000 tcp:3000` y `./gradlew installDebug`; con Android 17 la red local está bloqueada, así que usa siempre `API_BASE_URL=http://localhost:3000`). Credenciales en la sección anterior. El flujo sigue ADR 0008: el paciente se pre-registra en el móvil y el personal trabaja en la web.

- [ ] `GET /api/v1/health` → 200.
- [ ] **Móvil (paciente):** crea una cuenta nueva con la IPS `DEV-demo-IPS Asclepio`, un documento `DEV-demo-<algo>`, nombre `DEV-demo-…` y consentimiento. También puedes iniciar sesión con una cuenta sembrada sin pre-registro pendiente (p. ej. `DEV-demo-1001`).
  - Envía el pre-registro con el motivo **dictado** si el dispositivo tiene el reconocimiento en español en el dispositivo (ADR 0006: el audio no sale del teléfono; `complaintSource = VOICE_ON_DEVICE`). Si no lo tiene, la app ofrece escribirlo (`TYPED`).
  - La app muestra el pre-registro pendiente y no calcula ninguna hora de llegada.
- [ ] **Web (RECEPTION), `/recepcion`:** el pre-registro aparece en la bandeja (junto al sembrado de `DEV-demo-1005`). Verifica la identidad y confirma la llegada: la atención pasa a `WAITING_TRIAGE` con la **hora del servidor**. En el móvil, el pre-registro pasa a confirmado.
- [ ] **Web (NURSE), `/triage`:** abre la atención nueva y captura los signos. También puedes usar el caso sembrado de las 7:42 (`DEV-demo-Jorge Castaño`), que ya tiene FC 112, PA 150/95 y SatO₂ 94 %.
  - Solicita la sugerencia. Aparecen el nivel, la explicación y los factores, y el aviso si hubo guard. Esta es la única llamada real al LLM de la demo.
  - "Validar" y "Corregir" tienen el mismo peso visual, y no se puede corregir sin motivo.
  - Valida o corrige: la atención pasa a `TRIAGED` con hora del servidor y responsable. Una segunda decisión → 409.
- [ ] **Fallback:** con claves de LLM inválidas (en un `.env` local) la sugerencia queda `FAILED`/`TIMEOUT`, se ofrece el triage manual y el flujo no se bloquea.
- [ ] **Web (PHYSICIAN), `/cola`:** la atención aparece ordenada por nivel y espera, junto a las tres `TRIAGED` sembradas. La de nivel II muestra la alerta al pasar 30 min desde su clasificación.
  - Inicia la atención (`IN_CARE`) y ciérrala (`CLOSED`).
- [ ] **Web, `/atenciones/:id`:** la línea de tiempo muestra cada evento (llegada, signos, decisión, inicio, cierre) con hora en `America/Bogota` y responsable.
- [ ] **Web (ADMIN), `/reportes`:** con el periodo de los últimos 7 días, los reportes muestran tiempos, cumplimiento del nivel II (< 100 %), concordancia (< 100 %, 5 correcciones sembradas) y fallback.
  - Descarga el CSV: sin nombres, documentos ni motivos y con horas ISO-8601. Se registra un `REPORT_EXPORTED` en `audit_log`.
- [ ] Los logs de la API no contienen nombres ni documentos.
