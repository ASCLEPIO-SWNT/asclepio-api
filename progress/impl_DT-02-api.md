# DT-02-api — Informe de implementación

Rama `feature/DT-02-api` (sin push). Spec aprobada el 2026-11-11. T1–T10 en `[x]`. Sin migraciones.

**Contrato:** `info.version = 0.9.0` (`src/app.setup.ts` y `openapi/asclepio-api.v1.json`). El leader debe poner `contract.version = "0.9.0"` en `feature_list.json`. Una segunda `npm run openapi:export` tras el commit no produce diff. El diff del snapshot solo toca `GET /queue`, `QueueItemDto`, `QueueDto` e `info.version`.

## Commits

| Commit                                                                                        | Tarea |
| --------------------------------------------------------------------------------------------- | ----- |
| `0758a34` feat(encounters): listActiveForQueue devuelve triagedAt                             | T1    |
| `1b0cf5e` feat(queue): overdue y minutesSinceTriage desde triaged_at con tiempo exacto        | T2    |
| `a261bd2` feat(queue): triaged por nivel y más tiempo desde la clasificación                  | T3    |
| `1d04947` test(queue): la frontera de overdue coincide con el cumplimiento de F-07            | T4    |
| `0bc404e` test(queue): adapta las pruebas de F-06 a la alerta desde la clasificación          | T5    |
| `997b743` test(queue): integración de la alerta y el orden desde la clasificación             | T6    |
| `3a83bd3` feat(queue): QueueItemDto.minutesSinceTriage y descripciones desde la clasificación | T7    |
| `547e72e` docs(queue): enmiendas de F-06 por la alerta desde la clasificación                 | T8    |
| `d75cb28` feat(api): contrato 0.9.0 con QueueItemDto.minutesSinceTriage                       | T9    |
| (sin commit propio) T10 en `[x]` en `specs/DT-02-api/tasks.md` + este informe                 | T10   |

## Archivos tocados

- Código: `src/modules/encounters/encounters.service.ts` (`ActiveEncounterForQueue.triagedAt`, `select`), `src/modules/queue/queue.rules.ts` (`QueueRow.triagedAt`, `QueueItem.minutesSinceTriage`, `minutesSinceTriage()`, `isOverdue(level, elapsedMs)` con `elapsedMs > max · 60 000`, comparadores `byClassifiedFirst` y `byMinutesSinceTriageDesc`, JSDoc con la Res. 5596/2015 y la Res. 256/2016), `src/modules/queue/dto/queue.dto.ts`, `src/modules/queue/queue.controller.ts`, `src/app.setup.ts` (0.9.0).
- Pruebas nuevas: `src/modules/queue/queue.rules.dt02.spec.ts`, `test/dt02-queue.int-spec.ts`.
- Pruebas adaptadas (no borradas): `src/modules/queue/queue.rules.spec.ts`, `test/f06-queue.int-spec.ts`, `test/f06-queue-source.int-spec.ts`, `test/contract.e2e-spec.ts`.
- Contrato: `openapi/asclepio-api.v1.json`.
- Documentación: `docs/product/features/F-06.md` (AC2, PA-F06-1, PA-F06-2), `specs/F-06-api/requirements.md` y `design.md` (notas "Modificado por DT-02-api"), `src/modules/queue/README.md`, `docs/architecture.md`, `docs/data-model.md`, `progress/current/DT-02-api.md` (aviso para F-06-web), `specs/DT-02-api/tasks.md`.

## Requisitos → pruebas

| R   | Archivo :: prueba                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `src/modules/queue/queue.rules.dt02.spec.ts` :: "R1: minutos completos desde triaged_at hasta serverNow (floor)"; "R1: el elemento de triaged lleva minutesSinceTriage; waitingTriage e inCare, null" · `test/dt02-queue.int-spec.ts` :: "R1: listActiveForQueue devuelve triagedAt…" · `test/f06-queue-source.int-spec.ts` :: "R1: cada fila trae solo los campos de D2…" (adaptada)                                                                               |
| R2  | `queue.rules.dt02.spec.ts` :: "R2: nivel II vence con más de 1 800 000 ms y nivel I con más de 0 ms…"; "R2: III, IV, V y sin nivel nunca vencen"; "R2: TRIAGED de III–V con mucho tiempo…"                                                                                                                                                                                                                                                                          |
| R3  | `queue.rules.dt02.spec.ts` :: "R3: nivel II llegado hace 90 min: 30:00.000 → false; 30:00.001 y 30:01 → true con 30; 31:00 → true con 31"; "R3: nivel I con triagedAt = serverNow → false; 1 ms y 1 s después → true…"; "R3: la espera desde la llegada no decide la alerta…" · `test/dt02-queue.int-spec.ts` :: "R3: nivel II llegado a T − 90 y clasificado a T − 30…"; "R3: nivel I clasificado en T…"                                                           |
| R4  | `src/modules/queue/queue.rules.dt02.spec.ts` :: "R4: maxWaitMinutes por nivel desde MAX_WAIT_MINUTES_BY_LEVEL (I = 0, II = 30, III–V y sin nivel null), en triaged e inCare" · `test/contract.e2e-spec.ts` :: "R4: la descripción de maxWaitMinutes dice que se cuenta desde la clasificación (Res. 256 de 2016), con I = 0 y II = 30" (añadidas tras la revisión, hallazgo 1) · también "R10: las descripciones de GET /queue, triaged, overdue y maxWaitMinutes…" |
| R5  | `queue.rules.dt02.spec.ts` :: "R5: dentro del nivel, más tiempo desde la clasificación primero (llegó −50/clasificada −45…)"; "R5: empates de minutesSinceTriage… por id ascendente"; "R5: waitingTriage (mayor espera) e inCare (nivel y llegada) conservan el orden de F-06" · `test/dt02-queue.int-spec.ts` :: "R5: triaged por nivel y, en el nivel II, más tiempo desde la clasificación primero (no la llegada)"                                              |
| R6  | `queue.rules.dt02.spec.ts` :: "R6: IN_CARE → overdue false, minutesSinceTriage null, waitMinutes null y maxWaitMinutes según su nivel" · `test/dt02-queue.int-spec.ts` :: "R6: tras start-care la atención está en inCare sin alerta…"                                                                                                                                                                                                                              |
| R7  | `queue.rules.dt02.spec.ts` :: "R7: WAITING_TRIAGE → finalLevel null, maxWaitMinutes null, minutesSinceTriage null y overdue false"                                                                                                                                                                                                                                                                                                                                  |
| R8  | `queue.rules.dt02.spec.ts` :: "R8: TRIAGED sin triaged_at → minutesSinceTriage null y overdue false, sin error"; "R8: TRIAGED sin triaged_at va al final de triaged…"                                                                                                                                                                                                                                                                                               |
| R9  | `queue.rules.dt02.spec.ts` :: "R9: waitMinutes, minutesSinceTriage y overdue salen del mismo now" · `test/dt02-queue.int-spec.ts` :: "R9: … salen del mismo serverNow; las horas del cliente se ignoran"                                                                                                                                                                                                                                                            |
| R10 | `test/contract.e2e-spec.ts` :: "R10: info.version es 0.9.0 y QueueItemDto.minutesSinceTriage es integer, nullable y requerido"; "R10: las descripciones de GET /queue, triaged, overdue y maxWaitMinutes cuentan la alerta y el orden desde la clasificación (Res. 256 de 2016)…"                                                                                                                                                                                   |
| R11 | `queue.rules.dt02.spec.ts` :: "R11: reports toma su máximo de la misma constante MAX_WAIT_MINUTES_BY_LEVEL (30 para el nivel II), sin literal"; "R11: con 30 min exactos de la clasificación a la atención, no vencida y cumplida; con 30 min y 1 ms, vencida y no cumplida" (usa `buildQueue` y `buildRows` de `report-rows.ts`)                                                                                                                                   |

## Resultados

- `npm run lint`, `npm run typecheck`: OK.
- `npm test`: unitarias 30 suites / 256 pruebas; e2e 11 suites / 83 pruebas; todo en verde. Tras añadir las pruebas R4 (revisión, hallazgo 1): `npm run test:unit -- queue.rules.dt02` 19/19 y `npm test` 257 unitarias + 84 e2e en verde (sin volver a ejecutar `./init.sh` ni `test:int`, por indicación del leader).
- `npm run test:int` (Docker local, `localhost:54329`; el guardián de URL de `scripts/test-int.sh` pasó): 40 suites / 332 pruebas, en verde.
- `./init.sh` (completo): `FAIL: 0 · WARN: 0`, `Estado: VERDE`.
- Ninguna prueba llama a Groq/OpenRouter (las de integración usan `FakeLlmClient`); no se ejecutó `ai:eval`. Sin migraciones ni comandos Prisma prohibidos.

## Desviaciones y notas para el reviewer

1. **R8, orden:** las filas `TRIAGED` sin `triaged_at` van al final de toda la sección `triaged` (comparador `byClassifiedFirst` antes de `byLevel`), incluso si tuvieran nivel (imposible por el CHECK de F-05). El diseño solo decía "nulos al final" dentro del comparador por minutos; así se cumple R8 al pie de la letra en cualquier caso. Entre ellas, nivel e `id`.
2. **Commits intermedios:** entre T2 y T5, `queue.rules.spec.ts` (F-06) no compilaba ni pasaba (helper sin `triagedAt` e `isOverdue` en ms), porque el orden de `tasks.md` deja su adaptación para T5. Desde `0bc404e` todo está en verde.
3. **Regla de módulos:** `queue` sigue leyendo solo vía `EncountersService`. La prueba R11 (`queue.rules.dt02.spec.ts`) importa las funciones puras de `reports/report-rows.ts`, como pide el diseño; es solo en la prueba, el código de `queue` no depende de `reports`. Además, lee el fuente de `report-rows.ts` para comprobar que importa `MAX_WAIT_MINUTES_BY_LEVEL` y no lleva un literal.
4. En `f06-queue.int-spec.ts` R4 se mantuvo la tupla `[maxWaitMinutes, overdue]`, como indica la spec (`[0, false]`, `[30, true]`…).
5. Pendiente del leader: `contract.version = "0.9.0"` en `feature_list.json`, roadmap y `progress/history.md`.
