# Implementación — F-11-api, enmienda tras `ai:eval` (T12)

El informe anterior se archivó al cerrar F-11-api (ver `progress/history.md`). Este informe cubre solo la reapertura: R13 enmienda 2, R14 enmienda y R18, aprobados por el humano el 2026-11-18.

- **Rama:** `feature/F-11-api`, sin push. Sin migraciones, sin `.env` y sin llamadas al LLM.
- **`npm run ai:eval` NO se ejecutó.** El humano lo vuelve a ejecutar para confirmar la enmienda.
- **Contrato sin cambios** (0.11.0): no cambia ningún DTO ni ruta.
- **Fixture sin cambios:** SHA-256 `2d75bdbd0ba08e8e1c9d29ccc40c94ab8c9ca003c34ee8c642409c4da83fe6b7`.

## Cambios
- **`src/modules/interview/interview.rules.ts`** (puro y portable a Kotlin; F-11-mobile porta la misma decisión):
  - `mentionsPain(text)`: busca `dolor`, `duele`, `duelen` o `doler` y sus formas en el texto normalizado.
  - `missingMandatory(complaint, turns)`: devuelve `ONSET` si no está entre los turnos. Si el motivo o alguna respuesta mencionan dolor, devuelve `LOCATION` cuando falta. Si no falta nada, devuelve `null`.
  - `resolveOutput(complaint, turns, checked)` decide a partir de la salida validada:
    - `redFlagSuspected` (de una salida con esquema válido, aunque falle el texto): `RED_FLAG`, salvo con **0 turnos respondidos**, donde se ignora.
    - `done` con ≥3 respondidas: `DONE` solo si no falta ninguna dimensión obligatoria; si falta alguna, la pregunta fija de esa dimensión.
    - En otro caso, la pregunta del LLM.
    - Devuelve `null` si la salida es inválida y no hay una sospecha atendible.
- **`src/modules/interview/interview-advisor.ts`** (adonde `interview.service.ts` delega desde T10):
  - Usa `resolveOutput`.
  - `INTERVIEW_PROMPT_VERSION = 'interview-v2'`.
  - Si la respuesta es una pregunta fija obligatoria, `source` vale `FIXED`.
  - Las reglas de alarma sobre el motivo siguen corriendo antes y escalan también en el turno 0. Con 5 turnos sigue respondiendo `DONE`.
- **`ai/prompts/interview-v2.md`** (nuevo; `interview-v1.md` sin cambios):
  - `redFlagSuspected` solo ante síntomas concretos descritos, nunca ante un motivo vago.
  - Pide `ONSET` y, con dolor, `LOCATION` antes de `done`.
- **`src/scripts/ai-eval.ts`:** la cabecera de la entrevista muestra `INTERVIEW_PROMPT_VERSION`. El runner no depende de la versión y las viñetas no cambian.
- **Docs:** `docs/architecture.md`, `src/modules/interview/README.md` y `ai/vignettes/interview/README.md` pasan a `interview-v2`. `specs/F-11-api/tasks.md`: T12 `[x]`.
- **Prueba existente ajustada:** `R14: done = true con ≥3 dimensiones respondidas → DONE…` ahora usa un motivo sin dolor ("DEV mareo"). Con dolor, ahora exige `LOCATION`.

## Trazabilidad (pruebas nuevas)

| R | Archivo :: prueba |
|---|---|
| R13 (enmienda 2) | `interview.rules.spec.ts` :: `R13: con 0 turnos respondidos se ignora redFlagSuspected y sigue la pregunta; con alguno, escala (también si falla el texto)`, `R13: una salida inválida sin sospecha devuelve null…` · `test/f11-next-question.e2e-spec.ts` :: `R13: con 0 turnos respondidos se ignora redFlagSuspected del LLM y sigue la pregunta`, `R13: con 0 turnos respondidos las reglas sobre el motivo siguen escalando en el primer turno` |
| R14 (enmienda) | `interview.rules.spec.ts` :: `R14: mentionsPain…`, `R14: missingMandatory pide ONSET y, si hay dolor…, LOCATION`, `R14: done = true con ≥3 respondidas se acepta solo con las obligatorias cubiertas…` · `test/f11-next-question.e2e-spec.ts` :: `R14: done = true sin ONSET → la pregunta fija de ONSET`, `R14: done = true con dolor… y sin LOCATION → la pregunta fija de LOCATION; con LOCATION → DONE`, `R14: con 5 turnos responde DONE sin llamar al LLM` (sin cambios) |
| R18 | `test/f11-next-question.e2e-spec.ts` :: `R18: el system enviado al LLM es el prompt interview-v2…` |

Las pruebas se escribieron primero y fallaron (4 e2e en rojo y las unitarias sin compilar) antes de implementar.

## Resultados
- Unitarias de `interview`: 113/113. e2e de F-11: 31/31.
- `npm test`: unitarias 421/421 y e2e 130/130. `npm run test:int`: 362/362. `./init.sh` completo: `FAIL: 0 · WARN: 0 · Estado: VERDE`.
