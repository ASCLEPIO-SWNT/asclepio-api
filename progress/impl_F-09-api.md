# impl F-09-api — Datos sintéticos y guion de demo

**Rama:** `feature/F-09-api` · **sdd:** false (criterios F-09.AC1–AC5 y las decisiones de `progress/current/F-09-api.md`) · 2026-11-17

Sin migraciones ni cambios de contrato: no se tocaron `prisma/schema.prisma`, `prisma/migrations/` ni `openapi/`. Tampoco hay dependencias nuevas.

## Archivos

| Archivo                                                    | Qué                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/scripts/seed.ts`                                      | Entrada (`dist/scripts/seed.js`). Carga `.env` sin sobrescribir, ejecuta el guardián, crea el contexto Nest y ejecuta el runner. La salida solo lleva ids y conteos; los errores solo dan el mensaje propio o el tipo.                                                                                                                         |
| `src/scripts/seed/seed-guard.ts`                           | `assertSeedTarget`: `DATABASE_URL` y `DIRECT_URL` (si está) en `localhost`/`127.0.0.1`, salvo `ALLOW_REMOTE_SEED=1`. Nunca imprime la URL.                                                                                                                                                                                                     |
| `src/scripts/seed/seed-data.ts`                            | Datos puros: identidad `DEV-<nombre>-` (`SEED_NAME`, por defecto `demo`), personal, 16 pacientes, signos ilustrativos, 30 históricos, 6 vivos y helpers de hora de Bogotá (UTC−5).                                                                                                                                                             |
| `src/scripts/seed/seed-llm.ts`                             | `SeedLlm`: dos `LlmClient` (GROQ/OPENROUTER) con respuestas programadas y sin HTTP, más un `AdvisorTimer` virtual (latencias simuladas).                                                                                                                                                                                                       |
| `src/scripts/seed/seed.module.ts`                          | Contexto del seed: los módulos dueños reales, un `FixedClock` global en lugar de `ClockModule`, y el `TriageAdvisor`, `TriageSuggestionsService` y `TriageDecisionsService` reales conectados a `SeedLlm` (en lugar de `AiCoreModule`). Incluye `ThrottleModule`, que hace falta por el `ThrottlerGuard` de los controladores de `AuthModule`. |
| `src/scripts/seed/seed-runner.ts`                          | Runner idempotente y reanudable (ver Decisiones).                                                                                                                                                                                                                                                                                              |
| `src/scripts/seed/seed-guard.spec.ts`, `seed-data.spec.ts` | Unitarias del guardián y de los datos: los niveles se calculan con `scoreNews2` y `applyGuards` reales.                                                                                                                                                                                                                                        |
| `test/f09-seed.int-spec.ts`                                | Integración contra Docker: el seed como proceso hijo, dos veces.                                                                                                                                                                                                                                                                               |
| `prisma.config.ts`                                         | `migrations: { path, seed: 'npm run -s db:seed' }`.                                                                                                                                                                                                                                                                                            |
| `package.json`                                             | `"db:seed": "npm run -s build && node dist/scripts/seed.js"`.                                                                                                                                                                                                                                                                                  |
| `docs/verification.md`                                     | Sección nueva "Datos sintéticos (seed, F-09-api)" (credenciales, ejecución local y paso del humano en Supabase), viñeta F-09 en las pruebas de integración y "Demo extremo a extremo" reescrita con el flujo de ADR 0008 (AC5).                                                                                                                |

## Decisiones

1. **Ejecución:** `npx prisma db seed` → `npm run -s db:seed` → `npm run build` + `node dist/scripts/seed.js`. Va compilado como los demás scripts, sin `tsx`.
2. **Escritura por los services reales:**
   - `PatientAccountsService.create` (con el `PasswordHasher` y la versión de consentimiento de `APP_CONFIG`) y `PatientsService.createByReception`.
   - `PreRegistrationsService.create` (principal de paciente) y `.confirm`, o `EncountersService.createDirect`.
   - `ClinicalCaptureService.recordVitalSigns` y `recordSymptomFindings`, y `TriageSuggestionsService.request`.
   - `TriageDecisionsService.decide` y `EncountersService.startCare`/`close`.
   - IPS, sede y personal como `sites:create`/`users:create` (`TenancyService`, `UsersService`, `PasswordHasher` y auditoría `SITE_CREATED`/`USER_CREATED`, actor `SYSTEM`).
   - Antes de cada paso se mueve un `FixedClock` a su hora. Así las horas, eventos y auditorías, los CHECK, la máquina de estados y "una atención activa o un pre-registro pendiente por paciente" son exactamente los de la API. El seed nunca hace `UPDATE` ni `DELETE` directos, y `audit_log` y `encounter_events` solo reciben `INSERT` a través de los services.
3. **Idempotencia y reanudación:**
   - Claves deterministas: el nombre de la IPS y la sede, el email, el documento (`CC DEV-<nombre>-NNNN`) y el motivo de consulta con prefijo (único por escenario).
   - Cada escenario se busca por su motivo. Si existe, solo se ejecutan los pasos que falten según su estado y los conteos de signos, hallazgos y sugerencias, con horas relativas a su `arrival_at` real.
   - Los históricos se procesan por orden de llegada y los vivos al final.
4. **Sugerencias sin LLM:** pasan por el `TriageAdvisor`, el validador y los SafetyGuards reales, con respuestas programadas:
   - `model = DEV-seed-sin-llm` y `prompt_version = triage-v1`.
   - OpenRouter = Groq devuelve un HTTP 429 simulado y responde el respaldo; `TIMEOUT` = los dos agotan el timeout; `FAILED` = los dos responden 5xx.
   - `status`, `provider`, `attempts`, `guard_applied`/`guard_reasons` y `latency_ms` (reloj virtual) quedan coherentes con los CHECK de F-04.
5. **Rol:** `DATABASE_URL` (`asclepio_app`), como la API. Ese rol ya tiene todo lo necesario (`INSERT` en las tablas append-only y en `vital_signs`, `symptom_findings`, `triage_*`; `INSERT`/`UPDATE` en `encounters` y `pre_registrations`; CRUD en las tablas de F-01), así que no hace falta el rol dueño. El guardián comprueba también `DIRECT_URL`.
6. **Entorno:** el contexto carga `ConfigModule`, así que el seed exige el mismo `.env` que la API, incluidas `GROQ_*`/`OPENROUTER_*`, aunque nunca llama al LLM.
7. **Prefijo:** `DEV-<nombre>-` en la IPS, la sede, los nombres del personal y de los pacientes, los documentos, los motivos, los hallazgos y los motivos de corrección. Los emails se guardan en minúsculas (D7 de F-01), así que su prefijo es `dev-<nombre>-`. `SEED_NAME` permite que la prueba de integración siembre un conjunto propio por ejecución.
8. **Escenarios vivos:** se fijan en la primera ejecución y no se rejuvenecen (no se duplican ni se mueven). Para una demo fresca: base de Docker nueva u otro `SEED_NAME` (documentado).
9. **Signos y niveles:** son ilustrativos, no criterios clínicos (comentario en `seed-data.ts`). Los niveles sugeridos los calculan los SafetyGuards reales; la unitaria comprueba que cada `CORRECT` cambia el nivel.

## Volumen sembrado (PA-F09-1)

- 1 IPS (`DEV-demo-IPS Asclepio`), 1 sede (`DEV-demo-Sede Centro`), 4 usuarios (uno por rol), 8 cuentas de paciente y 8 pacientes de recepción.
- 30 atenciones `CLOSED` en los días −7…−1, entre las 06:30 y las 18:15 de Bogotá, con niveles I/II/III/IV/V = 2/6/10/9/3.
  - Decisiones: 23 `VALIDATE`, 5 `CORRECT` y 2 `MANUAL` (tras un `TIMEOUT` y un `FAILED`).
  - 2 guards (G1 III→II y G2 IV→III) y 3 respuestas de OpenRouter.
  - 2 atenciones de nivel II con más de 30 min hasta la atención.
- 6 escenarios vivos:
  - 1 pre-registro `PENDING` (`DEV-demo-1005`, dictado).
  - El caso de las 7:42 en `WAITING_TRIAGE`: `DEV-demo-Jorge Castaño`, hombre de 58 años, llegada hace 11 min, FC 112, PA 150/95 y SatO₂ 94 % registrados, sin sugerencia ni decisión.
  - 1 `WAITING_TRIAGE` sin signos.
  - 3 `TRIAGED` (II clasificada hace 26 min, III y IV).
- Totales: 20 pre-registros, 35 atenciones, 34 tomas de signos, 33 sugerencias y 33 decisiones.
- En los reportes de los últimos 7 días: población 35, triadas 33, 31 pares de concordancia (concordancia < 100 %, kappa no nulo).

## Credenciales DEV (solo desarrollo)

La contraseña común es `DEV-demo-clave-2026`:

- `dev-demo-recepcion@asclepio.test` (RECEPTION)
- `dev-demo-enfermeria@asclepio.test` (NURSE)
- `dev-demo-medicina@asclepio.test` (PHYSICIAN)
- `dev-demo-admin@asclepio.test` (ADMIN)
- Pacientes: IPS `DEV-demo-IPS Asclepio`, `CC DEV-demo-1001`…`DEV-demo-1008`.

## Trazabilidad F-09.AC → prueba

| AC  | Prueba                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 | `test/f09-seed.int-spec.ts::F-09.AC1: ejecutarlo dos veces no duplica filas en ninguna tabla (incluidas audit_log y encounter_events)`                                                       |
| AC1 | `test/f09-seed.int-spec.ts::F-09.AC1: el guardián aborta (código 1, sin escribir) si la URL no es localhost, salvo ALLOW_REMOTE_SEED=1`                                                      |
| AC1 | `src/scripts/seed/seed-guard.spec.ts::` (4 pruebas `F-09.AC1: …`: local, remota, sin URL o inválida, `ALLOW_REMOTE_SEED=1` exacto)                                                           |
| AC1 | `src/scripts/seed/seed-data.spec.ts::F-09.AC1: los históricos caen en los 7 días anteriores (Bogotá), con pasos crecientes y terminados antes de hoy` y `F-09.AC1: bogotaInstant usa UTC−5…` |
| AC2 | `test/f09-seed.int-spec.ts::F-09.AC2: una IPS, una sede y un usuario por rol que inicia sesión con la contraseña de desarrollo`                                                              |
| AC2 | `test/f09-seed.int-spec.ts::F-09.AC2: las cuentas de paciente inician sesión en la app con documento y contraseña de desarrollo`                                                             |
| AC2 | `src/scripts/seed/seed-data.spec.ts::F-09.AC2: un usuario por cada uno de los 4 roles, con email dev-<nombre>-…`                                                                             |
| AC3 | `test/f09-seed.int-spec.ts::F-09.AC3: atenciones en todos los niveles I–V, 5 correcciones y los escenarios vivos de la cola`                                                                 |
| AC3 | `test/f09-seed.int-spec.ts::F-09.AC3: el caso de las 7:42 espera triage con sus signos, sin sugerencia ni decisión`                                                                          |
| AC3 | `test/f09-seed.int-spec.ts::F-09.AC3: en la cola, la TRIAGED de nivel II aún no tiene alerta (clasificada hace menos de 30 min)`                                                             |
| AC3 | `test/f09-seed.int-spec.ts::F-09.AC3: la línea de tiempo de una atención cerrada tiene todos los pasos en orden y con responsable`                                                           |
| AC3 | `test/f09-seed.int-spec.ts::F-09.AC3: GET /reports/summary del periodo sembrado (7 días, Bogotá) devuelve datos no vacíos y concordancia < 100 %`                                            |
| AC3 | `src/scripts/seed/seed-data.spec.ts::` `F-09.AC3: 30 históricas…`, `…escenarios vivos…`, `…el caso de las 7:42…` y `…una TRIAGED de nivel II…`                                               |
| AC4 | `test/f09-seed.int-spec.ts::F-09.AC4: todos los datos identificables y textos llevan el prefijo DEV-<nombre>- (emails en minúsculas)`                                                        |
| AC4 | `src/scripts/seed/seed-data.spec.ts::F-09.AC4: el prefijo DEV-<nombre>- y claves únicas (motivo y documento)`                                                                                |
| AC5 | `docs/verification.md` § "Demo extremo a extremo (comprobación manual, F-09.AC5)" (manual, no automatizable)                                                                                 |

## Resultados

- `npm run lint`: OK.
- `npm run typecheck`: OK.
- `npm test`: OK (unitarias, con las 12 nuevas de `src/scripts/seed`, y e2e: 11 suites y 84 pruebas en verde).
- `npm run test:int`: 41 suites y 342 pruebas en verde (67 s), incluida `f09-seed` (10 pruebas).
- Manual contra Docker:
  - `node dist/scripts/seed.js` con `SEED_NAME=try1`: primera ejecución en unos 4,6 s (`tenant=1 site=1 users=4 patients=16 preRegistrations=20 encounters=35 vitalSigns=34 symptomFindings=2 suggestions=33 decisions=33 transitions=60`); la segunda imprime "Ya estaba completo".
  - `./node_modules/.bin/prisma db seed`: también imprime "Ya estaba completo".
  - Con una URL remota: código 1 y el mensaje del guardián, sin la URL.
- `./init.sh` (completo): `FAIL: 0 · WARN: 0 · Estado: VERDE`.
- **No se ejecutó el seed contra Supabase.** Ese paso es del humano y está en `docs/verification.md`.

## Pendiente para el leader

- Los datos `DEV-try1-…` y `DEV-test-<sufijo>-…` de las ejecuciones quedan en la base de Docker local; no se pueden borrar porque son append-only.
- Al cerrar: `feature_list.json`, `docs/roadmap.md` (fila F-09-api y "Estado de slices") y `progress/history.md`.
