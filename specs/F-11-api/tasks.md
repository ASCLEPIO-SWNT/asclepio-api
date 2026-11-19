# F-11-api — Tareas

> Orden estricto: primero la prueba `R<n>: …` y luego el código. La migración va primero y aislada. Nada se ejecuta contra Supabase.

- [x] T1 Migración `--create-only` (Docker local): `symptom_interview` y `red_flags` con su CHECK en `pre_registrations` y en `encounters`. Actualizar `schema.prisma` y `docs/data-model.md`. (R1, R5)
- [x] T2 Prueba + `modules/interview/interview.rules.ts`:
  - fixture `test/fixtures/red-flag-cases.json`, con su hash fijado en la prueba;
  - `detectRedFlags`;
  - `validateQuestion`, con los patrones prohibidos, la forma, el "?" y la dimensión repetida;
  - `FIXED_QUESTIONS` y `nextFallback`.

  (R4, R11, R12, R13, R14)
- [x] T3 Prueba + DTOs y validación de `interview`:
  - `R2:` 400 por cada regla, sin eco de los valores;
  - `R3:` retrocompatible sin `interview`.

  (R1, R2, R3)
- [x] T4 Integración + `PreRegistrationsService`:
  - persistencia;
  - unión de señales en el servidor (`R4:` el cliente envía `[]` con "me desmayé" → `LOSS_OF_CONSCIOUSNESS`);
  - copia al confirmar (`R5:`).

  (R1, R4, R5)
- [x] T5 Integración + `EncounterDto` y `PendingPreRegistrationDto` con `symptomInterview` y `redFlags`, y el orden de la bandeja. (R6, R7)
- [x] T6 Prueba + `buildQueue` y `listActiveForQueue` con `hasRedFlags`, y el orden de `waitingTriage`. Una integración comprueba que F-10 hereda la posición. (R8)
- [x] T7 Prueba + `triage-input.ts` v2 (`follow_up` redactado, `patient_reported_red_flags`, sin PII), `PROMPT_VERSION = 'triage-v2'` y las guards intactas. Actualizar las viñetas de `vignette-eval`. (R9, R10)
- [x] T8 e2e con el LLM falso + `InterviewService`/`Controller` `next-question`:
  - las tres respuestas (`QUESTION`, `DONE`, `RED_FLAG`);
  - reintento → pregunta fija;
  - timeout;
  - `redFlagSuspected`;
  - 5 turnos → `DONE`;
  - `redact()`;
  - logger sin contenido.

  (R11, R12, R13, R14, R15)
- [x] T9 e2e: el 429 con `Retry-After` y la matriz de tokens 401/403, más 400 y 503 en `problem+json`. (R16, R17)
- [ ] T10 Viñetas de entrevista en `npm run ai:eval` (manual, fuera de `init.sh`).
- [ ] T11 `npm run openapi:export` y `contract.version = 0.11.0`.
