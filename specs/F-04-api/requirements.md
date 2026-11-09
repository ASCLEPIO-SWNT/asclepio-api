# F-04-api — Sugerencia de triage por LLM, SafetyGuards y fallback manual

Brief global: docs/product/features/F-04.md (F-04.AC1–AC7 y AC9; el AC8 es de F-04-web)
Contrato: produce 0.5.0 (menor: endpoints nuevos; parte de 0.4.0)
RNF aplicables: RNF-01, RNF-03, RNF-04, RNF-05, RNF-07, RNF-08, RNF-09, RNF-10, RNF-11, RNF-12, RNF-14, RNF-16, RNF-18
Depende de: F-03-api (captura clínica, `ClinicalCaptureService` exportado).
Decisiones humanas de partida: PA-F04-2..5 y PA-F04-7 (humano, 2026-11-09, por chat: "aprobado"); PA-F04-1 (G1–G3, sin G4) y PA-F04-6 (viñetas en borrador) cerradas el mismo día.

Glosario de la spec:

- **Hora del servidor**: el valor de `Clock.now()` (RNF-10).
- **Solicitud de sugerencia**: una petición aceptada a `POST /api/v1/encounters/{id}/triage-suggestions`. Cada solicitud produce **exactamente una fila** de `triage_suggestions` (design.md D2).
- **Llamada**: una petición HTTP a un proveedor LLM. Una solicitud hace como máximo **dos llamadas**: primero Groq y, si falla, OpenRouter como **único reintento** (design.md D4).
- **Proveedores y modelos** (PA-F04-2): Groq con el modelo de `GROQ_MODEL` y OpenRouter con el de `OPENROUTER_MODEL`. Ambos se fijan en la configuración, y el valor inicial es `openai/gpt-oss-120b` en los dos (design.md D5).
- **Timeout por llamada** (PA-F04-3): 8 000 ms (`LLM_TIMEOUT_MS`). **Presupuesto total**: 20 000 ms (`LLM_TOTAL_BUDGET_MS`) desde el inicio de la primera llamada hasta el fin de la última.
- **Fallo de llamada**: timeout, error de red, respuesta HTTP distinta de 2xx o cuerpo HTTP que no trae un mensaje del asistente.
- **Captura vigente**: la última toma de `vital_signs` de la atención (mayor `recorded_at` y después mayor `id`), todos sus `symptom_findings` y el motivo de consulta original.
- **Instantánea de entrada** (`input_snapshot`): el objeto JSON que se envía al LLM y se guarda. Sus campos son los de design.md D7 y nunca incluye nombre, documento ni identificadores (RNF-04).
- **Texto saneado** (PA-F04-7): texto libre (motivo y `description` de los hallazgos) en el que se reemplaza por `[REDACTADO]` cada aparición del nombre completo del paciente, de cada palabra de su nombre (según la regla de design.md D8) y de su número de documento, sin distinguir mayúsculas ni tildes.
- **Salida válida del LLM**: un JSON que cumple el esquema de design.md D9 (`level` entero 1–5, `explanation` de 1 a 1 000 caracteres y `factors` con 1 a 10 elementos `{ field, note }`) y cuyos `factors[].field` existen todos en la instantánea con un valor distinto de `null`.
- **Nivel del LLM** (`llm_level`): el `level` de una salida válida. **Nivel sugerido** (`suggested_level`): el nivel del LLM después de aplicar los SafetyGuards.
- **SafetyGuards** (PA-F04-1, **PROVISIONALES — no validados clínicamente, revisar con asesor clínico**): las reglas de design.md D10, que se calculan sobre la puntuación NEWS2 (RCP 2017, escala 1 de SpO₂) de la toma vigente. Cada regla fija un **nivel máximo permitido**, y un nivel más grave es un número menor.
- **Estados de la sugerencia**: `OK`, `INVALID_OUTPUT`, `TIMEOUT` y `FAILED`.
- **Rol que solicita**: `NURSE`. **Roles de lectura**: `NURSE` y `PHYSICIAN`.
- **Respuesta de error**: `application/problem+json` (RFC 9457) sin repetir valores clínicos ni datos personales en `detail` ni en `errors[].message`.

## Requisitos

### Solicitud y precondiciones

- **R1** (Por evento) Cuando se reciba `POST /api/v1/encounters/{id}/triage-suggestions` sin cuerpo (o con `{}`), con un token de `NURSE` y una atención del tenant del token en `WAITING_TRIAGE` con al menos una toma de `vital_signs`, el sistema deberá construir la instantánea de entrada a partir de la captura vigente, obtener la sugerencia (R8–R17), insertar una fila en `triage_suggestions` y responder 201 con la sugerencia en la forma de R22, sea cual sea su estado. (→ F-04.AC1, F-04.AC4)
- **R2** (No deseado) Si la atención está en un estado distinto de `WAITING_TRIAGE`, entonces el sistema deberá responder 409 con la respuesta de error, sin llamar a ningún proveedor ni insertar ninguna fila. (→ F-04.AC1) (decidido en PA-F04-5)
- **R3** (No deseado) Si la atención no tiene ninguna toma de `vital_signs`, entonces el sistema deberá responder 409 con la respuesta de error y un `detail` constante distinto del de R2, sin llamar a ningún proveedor ni insertar ninguna fila. (→ F-04.AC1)
- **R4** (No deseado) Si el id de la atención no existe, es de otro tenant o está mal formado, entonces el sistema deberá responder 404 con la misma respuesta de error en los tres casos, tanto en el `POST` como en el `GET` de R21, sin llamar a ningún proveedor. (→ F-04.AC1)
- **R5** (No deseado) Si el cuerpo del `POST` incluye cualquier campo (por ejemplo `level`, `provider`, `model`, `createdAt` o `inputSnapshot`), entonces el sistema deberá responder 400 con la respuesta de error, sin llamar a ningún proveedor ni insertar ninguna fila. (→ F-04.AC1)
- **R6** (Por evento) Cuando una atención en `WAITING_TRIAGE` ya tenga sugerencias, el sistema deberá aceptar una nueva solicitud según R1 e insertar una fila nueva, sin modificar ni borrar las anteriores. (→ F-04.AC6) (decidido en PA-F04-5)
- **R7** (Ubicuo) El sistema deberá obtener una sugerencia solo cuando la pida explícitamente un `POST` de R1, y no al registrar signos vitales ni hallazgos ni en ningún otro evento. (→ F-04.AC1) (decidido en PA-F04-4)

### Instantánea y privacidad del payload

- **R8** (Ubicuo) El sistema deberá construir la instantánea de entrada exactamente con los campos de design.md D7: edad en años, sexo, motivo saneado, `complaint_source`, la toma vigente y los hallazgos con su texto saneado. No deberá incluir nombre, documento, ids de la base, fechas de nacimiento ni horas. (→ F-04.AC2) (RNF-04)
- **R9** (Ubicuo) El sistema deberá sanear el motivo de consulta y cada `description` de los hallazgos según la definición de texto saneado antes de incluirlos en la instantánea. Una atención NN (sin nombre ni documento) se envía sin reemplazos. (→ F-04.AC2) (decidido en PA-F04-7)
- **R10** (Ubicuo) El sistema deberá enviar al proveedor un payload cuyo único contenido derivado del paciente sea la instantánea de entrada, de modo que una prueba automática que intercepta el cuerpo HTTP enviado no encuentre el nombre completo, ninguna palabra saneable del nombre, el número de documento ni el id del paciente o de la atención. (→ F-04.AC2) (RNF-04)

### Llamadas al LLM, reintento y fallback

- **R11** (Ubicuo) El sistema deberá hacer cada llamada con `temperature = 0`, el modelo configurado del proveedor, el prompt versionado vigente y la petición de salida JSON según el esquema de design.md D9, a través de la API compatible con OpenAI del proveedor. (→ F-04.AC4) (RNF-09)
- **R12** (Por evento) Cuando la llamada a Groq termine en fallo de llamada, el sistema deberá hacer una única llamada a OpenRouter con la misma instantánea y el mismo prompt, y ninguna otra. (→ F-04.AC4) (RNF-08)
- **R13** (No deseado) Si una llamada no termina en 8 000 ms, entonces el sistema deberá abortarla y tratarla como fallo de llamada por timeout. Si se agota el presupuesto total de 20 000 ms, entonces deberá abortar la llamada en curso y no iniciar ninguna más. (→ F-04.AC4) (decidido en PA-F04-3; RNF-07)
- **R14** (No deseado) Si las dos llamadas terminan en fallo de llamada, o la de Groq falla y no queda presupuesto para OpenRouter, entonces el sistema deberá guardar la sugerencia con `status = TIMEOUT` cuando todos los fallos fueron por timeout o por agotar el presupuesto, o `status = FAILED` en cualquier otro caso, sin nivel, explicación ni factores. (→ F-04.AC4)
- **R15** (No deseado) Si un proveedor responde pero su contenido no es una salida válida del LLM (JSON mal formado, esquema incumplido o algún `factors[].field` que no existe o es `null` en la instantánea), entonces el sistema deberá guardar la sugerencia con `status = INVALID_OUTPUT`, `suggested_level`, `llm_level`, `explanation` y factores en `null`, y la respuesta cruda. No deberá llamar al otro proveedor por este motivo. (→ F-04.AC3)
- **R16** (Por evento) Cuando un proveedor devuelva una salida válida del LLM, el sistema deberá guardar la sugerencia con `status = OK`, `llm_level` igual al `level` recibido, la explicación y los factores, y el nivel sugerido que resulte de R18. (→ F-04.AC1, F-04.AC3)

### SafetyGuards

- **R17** (Ubicuo) El sistema deberá calcular la puntuación NEWS2 (RCP 2017, escala 1 de SpO₂) y la puntuación de cada parámetro a partir de la toma vigente, con la tabla de design.md D10. Es una función pura, sin acceso al LLM ni a la base. (→ F-04.AC5)
- **R18** (Por evento) Cuando la sugerencia tenga `status = OK`, el sistema deberá evaluar cada regla de los SafetyGuards y fijar `suggested_level = min(llm_level, nivel máximo de cada regla que se cumpla)`. Si ese valor es menor que `llm_level`, deberá guardar `guard_applied = true` y en `guard_reasons` un elemento por cada regla cumplida que limite el nivel, con `{ rule, maxLevel, trigger }`, donde `trigger` lleva la puntuación NEWS2 total y el parámetro que la disparó. Si no, deberá guardar `guard_applied = false` y `guard_reasons = []`. (→ F-04.AC5)
- **R19** (Ubicuo) El sistema deberá garantizar que `suggested_level` nunca sea mayor (menos grave) que `llm_level`, tanto en el código como con un CHECK en la base. (→ F-04.AC5) (ADR 0005)

### Persistencia, efectos y lectura

- **R20** (Ubicuo) El sistema deberá guardar en cada fila de `triage_suggestions`: `tenant_id` y `requested_by` del token; `encounter_id`; `input_snapshot`; `status`; `llm_level`; `suggested_level`; `explanation` (con los factores); `guard_applied`; `guard_reasons`; el `provider` y el `model` de la última llamada que respondió o, si ninguna respondió, de la última intentada (`model` = el que informa la respuesta del proveedor; si no lo informa, el configurado); `prompt_version`; `raw_response`; `tokens_in` y `tokens_out` cuando el proveedor los informe; `latency_ms` total; `attempts` con una entrada por llamada (`provider`, `model`, `outcome`, `latencyMs`, `httpStatus`); y `created_at` = hora del servidor. (→ F-04.AC6) (RNF-09)
- **R21** (Por evento) Cuando se reciba `GET /api/v1/encounters/{id}/triage-suggestions` con un token de un rol de lectura y una atención del tenant del token (en cualquier estado), el sistema deberá responder 200 con `{ items }` en la forma de R22, ordenados por `created_at` y después por `id` descendentes, de modo que `items[0]` sea la sugerencia vigente. (→ F-04.AC6) (decidido en PA-F04-5)
- **R22** (Ubicuo) El sistema deberá representar cada sugerencia con `id`, `encounterId`, `status`, `suggestedLevel`, `llmLevel`, `explanation`, `factors`, `guardApplied`, `guardReasons`, `provider`, `model`, `promptVersion`, `latencyMs`, `createdAt` y `requestedBy` `{ id, fullName }`. `suggestedLevel`, `llmLevel`, `explanation` y `factors` deberán ser `null` cuando `status ≠ OK`. No deberá exponer `input_snapshot`, `raw_response` ni `attempts`. (→ F-04.AC1, F-04.AC3, F-04.AC4)
- **R23** (Ubicuo) El sistema deberá registrar cada solicitud sin modificar `encounters` (ni `status`, ni `final_level`, ni `triaged_at`, ni `triaged_by`), sin insertar `triage_decisions` y sin modificar ni borrar ninguna fila existente de `triage_suggestions`. (→ F-04.AC7) (RNF-03)
- **R24** (Ubicuo) El sistema deberá conectarse con el rol `asclepio_app`, que sobre `triage_suggestions` solo tiene `SELECT` e `INSERT`, de modo que un `UPDATE` o un `DELETE` con ese rol falle con `42501`. Toda FK desde `triage_suggestions` deberá ser `ON DELETE RESTRICT ON UPDATE RESTRICT`. (→ F-04.AC6, F-04.AC7)
- **R25** (Por evento) Cuando se inserte una sugerencia, el sistema deberá insertar en la misma transacción una fila de `audit_log` con `action = TRIAGE_SUGGESTION_CREATED`, `actor_type = STAFF`, `actor_id`, `tenant_id`, `entity = triage_suggestions`, `entity_id` y `metadata = { encounterId, status, guardApplied }`, sin niveles ni valores clínicos. (→ F-04.AC6) (RNF-01)
- **R26** (No deseado) Si falla la inserción de la sugerencia o de su auditoría, entonces el sistema deberá revertir ambas y responder 500 con la respuesta de error. (→ F-04.AC6)
- **R27** (Ubicuo) El sistema deberá excluir de los logs, de `audit_log.metadata` y de los mensajes de error la instantánea, el motivo, las descripciones de hallazgos, los valores de signos vitales, la respuesta cruda del LLM, las claves de API y los datos personales del paciente. (→ F-04.AC2) (RNF-05, RNF-18)

### Autorización y errores

- **R28** (No deseado) Si un token de personal con rol distinto de `NURSE` llega al `POST`, un token con rol distinto de `NURSE` o `PHYSICIAN` llega al `GET`, o un token de paciente llega a cualquiera de los dos, entonces el sistema deberá responder 403 con la respuesta de error, sin llamar a ningún proveedor ni insertar ninguna fila. Sin token válido deberá responder 401. (→ F-04.AC1)
- **R29** (No deseado) Si al arrancar la API falta `GROQ_API_KEY`, `GROQ_MODEL`, `OPENROUTER_API_KEY` u `OPENROUTER_MODEL`, o `LLM_TIMEOUT_MS` / `LLM_TOTAL_BUDGET_MS` no son enteros positivos con timeout ≤ presupuesto, entonces el sistema deberá negarse a arrancar con un mensaje que nombre la variable, sin mostrar su valor. Si `LLM_TIMEOUT_MS` y `LLM_TOTAL_BUDGET_MS` faltan, deberá usar 8 000 y 20 000. (→ F-04.AC4) (RNF-18)

### Evaluación con viñetas

- **R30** (Por evento) Cuando se ejecute `npm run ai:eval`, el sistema deberá leer `ai/vignettes/*.json` con el formato de `ai/vignettes/README.md`, obtener para cada viñeta una sugerencia con el mismo flujo de R8–R18 (sin base de datos ni escritura), e imprimir por viñeta el nivel obtenido, si acertó (`level ∈ acceptable_levels`), si subclasificó (`level` > máximo de `acceptable_levels`), si se aplicó algún guard, el proveedor, el modelo, `prompt_version`, la latencia y si la viñeta está revisada (`reviewed_by ≠ null`). Al final deberá imprimir el porcentaje de acierto y de subclasificación. (→ F-04.AC9)
- **R31** (No deseado) Si en `ai:eval` alguna viñeta **revisada** con nivel esperado 1 o 2 resulta subclasificada o sin nivel (`status ≠ OK`), entonces el comando deberá terminar con código de salida distinto de 0. (→ F-04.AC9) (decidido en PA-F04-6)
- **R32** (Ubicuo) El sistema deberá ejecutar `ai:eval` solo de forma explícita: ni `npm test`, ni `npm run test:int`, ni `init.sh` deberán llamar a un LLM real. (→ F-04.AC9)

> Trazabilidad por criterio: AC1 → R1–R7, R16, R22, R28 · AC2 → R8–R10, R27 · AC3 → R15, R16, R22 · AC4 → R1, R11–R14, R22, R29 · AC5 → R17–R19 · AC6 → R6, R20–R21, R24–R26 · AC7 → R23, R24 · AC9 → R30–R32.
> Requisitos que dependen de valores clínicos provisionales (su estructura no cambia si el asesor ajusta las tablas): R17 y R18 (PA-F04-1); R31 (PA-F04-6).

## Preguntas abiertas

- [x] **PA-F04-1** Reglas y umbrales de los SafetyGuards. → Humano, 2026-11-09, por chat: NEWS2 (Royal College of Physicians, *National Early Warning Score (NEWS) 2*, Londres: RCP, 2017; escala 1 de SpO₂) como base, **PROVISIONAL — no validada clínicamente, revisar con asesor clínico**. NEWS2 no define niveles I–V, así que la correspondencia es una decisión de producto del humano: **G1** puntuación total ≥ 7 → nivel máximo **II**; **G2** total 5–6 → nivel máximo **III**; **G3** algún parámetro con 3 puntos → nivel máximo **III**. Se propuso **G4** (conciencia `P` o `U` → nivel máximo I) y fue **rechazada**: no se implementa. Cubierto por R17 y R18 (tabla D10 de design.md).
- [x] **PA-F04-2** Modelo y versión. → Humano, 2026-11-09: un modelo fijado por proveedor y elegido tras verificar el catálogo del día. Groq `openai/gpt-oss-120b` (modelo de producción con salida estructurada `strict`) y OpenRouter `openai/gpt-oss-120b`, enrutado a un proveedor distinto de Groq (design.md D5). Cubierto por R11, R20 y R29.
- [x] **PA-F04-3** Timeout y presupuesto. → Humano, 2026-11-09: 8 s por llamada, un reintento (OpenRouter) y 20 s en total; si se pasa, `TIMEOUT` y modo manual. Cubierto por R12–R14 y R29.
- [x] **PA-F04-4** ¿Automática o con botón? → Humano, 2026-11-09: con un botón explícito después de guardar los signos vitales. En la API es un `POST` explícito sin disparo automático. Cubierto por R1 y R7.
- [x] **PA-F04-5** ¿Re-sugerencia? → Humano, 2026-11-09: sí, mientras la atención esté en `WAITING_TRIAGE`. Se muestra la más reciente y se guarda el historial. Cubierto por R2, R6 y R21.
- [x] **PA-F04-6** Viñetas y umbral. → Humano, 2026-11-09, por chat: 20 viñetas sintéticas que cubran I–V (4 por nivel), y un cambio de prompt o modelo solo se acepta si no subclasifica ningún caso I o II (R31). El `implementer` deja las 20 como **borrador** (`reviewed_by: null`, `"source": "BORRADOR — revisar con asesor clínico"`) y el equipo las revisa. Mientras ninguna esté revisada, R31 no hace fallar el comando y `ai:eval` avisa de que el umbral aún no es vinculante. Cubierto por R30–R32 y T15.
- [x] **PA-F04-7** ¿Saneamiento del texto? → Humano, 2026-11-09: sí. Se quitan el nombre y el documento conocidos del paciente antes de enviar, y el payload no lleva ningún dato identificable. Riesgo residual aceptado: nombres de terceros (familiares) escritos en el texto libre no se detectan. Cubierto por R8–R10.
