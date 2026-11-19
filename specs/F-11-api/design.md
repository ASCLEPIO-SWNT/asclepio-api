# F-11-api — Diseño

## Resumen

| Lugar | Qué aporta |
|---|---|
| `prisma/schema.prisma` + migración `--create-only` | En `pre_registrations` y en `encounters`: `symptom_interview jsonb NULL` y `red_flags text[] NOT NULL DEFAULT '{}'`. |
| `modules/encounters/dto/encounters.dto.ts` | `SymptomInterviewDto` y `InterviewTurnDto` con class-validator (`ArrayMaxSize(6)`, `MaxLength`, `IsIn`, `forbidNonWhitelisted`). Campo opcional `interview` en `CreatePreRegistrationDto`. `symptomInterview` y `redFlags` en `EncounterDto` y `PendingPreRegistrationDto`. |
| `modules/encounters/pre-registrations.service.ts` | Guarda la entrevista. Une las `redFlags` del cliente con las de `detectRedFlags(motivo + respuestas)` (R4). Copia los campos al confirmar (R5). Ordena la bandeja (R7). |
| `modules/interview/interview.rules.ts` | Puro: `DIMENSIONS`, `RED_FLAGS`, `detectRedFlags(text)`, `validateQuestion(raw, turns)`, `FIXED_QUESTIONS` y `nextFallback(turns)`. |
| `modules/interview/interview.service.ts` + `interview.controller.ts` | `POST /patient/symptom-interview/next-question` (`@PatientOnly`). Usa `LlmClient` de `modules/ai/llm/` (Groq → OpenRouter, timeout y un reintento, `temperature = 0`) y `redact()`. Prompt `interview-v1`. |
| `modules/ai/triage-input.ts` + `triage-prompt.builder.ts` | `follow_up` y `patient_reported_red_flags` en el snapshot, `triage-v2` (R9). |
| `modules/queue/queue.rules.ts` | `QueueRow.hasRedFlags` y orden de `waitingTriage` (R8). `listActiveForQueue` selecciona `red_flags`. F-10 lo hereda automáticamente. |
| `common/throttle/` | Regla por paciente para `next-question` (R16), con el mecanismo existente. |
| `test/fixtures/red-flag-cases.json` | Casos `{ text, expected: RedFlag[] }`. Es el mismo archivo que en `asclepio-mobile/app/src/test/resources/`. |

Dependencias: `interview → ai` (LLM, `redact`) y `patients` (nombre y documento para `redact`). `encounters → interview` (solo las reglas puras).

## Decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| D1 | JSONB en lugar de una tabla de turnos. | Tabla `symptom_interview_turns`. | Nunca se consulta por pregunta: se lee completa con la atención. `ponytail:` si un reporte llega a necesitar filtrar por dimensión, se normaliza. |
| D2 | `red_flags text[]` aparte del JSONB. | Leerlo del JSONB. | Ordenar la cola y la bandeja sin abrir el JSON. Lleva un CHECK con los valores permitidos. |
| D3 | El servidor **recalcula** las señales y solo puede añadir (R4). | Confiar en el cliente. | El cliente es frontera de confianza. Las reglas son las mismas en ambos lados. |
| D4 | Fallback sin estado: el cliente envía todos los turnos en cada llamada. | Una sesión en el servidor. | No persiste nada (R15). Son 6 turnos como máximo, así que el payload es pequeño. |
| D5 | Fixture de señales compartido por copia. | Un paquete compartido. | Tres repos independientes (ADR 0002). Hay una prueba en cada repo que compara el hash del archivo con el valor fijado en la spec. |
| D6 | Sin guard nueva (PA-F11-2). | Una G4 "señal del paciente → máximo nivel II". | No inventar reglas clínicas. La prioridad en la espera de triage ya hace que se vea antes. |

## Impacto en contrato

Versión: **0.10.0 → 0.11.0** (menor, retrocompatible).

- `POST /patient/pre-registrations`: nuevo campo opcional `interview: SymptomInterviewDto`.
  - `SymptomInterviewDto`: `engine` (`ON_DEVICE` | `SERVER`), `modelId`, `turns: InterviewTurnDto[]` (≤6), `redFlags: RedFlag[]`, `endedBy`.
  - `InterviewTurnDto`: `dimension`, `question` (≤200), `answer` (≤500 | null).
- `EncounterDto` y `PendingPreRegistrationDto`: `symptomInterview: SymptomInterviewDto | null` y `redFlags: RedFlag[]`.
- `QueueItemDto`: `hasRedFlags: boolean`.
- **Nuevo** `POST /patient/symptom-interview/next-question`, solo paciente.
  - Petición `{ chiefComplaintText, turns }`.
  - **200** `NextQuestionDto`: `{ kind: QUESTION | DONE | RED_FLAG, dimension?, question?, redFlags? }`.
  - **400** · **401** · **403** · **429** · **503**.
- Clientes: F-11-mobile y F-11-web consumen 0.11.0. `PatientPreRegistrationDto` **no** cambia: el paciente no ve sus señales evaluadas.

## Impacto en datos
- **Migración:** sí, una sola, creada con `--create-only` contra el Docker local. El `migrate deploy` lo ejecuta el humano.
- Columnas nuevas en `pre_registrations` y `encounters`:
  - `symptom_interview jsonb NULL`;
  - `red_flags text[] NOT NULL DEFAULT '{}'`, con `CHECK (red_flags <@ ARRAY[...])`.
- Sin índices nuevos: el orden se hace en memoria sobre las filas activas.
- Actualizar `docs/data-model.md`.
- No toca `audit_log` ni `encounter_events`. La auditoría del prerregistro existente cubre la creación, sin el contenido de la entrevista (RNF-05).

## Riesgos y pruebas
- **Unitarias:**
  - `interview.rules.spec.ts`: el fixture completo (100 % de los casos), el validador con salidas prohibidas y válidas, y `nextFallback`.
  - `buildQueue` con `hasRedFlags`.
  - `triage-input` v2, sin PII.
- **Integración:** persistencia y copia, unión de señales en el servidor, 400 por la forma, orden de la bandeja y de la cola, `GET /encounters/:id`.
- **e2e con el LLM falso:** las tres respuestas de `next-question`, el reintento y la pregunta fija, el 429, el 503 y la ausencia de logs con contenido.
- **Manual (`npm run ai:eval`):** las viñetas de entrevista contra el LLM real, con los umbrales de F-11.AC8 (ver F-11-mobile D11).
- **Riesgo:** falsos positivos de las reglas, como "me duele el pecho del gimnasio". Se acepta: en la duda se escala, y lo decide enfermería.
