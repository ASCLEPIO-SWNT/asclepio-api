# F-04-api — Diseño

## Resumen

Se construye la sugerencia de nivel de triage. Enfermería la pide explícitamente sobre una atención en `WAITING_TRIAGE`. La API arma una instantánea **sin datos identificables** a partir de la captura vigente, llama a Groq y, si falla, a OpenRouter. Valida el JSON devuelto, aplica los SafetyGuards (que **solo suben** la gravedad) y guarda **una fila por solicitud** en `triage_suggestions`. La sugerencia nunca toca la atención: el nivel final llega con F-05.

Todo vive en **`modules/ai`**, dueño de `triage_suggestions` (ADR 0001, ADR 0004, `docs/data-model.md`).

| Lugar | Qué aporta |
|---|---|
| `modules/ai/llm/llm-client.ts` | Puerto `LlmClient`: `complete({ system, user, schema, signal }) → { content, model, tokensIn, tokensOut, httpStatus }`, o lanza `LlmCallError { kind: 'TIMEOUT' \| 'NETWORK' \| 'HTTP' \| 'EMPTY', httpStatus? }`. |
| `modules/ai/llm/openai-compatible.adapter.ts` | **Un solo** adaptador sobre `fetch` nativo y la API compatible con OpenAI (`POST {baseUrl}/chat/completions`). `GroqAdapter` y `OpenRouterAdapter` son dos instancias con distinta `baseUrl`, clave, modelo y `extraBody` (D5). |
| `modules/ai/triage-input.ts` | Pura: tipo `TriageInputSnapshot` (D7) y `buildSnapshot(captureForSuggestion, today)` con el saneamiento de D8. |
| `modules/ai/redaction.ts` | Pura: `redact(text, { fullName, documentNumber })` (D8). |
| `modules/ai/triage-prompt.builder.ts` | Lee `ai/prompts/triage-v1.md` al arrancar y devuelve `{ promptVersion, system, user }`. `user` = la instantánea serializada (D11). |
| `modules/ai/triage-response.validator.ts` | Pura: valida el contenido contra `TRIAGE_OUTPUT_SCHEMA` (D9) y comprueba que cada `factors[].field` exista con valor no nulo en la instantánea. |
| `modules/ai/news2.ts` | Pura: `NEWS2_TABLE` y `scoreNews2(vitalSigns)` → `{ total, parameters: { field, points }[] }` (D10). **PROVISIONAL**. |
| `modules/ai/safety-guards.ts` | Pura: `SAFETY_GUARD_RULES` y `applyGuards(llmLevel, news2)` → `{ suggestedLevel, guardApplied, guardReasons }` (D10). **PROVISIONAL**. |
| `modules/ai/triage-advisor.ts` | Orquesta, **sin base de datos**: prompt → Groq → (fallo) OpenRouter → validador → guards. Devuelve el resultado completo con `attempts` (D4). Lo comparten el endpoint y `ai:eval`. |
| `modules/ai/triage-suggestions.service.ts` | Lee la captura (vía `ClinicalCaptureService`), llama al advisor **fuera** de la transacción, inserta la fila y la auditoría en una transacción (D6), y lista. |
| `modules/ai/triage-suggestions.controller.ts` | `POST` (`@StaffRoles('NURSE')`) y `GET` (`@StaffRoles('NURSE', 'PHYSICIAN')`) `/encounters/:id/triage-suggestions`, con `UuidParamPipe`. |
| `modules/ai/dto/triage-suggestion.dto.ts` | DTO de respuesta (R22). El `POST` acepta solo cuerpo vacío o `{}` (R5). |
| `modules/ai/ai.module.ts` | `AiCoreModule` (adaptadores, builder, validator, advisor; sin Prisma) y `AiModule` (core + service + controller), registrado en `AppModule`. |
| `modules/encounters/clinical-capture.service.ts` | **Nuevo método exportado** `getForSuggestion(tenantId, encounterId)` (D1). |
| `modules/audit` | `AuditAction` añade `TRIAGE_SUGGESTION_CREATED`. |
| `common/config/app-config.ts` | `llm: { groq: { apiKey, model }, openRouter: { apiKey, model }, timeoutMs, totalBudgetMs }` y `loadLlmConfig(env)` reutilizable por `ai:eval` (R29). |
| `src/scripts/ai-eval.ts` | `npm run ai:eval` (D14). |
| `ai/prompts/triage-v1.md`, `ai/vignettes/V-001…V-020.json` | Prompt versionado (D11) y viñetas en borrador (PA-F04-6). |

Dependencias entre módulos: `ai → encounters` (solo lectura de la captura), `ai → audit` y `ai → users` (solo lectura: `UsersService.findNames` para `requestedBy.fullName` de R22; añadida en la implementación por decisión del humano, 2026-11-09). `ai` **no** lee `patients` directamente: los datos demográficos y de saneamiento llegan por `encounters` (D1). Se actualiza la tabla de docs/architecture.md para añadir `audit` y `users`.

## Decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| D1 | `ClinicalCaptureService.getForSuggestion(tenantId, encounterId)` devuelve `{ status, chiefComplaintText, complaintSource, latestVitalSigns \| null, symptomFindings, patient: { birthDate, estimatedAgeYears, sex, fullName, documentNumber } }`. `encounters` ya depende de `patients`. El resultado lo usa **solo** `TriageSuggestionsService` para construir la instantánea y sanear, y nunca se serializa ni se guarda tal cual. | `ai` importa `PatientsService`. | La tabla de módulos solo deja a `ai` leer de `encounters`. Un método dedicado deja explícito qué sale de `encounters` y para qué. |
| D2 | **Una fila por solicitud.** Las llamadas a cada proveedor quedan en `attempts jsonb` (`[{ provider, model, outcome: 'OK' \| 'INVALID_OUTPUT' \| 'TIMEOUT' \| 'NETWORK' \| 'HTTP' \| 'EMPTY' \| 'BUDGET_EXHAUSTED', latencyMs, httpStatus }]`). Se interpreta el "intento" de F-04.AC6 como la **solicitud de sugerencia**. | Una fila por llamada a proveedor. | Con una fila por llamada, la sugerencia "vigente" (PA-F04-5) y el conteo de fallback de F-07.AC3 se complican: habría filas `FAILED` de Groq seguidas de un `OK` de OpenRouter en la misma solicitud. `attempts` conserva el detalle de cada llamada. |
| D3 | `POST` **síncrono**: responde cuando el advisor termina (máximo ~20 s). | Trabajo asíncrono con sondeo. | El presupuesto está acotado por R13. Sin cola ni workers (ADR 0001) y la web muestra un estado de carga. |
| D4 | El **único reintento** es el fallback: Groq (≤ 8 s) → si falla, OpenRouter (≤ 8 s, o lo que quede del presupuesto). Una salida inválida **no** pasa al otro proveedor (R15). `TIMEOUT` si todos los fallos fueron `TIMEOUT`/`BUDGET_EXHAUSTED`; si no, `FAILED`. | Reintentar Groq y después OpenRouter (3 llamadas). | Dos llamadas de 8 s caben en 20 s con margen. Con tres no caben, y además el brief pide un único reintento. Con salida estructurada `strict`, una salida inválida suele ser semántica (un factor inexistente) y repetirla en otro proveedor no aporta. |
| D5 | Modelos iniciales `GROQ_MODEL=openai/gpt-oss-120b` y `OPENROUTER_MODEL=openai/gpt-oss-120b` (verificado el 2026-11-09: modelo de **producción** en Groq con `response_format: json_schema` y `strict: true`; OpenRouter lo sirve con varios proveedores). Petición: `{ model, temperature: 0, messages, response_format: { type: 'json_schema', json_schema: { name: 'triage_suggestion', strict: true, schema } } }`. A OpenRouter se le añade `provider: { ignore: ['groq'], require_parameters: true }` para que el respaldo **no** vuelva a caer en Groq y solo use proveedores que respeten el esquema. `fetch` nativo con `AbortSignal.any([AbortSignal.timeout(timeoutMs), budgetSignal])`. | El SDK `openai` de npm, o modelos distintos en cada proveedor. | Los dos proveedores son compatibles con OpenAI y el adaptador cabe en ~60 líneas sin dependencia nueva. El mismo modelo en ambos da un comportamiento comparable en `ai:eval` y en F-07. |
| D6 | La llamada al LLM va **fuera** de la transacción. Orden: (1) `getForSuggestion` y precondiciones (404/409, R2–R4); (2) advisor; (3) transacción: INSERT de la sugerencia + auditoría (R25–R26). Si la atención cambia de estado durante la llamada, la sugerencia se guarda igual y no toca la atención (R23). | Bloquear la atención durante la llamada. | Mantener una transacción abierta hasta 20 s con un servicio externo bloquea a recepción y enfermería. Como la sugerencia nunca modifica la atención, una carrera no rompe ninguna invariante. |
| D7 | Instantánea (claves en `snake_case`, iguales a `ai/vignettes/README.md`):<br>`{ age_years: int \| null, sex: 'M' \| 'F' \| 'X' \| null, chief_complaint_text: string, complaint_source: 'TYPED' \| 'VOICE_ON_DEVICE', vital_signs: { respiratory_rate, spo2, supplemental_oxygen, systolic_bp, diastolic_bp, heart_rate, consciousness, temperature_c, glucose_mg_dl }, symptom_findings: [{ kind, description }] }`.<br>`age_years` = edad cumplida en `America/Bogota` desde `birth_date` a la hora del servidor; si no hay, `estimated_age_years`; si no, `null`. Los signos opcionales ausentes van como `null`. Los hallazgos van en orden de `recorded_at` e `id`. Los paths válidos para `factors[].field` son `age_years`, `sex`, `chief_complaint_text`, `complaint_source`, `vital_signs.<campo>` y `symptom_findings[<n>]`. | Enviar la captura completa o con ids y horas. | La instantánea es el mínimo útil para la clasificación (RNF-04). La edad sustituye a la fecha de nacimiento. Usar las mismas claves que las viñetas permite que `ai:eval` reutilice el mismo flujo. |
| D8 | Saneamiento: se normaliza con NFD sin tildes y en minúsculas. Se reemplaza por `[REDACTADO]`: (a) el nombre completo; (b) cada palabra del nombre de **3 o más letras** que no esté en `{ del, las, los, san }` (las de 1–2 letras como "de" o "la" no se reemplazan), como palabra completa (`\b`); (c) el número de documento como secuencia de dígitos, aunque tenga separadores `.`, `-` o espacio. Si no hay nombre ni documento (NN), el texto no cambia. | Detección general de nombres con NER o con el propio LLM. | Determinista, probable con pruebas y sin dependencias. Riesgo residual (nombres de terceros) aceptado en PA-F04-7. |
| D9 | `TRIAGE_OUTPUT_SCHEMA` (compatible con `strict`, todos los campos `required` y `additionalProperties: false`): `{ level: integer 1–5, explanation: string 1–1000, factors: array 1–10 de { field: string, note: string 1–200 } }`. El validador comprueba además, en código, los rangos y longitudes (no todos los proveedores aplican `minimum`/`maxLength`) y los paths de `field`. `explanation` se guarda como `{ summary, factors }`. | Texto libre con un nivel extraído por regex. | F-04.AC3 exige un esquema JSON. |
| D10 | **NEWS2 (RCP 2017, escala 1 de SpO₂) — PROVISIONAL, no validado clínicamente, revisar con asesor clínico.** Puntos por parámetro:<br>· FR (rpm): ≤8 → 3; 9–11 → 1; 12–20 → 0; 21–24 → 2; ≥25 → 3<br>· SpO₂ (%): ≤91 → 3; 92–93 → 2; 94–95 → 1; ≥96 → 0<br>· O₂ suplementario: sí → 2; no → 0<br>· PAS (mmHg): ≤90 → 3; 91–100 → 2; 101–110 → 1; 111–219 → 0; ≥220 → 3<br>· FC (lpm): ≤40 → 3; 41–50 → 1; 51–90 → 0; 91–110 → 1; 111–130 → 2; ≥131 → 3<br>· Conciencia: A → 0; C/V/P/U → 3<br>· Temperatura (°C): ≤35.0 → 3; 35.1–36.0 → 1; 36.1–38.0 → 0; 38.1–39.0 → 1; ≥39.1 → 2<br>**Reglas (PA-F04-1, aprobadas por el humano el 2026-11-09):** G1 total ≥ 7 → máx. II; G2 total 5–6 → máx. III; G3 algún parámetro = 3 → máx. III. (G4, conciencia P/U → máx. I, se propuso y fue **rechazada**.) `guard_reasons[]` = `{ rule: 'G1', maxLevel: 2, trigger: { news2Total, field?, points? } }`. Las tablas viven en código en **una sola definición** con el comentario PROVISIONAL, la fecha y quién decidió. | Escala 2 de SpO₂ (hipercapnia), o reglas dentro del prompt. | F-03 no captura si el paciente tiene insuficiencia respiratoria hipercápnica, así que se usa la escala 1. Las reglas en el prompt no son deterministas (ADR 0005). |
| D11 | Prompt en `ai/prompts/triage-v1.md` y `prompt_version = 'triage-v1'`. Un archivo publicado no se edita: un cambio crea `triage-v2.md` y pasa por `ai:eval`. Contenido: rol (sugerir, nunca decidir); definición de los niveles I–V **transcrita literalmente de la Res. 5596 de 2015 (art. 5), con la cita**; instrucción de citar solo campos de la entrada en `factors` y de responder solo con el JSON. El `user` es la instantánea en JSON. | Prompt dentro del código. | Versionado auditable (RNF-09). La definición de los niveles es texto normativo, no se inventa: si el implementer no puede transcribirla de la fuente, para y lo documenta (docs/specs.md §5). |
| D12 | Errores con la convención actual (`type: 'about:blank'` y `detail` constante, como `ConflictException(…)` en `encounters.service.ts`): 409 con el `detail` que ya usa F-03 para "la atención no está en espera de triage" (R2) y 409 con un `detail` constante nuevo, "la atención no tiene signos vitales registrados" (R3). Los fallos del LLM **no** son errores HTTP: se responde 201 con `status ≠ OK` (R1). | 502/504 cuando falla el LLM. | El fallo del proveedor es un resultado de negocio (modo manual) que debe quedar registrado y visible, no un error de transporte. |
| D13 | **Sin `encounter_event`** por sugerencia; solo `audit_log` (R25). | Evento `TRIAGE_SUGGESTED` en la línea de tiempo. | `ai` solo lee de `encounters` (no escribe en sus tablas). La línea de tiempo recibirá la decisión en F-05, que es el acto clínico. Las sugerencias se consultan en su propio `GET`. |
| D14 | `npm run ai:eval` = `npm run -s build && node dist/scripts/ai-eval.js`. Crea un contexto con `AiCoreModule` (sin Prisma) y `loadLlmConfig`. Por cada viñeta, `buildSnapshot` se sustituye por su `input` y el resto es el mismo `TriageAdvisor`. Sale con código ≠ 0 según R31. | Llamar al endpoint HTTP con una base sembrada. | Es el mismo flujo de R8–R18 sin base ni escritura, y no necesita F-09. |

## Impacto en contrato

Versión: **0.4.0 → 0.5.0** (menor: dos operaciones nuevas, sin cambios incompatibles).

- `POST /api/v1/encounters/{id}/triage-suggestions` — `NURSE`. Cuerpo: ninguno o `{}` (`additionalProperties: false`).
  - **201** `TriageSuggestionDto`, incluso con `status` `INVALID_OUTPUT`, `TIMEOUT` o `FAILED`.
  - **400** cuerpo con campos · **401** · **403** · **404** atención inexistente, de otro tenant o id mal formado · **409** atención fuera de `WAITING_TRIAGE` · **409** atención sin signos vitales · **500**.
- `GET /api/v1/encounters/{id}/triage-suggestions` — `NURSE`, `PHYSICIAN`.
  - **200** `{ items: TriageSuggestionDto[] }`, de la más reciente a la más antigua (puede estar vacío).
  - **401** · **403** · **404**.
- `TriageSuggestionDto`: `id` (uuid), `encounterId` (uuid), `status` (`TriageSuggestionStatus`: `OK` | `INVALID_OUTPUT` | `TIMEOUT` | `FAILED`), `suggestedLevel` (int 1–5 \| null), `llmLevel` (int 1–5 \| null), `explanation` (string \| null), `factors` (`{ field: string, note: string }[]` \| null), `guardApplied` (bool), `guardReasons` (`{ rule: string, maxLevel: int, trigger: { news2Total: int, field?: string, points?: int } }[]`), `provider` (`GROQ` | `OPENROUTER` \| null), `model` (string \| null), `promptVersion` (string), `latencyMs` (int), `createdAt` (date-time), `requestedBy` (`{ id, fullName }`).
- La descripción de las operaciones dice que la sugerencia **es una propuesta, nunca una decisión**, y que `suggestedLevel` puede ser más grave que `llmLevel` por un guard.
- Clientes: F-04-web consumirá 0.5.0 (`npm run api:types`). Mobile no la consume.

## Impacto en datos

**Sí, dos migraciones** creadas con `--create-only` contra el Docker local (ADR 0003). En Supabase solo el humano ejecuta `migrate deploy`.

1. `f04_triage_suggestions`:
   - enum `triage_suggestion_status` (`OK`, `INVALID_OUTPUT`, `TIMEOUT`, `FAILED`) y enum `llm_provider` (`GROQ`, `OPENROUTER`).
   - tabla `triage_suggestions`: `id uuid PK`, `tenant_id uuid NOT NULL`, `encounter_id uuid NOT NULL`, `requested_by uuid NOT NULL → users`, `input_snapshot jsonb NOT NULL`, `status triage_suggestion_status NOT NULL`, `llm_level smallint NULL`, `suggested_level smallint NULL`, `explanation jsonb NULL`, `guard_applied boolean NOT NULL DEFAULT false`, `guard_reasons jsonb NOT NULL DEFAULT '[]'`, `provider llm_provider NULL`, `model text NULL`, `prompt_version text NOT NULL`, `raw_response text NULL`, `tokens_in int NULL`, `tokens_out int NULL`, `latency_ms int NOT NULL`, `attempts jsonb NOT NULL`, `created_at timestamptz NOT NULL` (asignado por la API).
   - FKs **`ON DELETE RESTRICT ON UPDATE RESTRICT`**: `(encounter_id, tenant_id) → encounters(id, tenant_id)`, `tenant_id → tenants`, `requested_by → users`.
   - Índice `(encounter_id, created_at DESC, id DESC)`.
   - CHECK (SQL manual al final): `(status = 'OK') = (llm_level IS NOT NULL AND suggested_level IS NOT NULL AND explanation IS NOT NULL)`; `llm_level BETWEEN 1 AND 5`; `suggested_level BETWEEN 1 AND 5`; **`suggested_level <= llm_level`** (R19); `guard_applied = (suggested_level < llm_level)` cuando `status = 'OK'`; `latency_ms >= 0`.
2. `f04_app_role_grants`: `GRANT SELECT, INSERT ON asclepio.triage_suggestions TO asclepio_app;` sin `UPDATE`, `DELETE` ni `TRUNCATE` (R24).

**Diferencias con `docs/data-model.md` (se actualiza en T16):** se añaden `tenant_id`, `requested_by`, `llm_level` y `attempts`. `raw_response` pasa de `jsonb` a **`text`**, porque una salida `INVALID_OUTPUT` puede no ser JSON y debe guardarse tal cual. `provider` pasa a enum.

Inmutabilidad: `triage_suggestions` es solo de inserción (como `vital_signs`). Tiempo: `created_at` con la hora del servidor (RNF-10). Privacidad: `input_snapshot` sin nombre ni documento (RNF-04). `raw_response` puede contener texto libre clínico ya saneado y nunca se expone por la API (R22) ni se registra en logs (R27).

## Riesgos y pruebas

**Riesgos:**
- (1) Las reglas y la tabla NEWS2 son **PROVISIONALES**. La correspondencia NEWS2 → nivel (G1–G3) es una decisión de producto del humano, pendiente de validar con un asesor clínico (PA-F04-1).
- (2) Las viñetas son borradores hasta que alguien las revise (PA-F04-6). Mientras tanto el umbral de R31 no es vinculante.
- (3) Coste y latencia: cada clic en "Sugerir" consume tokens y no hay límite por usuario en el MVP. Se medirá con `tokens_in`/`tokens_out`.
- (4) El saneamiento no detecta nombres de terceros.
- (5) En `gpt-oss-120b` la latencia depende del razonamiento interno, y con 8 s podría haber `TIMEOUT` frecuentes. `ai:eval` lo medirá. Si pasa, el humano decide si sube el timeout, no se ajusta por debajo.
- (6) Una salida `OK` sin guards puede subclasificar. Los guards solo cubren lo fisiológico, no el motivo de consulta. Es otra razón por la que la decisión es siempre humana (F-05).

**Pruebas unitarias (sin LLM real, sin red):**
- `news2.ts`: cada límite de cada banda.
- `safety-guards.ts`: G1–G3 con valores en el límite y justo fuera; un guard nunca baja el nivel; varias reglas a la vez, donde gana la más grave. Son pruebas sin mocks del LLM (ADR 0005).
- `redaction.ts`: nombre completo, palabras sueltas, tildes y mayúsculas, palabras de 1–2 letras intactas, documento con separadores, NN.
- `triage-input.ts`: claves exactas de D7, edad en Bogotá, signos opcionales en `null` y búsqueda profunda de nombre, documento e ids que debe dar vacío (R8–R10).
- `triage-response.validator.ts`: esquema, rangos y factor inexistente o nulo → inválido.
- `triage-advisor.ts` con un `LlmClient` falso: Groq OK; Groq falla → OpenRouter OK; los dos fallan por timeout → `TIMEOUT`; mezcla → `FAILED`; inválido sin fallback; presupuesto agotado (con relojes y `AbortSignal` falsos).
- El adaptador con `fetch` interceptado: cuerpo exacto (temperature 0, `response_format`, `provider.ignore` solo en OpenRouter), timeout real con `AbortSignal` y que el cuerpo enviado no contenga nombre, documento ni ids (R10).
- `loadLlmConfig` (R29).

**Pruebas e2e sin base:** 401/403 y matriz de roles (R28); 400 por cuerpo con campos (R5).

**Pruebas de integración (Docker, `LlmClient` falso inyectado):**
- R1, R6 (varias filas) y R2 en cada estado ≠ `WAITING_TRIAGE`; R3 sin tomas; R4 (404 igual en los tres casos).
- R20 (todas las columnas), R21 (orden) y R22 (sin `input_snapshot`, `raw_response` ni `attempts` en la respuesta).
- R23: `encounters` intacta y sin `triage_decisions`.
- R24: `UPDATE`/`DELETE` → `42501`; FKs RESTRICT; los CHECK, incluido `suggested_level > llm_level` → error.
- R25, R26 (`AuditService` que falla → sin fila) y R27 (logger capturado más metadata).

**Manual:** `npm run ai:eval` con las claves reales (lo ejecuta el humano, nunca CI ni `init.sh`) y el `triage.sh` de la raíz contra la API local.
