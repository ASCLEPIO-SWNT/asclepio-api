# F-04-api — Tareas

> **Orden estricto.** En cada tarea, primero la prueba `R<n>: …` y luego el código. No se empieza ninguna tarea hasta que la spec esté aprobada (aprobada por el humano el 2026-11-09, con PA-F04-1..7 cerradas).
>
> La tabla NEWS2 y las reglas G1–G3 (design.md D10) son **PROVISIONALES — no validadas clínicamente, revisar con asesor clínico**.
>
> **Nada se ejecuta contra Supabase.** Las migraciones se crean con `prisma migrate dev --create-only` **solo** contra el PostgreSQL local de Docker (puerto 54329), pasando `DIRECT_URL` y `DATABASE_URL` locales en la línea de comandos (nunca con `.env`), y se aplican solo en Docker con `npm run test:int`.
>
> **Ninguna prueba automática llama a un LLM real** (R32): todas usan un `LlmClient` falso o un `fetch` interceptado.

- [x] T1 Migración 1 `f04_triage_suggestions` (aislada): en `prisma/schema.prisma`, modelo `TriageSuggestion` y enums `triage_suggestion_status` y `llm_provider` según design.md "Impacto en datos". **Todas las FK con `onDelete: Restrict, onUpdate: Restrict`** (`(encounter_id, tenant_id) → encounters`, `tenant_id → tenants`, `requested_by → users`) y el índice `(encounter_id, created_at DESC, id DESC)`.
  - Generar con: `docker compose -f docker-compose.test.yml up -d --wait`, `node scripts/assert-local-db.mjs …` y `DIRECT_URL="postgresql://asclepio_test:asclepio_test_local@localhost:54329/asclepio_test" DATABASE_URL="postgresql://asclepio_app:asclepio_app_local@localhost:54329/asclepio_test" npx prisma migrate dev --create-only --name f04_triage_suggestions`.
  - Añadir al final el SQL manual de los CHECK (coherencia de `status` con los niveles, rangos 1–5, `suggested_level <= llm_level`, `guard_applied`, `latency_ms >= 0`).
  - Revisar a mano: ninguna FK `CASCADE`/`SET NULL` y ningún `DROP` de objetos de F-01 a F-03 (índices parciales incluidos).
  - Commit aislado. (R19, R20, R24)
- [x] T2 Migración 2 `f04_app_role_grants` (aislada): migración vacía con el mismo comando; SQL `GRANT SELECT, INSERT ON asclepio.triage_suggestions TO asclepio_app;` sin `UPDATE`, `DELETE`, `TRUNCATE`, contraseñas ni `ALTER DEFAULT PRIVILEGES`. Commit aislado. (R24)
- [x] T3 Aplicar las dos migraciones en Docker (`npm run test:int`) y escribir las pruebas de integración de base:
  - `R24:` `UPDATE` y `DELETE` como `asclepio_app` → `42501`; como dueño, borrar o cambiar el id de la atención, el tenant o el usuario referenciados → error de FK.
  - `R19:` insertar `suggested_level > llm_level` → violación de CHECK, más el resto de CHECK.
  - Las pruebas de F-01 a F-03 siguen en verde. (R19, R24)
- [x] T4 Prueba unitaria + `common/config/app-config.ts`: bloque `llm` y `loadLlmConfig(env)`. `R29:` falta cada variable obligatoria → error que nombra la variable sin su valor; `LLM_TIMEOUT_MS > LLM_TOTAL_BUDGET_MS` → error; los valores por defecto son 8 000 y 20 000. Actualizar `.env.example` (`GROQ_MODEL=openai/gpt-oss-120b`, `OPENROUTER_MODEL=openai/gpt-oss-120b`, `LLM_TIMEOUT_MS=8000`, `LLM_TOTAL_BUDGET_MS=20000`) y la comprobación de claves de `init.sh` (que ya lista `GROQ_API_KEY` y `OPENROUTER_API_KEY`, y suma `GROQ_MODEL` y `OPENROUTER_MODEL`). La configuración de prueba (`test/setup-env.ts`) usa valores ficticios. (R29)
- [x] T5 Prueba unitaria + `news2.ts` (pura): `NEWS2_TABLE` exactamente como la tabla D10, con el comentario "PROVISIONAL — no validado clínicamente, revisar con asesor clínico", la fuente (RCP 2017, escala 1), la fecha (2026-11-09) y quién decidió (humano, PA-F04-1). `R17:` cada límite de cada banda de los siete parámetros, más `C`/`V`/`P`/`U` → 3, O₂ suplementario → 2 y la suma total. (R17)
- [x] T6 Prueba unitaria + `safety-guards.ts` (pura): `SAFETY_GUARD_RULES` con **exactamente** G1, G2 y G3 (PA-F04-1; G4 rechazada, no se implementa), con el mismo comentario PROVISIONAL. Pruebas **sin mocks del LLM** (ADR 0005):
  - `R18:` cada regla en su umbral y justo por debajo; varias reglas a la vez → gana el nivel más grave y `guard_reasons` lista cada regla que limita; `llm_level` ya más grave que el máximo → `guard_applied = false`.
  - `R19:` con todos los niveles del LLM (1–5) y una muestra de tomas, `suggestedLevel <= llmLevel`. (R18, R19)
- [x] T7 Prueba unitaria + `redaction.ts` y `triage-input.ts` (puras):
  - `R9:` nombre completo, cada palabra de ≥ 3 letras, mayúsculas y tildes ("JOSÉ" = "jose"), conectores `del`/`las`/`los`/`san` y palabras de 1–2 letras intactas, coincidencia solo de palabra completa ("Ana" no toca "anamnesis"), documento con `.`/`-`/espacios, NN sin cambios.
  - `R8:` claves exactas de D7, `age_years` en Bogotá en el día del cumpleaños y el anterior, `estimated_age_years` para NN, signos opcionales `null`, hallazgos en orden.
  - `R10:` búsqueda profunda en la instantánea JSON del nombre, de cada palabra saneable, del documento y de los ids del paciente y de la atención → nada. (R8, R9, R10)
- [x] T8 Prueba unitaria + `triage-response.validator.ts` y `TRIAGE_OUTPUT_SCHEMA` (D9). `R15:` JSON mal formado, campo faltante, campo extra, `level` 0/6/2.5, `explanation` vacía o de 1 001 caracteres, `factors` vacío o con 11 elementos, `field` que no existe o es `null` en la instantánea → inválido. `R16:` una salida correcta con paths `vital_signs.heart_rate`, `symptom_findings[0]` y `chief_complaint_text` → válida. (R15, R16)
- [x] T9 Redactar `ai/prompts/triage-v1.md` (D11) y la prueba unitaria de `triage-prompt.builder.ts`: `promptVersion = 'triage-v1'`, `user` = la instantánea en JSON y nada más del paciente. La definición de los niveles I–V se **transcribe literalmente de la Res. 5596 de 2015 (art. 5)** con la cita. Si no se encuentra el texto oficial, **parar** y documentarlo en `progress/current/F-04-api.md` (no se parafrasea ni se inventa). (R8, R11)
- [x] T10 Prueba unitaria + `llm/llm-client.ts` y `llm/openai-compatible.adapter.ts` con `fetch` interceptado:
  - `R11:` cuerpo exacto (`model`, `temperature: 0`, `messages`, `response_format` json_schema `strict`); `provider: { ignore: ['groq'], require_parameters: true }` **solo** en OpenRouter; cabecera `Authorization` con la clave.
  - `R13:` abortar a los `timeoutMs` → `LlmCallError('TIMEOUT')`; red caída → `NETWORK`; HTTP 429/500 → `HTTP` con `httpStatus`; sin `choices[0].message.content` → `EMPTY`; `model` y `usage` leídos de la respuesta.
  - `R10:` el cuerpo enviado no contiene nombre, documento ni ids.
  - `R27:` los errores no incluyen la clave ni el cuerpo. (R10, R11, R13, R27)
- [x] T11 Prueba unitaria + `triage-advisor.ts` con un `LlmClient` falso y reloj/señales falsos:
  - `R16`/`R18:` Groq OK.
  - `R12:` Groq falla → exactamente una llamada a OpenRouter.
  - `R14:` ambas con `TIMEOUT` → `TIMEOUT`; `TIMEOUT` + `HTTP` → `FAILED`; Groq consume el presupuesto → `BUDGET_EXHAUSTED` sin llamar a OpenRouter → `TIMEOUT`.
  - `R15:` Groq inválido → `INVALID_OUTPUT` sin llamar a OpenRouter.
  - `attempts` con una entrada por llamada, `latency_ms` total y `provider`/`model` según R20. (R12, R13, R14, R15, R16, R18, R20)
- [x] T12 Piezas transversales: `AuditAction` añade `TRIAGE_SUGGESTION_CREATED`; `FORBIDDEN_KEYS` añade `inputsnapshot`, `rawresponse`, `snapshot`, `level`, `llmlevel`, `suggestedlevel`, `explanation`, `factors` y `prompt`, comprobando que `encounterId`, `status` y `guardApplied` siguen permitidas. Prueba unitaria `R25:`/`R27:` de `assertSafeMetadata`. (R25, R27)
- [x] T13 Pruebas de integración + `ClinicalCaptureService.getForSuggestion` (D1) y `TriageSuggestionsService.request` con `POST /encounters/:id/triage-suggestions` (`@StaffRoles('NURSE')`, `UuidParamPipe`), con un `LlmClient` falso inyectado en el `TestingModule`:
  - `R1:` 201 y fila completa, también con `status` `TIMEOUT`/`FAILED`/`INVALID_OUTPUT`.
  - `R2:` 409 en `REGISTERED`, `TRIAGED`, `IN_CARE`, `CLOSED` y `CANCELLED`, sin llamar al cliente falso.
  - `R3:` 409 sin tomas.
  - `R4:` 404 igual para otro tenant, inexistente y mal formado.
  - `R5:` 400 con cuerpo `{ level: 1 }`.
  - `R6:` dos solicitudes → dos filas, la primera intacta.
  - `R20:` cada columna (`created_at` del `FixedClock`, `requested_by` y `tenant_id` del token).
  - `R23:` `encounters` sin cambios (`status`, `updated_at`) y ninguna fila en `triage_decisions` (si la tabla aún no existe, se comprueba solo `encounters`).
  - `R25:` auditoría en la misma transacción.
  - `R26:` `AuditService` que falla → 500 y ninguna fila.
  - `R10:` el cliente falso registra lo que recibe y no contiene nombre, documento ni ids.
  - `R7:` registrar una toma y hallazgos (F-03) no llama al cliente falso ni crea filas en `triage_suggestions`. (R1, R2, R3, R4, R5, R6, R7, R10, R20, R23, R25, R26)
- [x] T14 Pruebas de integración + `GET /encounters/:id/triage-suggestions` (`@StaffRoles('NURSE', 'PHYSICIAN')`):
  - `R21:` orden descendente por `created_at` e `id`, lista vacía, atención `CANCELLED` legible.
  - `R22:` forma exacta; `null` en nivel, explicación y factores cuando `status ≠ OK`; sin `inputSnapshot`, `rawResponse` ni `attempts`.
  - `R4:` 404 entre tenants. (R4, R21, R22)
- [x] T15 Viñetas y `ai:eval`:
  - 20 viñetas `ai/vignettes/V-001…V-020.json` con el formato del README, 4 por nivel, solo sintéticas, `reviewed_by: null` y `"source": "BORRADOR — revisar con asesor clínico"` (PA-F04-6). Actualizar el README si cambian las claves de la instantánea.
  - `src/scripts/ai-eval.ts` (D14) y el script npm `ai:eval` = `npm run -s build && node dist/scripts/ai-eval.js`.
  - Pruebas unitarias con un advisor falso: `R30:` salida por viñeta y resumen; `R31:` código ≠ 0 cuando una viñeta **revisada** de nivel 1–2 subclasifica o queda sin nivel, y 0 si ninguna está revisada (con aviso); `R32:` `npm test`, `test:int` e `init.sh` no invocan el script (comprobación de `package.json` e `init.sh`). (R30, R31, R32)
- [x] T16 Pruebas transversales y documentación:
  - `R28:` matriz de roles en los dos endpoints (`RECEPTION`, `ADMIN` y, en el `POST`, `PHYSICIAN` → 403; paciente → 403; sin token → 401), en e2e y en integración (403 sin filas ni llamadas).
  - `R27:` captura del logger en el flujo completo, buscando el motivo, cada `description`, cada valor de signo y la respuesta cruda del cliente falso (nada aparece).
  - Documentación: docs/data-model.md (sección "F-04-api" con las columnas reales y las diferencias de design.md), docs/architecture.md (módulo `ai`, `ai → audit`, `getForSuggestion`), docs/verification.md (`ai:eval` real) y `ai/vignettes/README.md`. (R27, R28)
- [x] T17 Paso del humano (documentarlo, **no ejecutarlo**): dejar en `progress/current/F-04-api.md` y en `progress/impl_F-04-api.md`:
  - (1) el comando para el responsable de backend, avisando al equipo antes y después: `DIRECT_URL="<URL directa de Supabase, puerto 5432>" npx prisma migrate deploy` (aplica `f04_triage_suggestions` y `f04_app_role_grants`), y la comprobación de grants (`information_schema.role_table_grants`, solo `SELECT` e `INSERT`);
  - (2) añadir `GROQ_MODEL`, `OPENROUTER_MODEL`, `LLM_TIMEOUT_MS` y `LLM_TOTAL_BUDGET_MS` a su `.env`;
  - (3) ejecutar `npm run ai:eval` a mano y `./triage.sh` de la raíz contra la API local. (R24, R29, R30)
- [x] T18 Regenerar el snapshot OpenAPI: `API_CONTRACT_VERSION = '0.5.0'` en `src/app.setup.ts`, esquemas y rutas de "Impacto en contrato" (descripción de "propuesta, nunca decisión"), prueba de contrato (`info.version = 0.5.0` y las dos operaciones), `npm run openapi:export` y comprobar que una segunda ejecución no da diff. El leader fija `contract.version = "0.5.0"` en `feature_list.json`. (R1, R21, R22, R28)
