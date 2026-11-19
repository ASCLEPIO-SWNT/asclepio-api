# Implementación — F-11-api (entrevista de síntomas)

- **Rama:** `feature/F-11-api` (desde `develop`), sin push. Commits `c7f6830`…`4211203` (uno por tarea, T1–T11).
- **Contrato:** `info.version` **0.11.0** (`API_CONTRACT_VERSION`, snapshot regenerado; `npm run openapi:export` no deja diff). `feature_list.json` ya tenía `contract.version = "0.11.0"`; estado sigue `in_progress`.
- **Migración (una):** `prisma/migrations/20261119022808_f11_symptom_interview/` creada con `prisma migrate dev --create-only` contra el Docker local (127.0.0.1:54329, URLs explícitas; ni `.env` ni Supabase). Solo `ADD COLUMN` + CHECK; sin grants nuevos (f02 ya da `SELECT, INSERT, UPDATE` a nivel de tabla). Aplicada **solo** en el Docker local por `scripts/test-int.sh` (`migrate deploy` local); `prisma migrate diff --from-config-datasource --to-schema` contra el Docker → "No difference detected". **El `migrate deploy` en Supabase lo ejecuta el humano.**
- **Fixture compartido:** `test/fixtures/red-flag-cases.json`, 47 casos (cada `RedFlag` ≥ 2 positivos, sutiles, 2 multi-señal y 10 negativos). **SHA-256 `343dd9c6231acaf3bee3122b49fdc974174c5899be42c0c8c7684ddd7b7f22cd`** (fijado en `interview.rules.spec.ts`; F-11-mobile debe copiar el archivo literalmente y fijar el mismo hash). No se escribió nada en `../asclepio-mobile`.
- **T10:** código y datos hechos; **`npm run ai:eval` NO se ejecutó** (llama al LLM real) → **ejecución manual pendiente por el humano**.

## Archivos tocados

**Nuevos**
- `prisma/migrations/20261119022808_f11_symptom_interview/migration.sql`
- `src/modules/interview/`: `interview.rules.ts` (+spec), `interview-advisor.ts`, `interview.service.ts`, `interview.controller.ts`, `interview.module.ts` (`InterviewCoreModule` + `InterviewModule`), `interview-eval.ts` (+spec), `dto/interview.dto.ts`, `README.md`
- `src/common/throttle/patient-throttled.decorator.ts`
- `src/modules/encounters/dto/pre-registration-interview.dto.spec.ts`, `src/modules/queue/queue.rules.f11.spec.ts`, `src/modules/ai/triage-input.v2.spec.ts`
- `ai/prompts/triage-v2.md`, `ai/prompts/interview-v1.md`, `ai/vignettes/interview/IV-001…IV-014.json` + `README.md`
- `test/fixtures/red-flag-cases.json`, `test/f11-pre-registrations.int-spec.ts`, `test/f11-staff-views.int-spec.ts`, `test/f11-queue.int-spec.ts`, `test/f11-triage-input.int-spec.ts`, `test/f11-next-question.e2e-spec.ts`, `test/f11-access.e2e-spec.ts`

**Modificados**
- `prisma/schema.prisma`; `src/app.module.ts`; `src/app.setup.ts` (0.11.0); `src/common/throttle/throttled.decorator.ts` (descripción parametrizable del 429)
- `src/modules/encounters/`: `dto/encounters.dto.ts`, `pre-registrations.service.ts`, `encounters.service.ts`, `clinical-capture.service.ts`, `capture-for-suggestion.ts`
- `src/modules/queue/`: `queue.rules.ts`, `dto/queue.dto.ts`; `src/modules/ai/`: `triage-input.ts`, `triage-prompt.builder.ts`, `triage-response.validator.ts`, `vignette-eval.ts`, `ai.module.ts` (exporta `ADVISOR_BUDGET`); `src/scripts/ai-eval.ts`
- Pruebas existentes adaptadas a campos aditivos o a `triage-v2`: `queue.rules.spec.ts`, `queue.rules.dt02.spec.ts`, `estimate.rules.spec.ts`, `triage-input.spec.ts`, `triage-prompt.builder.spec.ts`, `triage-advisor.spec.ts`, `triage-response.validator.spec.ts`, `vignette-eval.spec.ts`, `openai-compatible.adapter.spec.ts` (ahora también con entrevista con PII), `test/f02-encounters.int-spec.ts`, `test/f02-pre-registrations.int-spec.ts`, `test/f04-triage-suggestions*.int-spec.ts`, `test/f06-queue*.int-spec.ts`, `test/f10-stream.e2e-spec.ts`, `test/contract.e2e-spec.ts`
- Docs: `docs/data-model.md`, `docs/architecture.md`, `docs/verification.md`, `ai/vignettes/README.md`; `specs/F-11-api/tasks.md` (T1–T11 `[x]`)

## Trazabilidad R<n> → prueba

| R | Archivo :: prueba |
|---|---|
| R1 | `test/f11-pre-registrations.int-spec.ts` :: `R1: guarda la entrevista en symptom_interview y sus redFlags en red_flags`; `R1: la respuesta del paciente no cambia…` · `pre-registration-interview.dto.spec.ts` :: `R1: una entrevista bien formada pasa…` · `contract.e2e-spec.ts` :: `R1: CreatePreRegistrationDto añade interview opcional…` |
| R2 | `pre-registration-interview.dto.spec.ts` :: `R2: %s → 400 con el campo, sin repetir el valor enviado` (20 casos) · `f11-pre-registrations.int-spec.ts` :: `R2: una entrevista mal formada → 400 problem+json, sin crear el pre-registro ni repetir los valores` |
| R3 | `pre-registration-interview.dto.spec.ts` :: `R3: sin interview el cuerpo de 0.10.0 sigue siendo válido` · `f11-pre-registrations.int-spec.ts` :: `R3: sin interview se crea como en 0.10.0…` |
| R4 | `interview.rules.spec.ts` :: `R4: detectRedFlags(%j) → %j` (47 casos del fixture), `R4: el hash SHA-256…`, `R4: cada RedFlag tiene al menos dos casos…` · `f11-pre-registrations.int-spec.ts` :: `R4: el cliente envía [] y una respuesta "me desmayé" → … LOSS_OF_CONSCIOUSNESS`, `R4: el motivo también se revisa y nunca se quitan las señales del cliente`, `R4: sin interview, un motivo con señal…` |
| R5 | `f11-pre-registrations.int-spec.ts` :: `R5: al confirmar, la atención recibe symptom_interview y red_flags en la misma transacción…`, `R5: sin entrevista, la atención confirmada y la directa quedan con NULL…` |
| R6 | `f11-staff-views.int-spec.ts` :: `R6: cada elemento de la bandeja lleva symptomInterview…`, `R6: GET /encounters/{id} lleva symptomInterview y redFlags…` · `contract.e2e-spec.ts` :: `R6, R8: EncounterDto y PendingPreRegistrationDto…` |
| R7 | `f11-staff-views.int-spec.ts` :: `R7: la bandeja pone primero los pre-registros con redFlags…` |
| R8 | `queue.rules.f11.spec.ts` :: 4 pruebas `R8: …` (orden, `hasRedFlags`, triaged/inCare intactos, herencia F-10) · `test/f11-queue.int-spec.ts` :: `R8: waitingTriage pone primero… y F-10 hereda la posición` |
| R9 | `triage-input.v2.spec.ts` :: 6 pruebas `R9: …` (follow_up redactado, sin PII, vacíos, `triage-v2`, validador) · `test/f11-triage-input.int-spec.ts` :: `R9: follow_up (redactado) y patient_reported_red_flags llegan al LLM…` |
| R10 | `triage-input.v2.spec.ts` :: `R10: las señales referidas por el paciente no cambian el nivel…`, `R10: applyGuards solo recibe el nivel del LLM y NEWS2…` (sin mocks del LLM) |
| R11 | `f11-next-question.e2e-spec.ts` :: `R11: sin señales pide la pregunta al LLM…`, `R11: si Groq falla… OpenRouter`, `R11: aplica primero las reglas…` · `interview.rules.spec.ts` :: `R11: une las señales…` · `contract.e2e-spec.ts` :: `R11: info.version es 0.11.0 y POST …/next-question…` |
| R12 | `interview.rules.spec.ts` :: `R12: acepta…`, `R12: rechaza %s` (13), `R12: rechaza la pregunta prohibida %j` (16), `R12: … palabras completas`, `R12: hay una pregunta fija por dimensión…`, `R12: nextFallback…` (2) · `f11-next-question.e2e-spec.ts` :: `R12: una salida inválida se reintenta una vez…`, `R12: dos salidas inválidas → la pregunta fija…`, `R12: si el LLM excede el timeout → la pregunta fija` |
| R13 | `f11-next-question.e2e-spec.ts` :: `R13: redFlagSuspected = true → RED_FLAG…` · `interview.rules.spec.ts` :: `R13: conserva redFlagSuspected y done…` |
| R14 | `f11-next-question.e2e-spec.ts` :: `R14: con 5 turnos responde DONE sin llamar al LLM`, `R14: done = true con ≥3 dimensiones respondidas → DONE; con menos, sigue…` · `interview.rules.spec.ts` :: `R14: answeredDimensions…` |
| R15 | `f11-next-question.e2e-spec.ts` :: `R15: al LLM llegan los textos pasados por redact()…`, `R15: los logs no llevan el contenido…` |
| R16 | `f11-access.e2e-spec.ts` :: `R16: un paciente puede hacer 30 peticiones en 10 min; la 31ª recibe 429…`, `R16: el límite cuenta por paciente aunque cambie la cuenta o el token` |
| R17 | `f11-access.e2e-spec.ts` :: `R17: un token de personal… 403`, `R17: sin token o con un token inválido → 401`, `R17: cuerpo inválido (%s) → 400…` (8), `R17: si fallan ambos proveedores del LLM → 503…` |

T10 (ai:eval): `src/modules/interview/interview-eval.spec.ts` (5 pruebas con un advisor falso; las 14 viñetas se validan y las ambiguas no activan las reglas).

## Resultados
- `npm test`: unitarias **37 suites / 400 pruebas** y e2e **15 suites / 123 pruebas**, todo en verde.
- `npm run test:int` (Docker local): **49 suites / 362 pruebas**, todo en verde.
- `npm run lint`, `npm run typecheck`, `prisma validate`: OK.
- `./init.sh` (completo): `FAIL: 0 · WARN: 0 · Estado: VERDE`.
- `npm run ai:eval`: **no ejecutado** (pendiente, manual, por el humano).

## Decisiones de implementación (para el reviewer)
Detalle y justificación en `progress/current/F-11-api.md`, sección "Interpretaciones".
1. **R3 vs R4:** las reglas del servidor revisan el motivo también **sin** entrevista (un motivo como "convulsionó" deja `red_flags = {SEIZURE}`); R3 se cumple con motivos sin señales.
2. **R12/R17:** timeout (de cualquiera de las llamadas) → pregunta fija con 200; 503 solo si en el primer intento ningún proveedor devuelve salida y ningún fallo fue timeout; un fallo de llamada en el reintento (tras una salida inválida) → pregunta fija.
3. **Validador estricto:** la pregunta se valida siempre, también con `done` o `redFlagSuspected` (el prompt pide siempre una pregunta).
4. Los DTO `SymptomInterviewDto`/`InterviewTurnDto` viven en `interview/dto/` (encounters los importa) para no crear la dependencia `interview → encounters`.
5. `triage-v2` es un archivo nuevo (`triage-v1.md` intacto) y el validador de F-04 admite citar `follow_up[n]` y `patient_reported_red_flags` (si no, el LLM produciría `INVALID_OUTPUT` al usar lo que el prompt le da).
6. `InterviewAdvisor` sin base (como `TriageAdvisor`) para reutilizarlo en `ai:eval`; `AiCoreModule` exporta `ADVISOR_BUDGET` (el fallback usa el mismo presupuesto total de F-04).
7. `symptom_interview` se guarda tal como lo envió la app; la unión de señales va solo en `red_flags`. Las atenciones `DIRECT` no pasan por las reglas (fuera de alcance).
8. `@PatientThrottled(30, 10 min)` usa el `ThrottlerGuard` existente con `getTracker` por `patientId` del token.
