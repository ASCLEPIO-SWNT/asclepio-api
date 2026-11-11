# DT-02-api — Tareas

Sin migraciones (design.md, "Impacto en datos"). Sin preguntas abiertas (PA-DT02-1 → (b), PA-DT02-2 → (a)). Requisito previo: spec aprobada.

- [x] T1 Prueba R1 (`test/f06-queue-source.int-spec.ts` y nueva `test/dt02-queue.int-spec.ts`: `listActiveForQueue` devuelve `triagedAt`) + implementación: `EncountersService.listActiveForQueue` añade `triagedAt` al `select` y a `ActiveEncounterForQueue`. (R1)
- [x] T2 Pruebas unitarias R1, R2, R3, R6, R7 y R8 en `src/modules/queue/queue.rules.dt02.spec.ts` (primero, en rojo) + implementación en `queue.rules.ts`:
  - `QueueRow.triagedAt` y `minutesSinceTriage(triagedAt, now)` (`floor`, minutos completos);
  - `isOverdue(level, elapsedMs)` con `elapsedMs > max · 60 000` (tiempo exacto) y `toItem` con `minutesSinceTriage` y `overdue` solo en `TRIAGED`, con el mismo `now`;
  - JSDoc de `MAX_WAIT_MINUTES_BY_LEVEL` con la Res. 5596 de 2015 y la Res. 256 de 2016.

  Instantes límite (llegada a −90 min): nivel II a 30:00.000 → `false`; a 30:00.001 y a 30:01 → `true`, con `minutesSinceTriage = 30`; a 31:00 → `true` con 31. Nivel I a 0 ms → `false`; a 1 ms y a 1 s → `true`, con `minutesSinceTriage = 0`. (R1, R2, R3, R6, R7, R8)

- [x] T3 Prueba unitaria R5 (ejemplo de nivel II con llegada −50/clasificación −45 antes que llegada −90/clasificación −10; empates por `id`; `waitingTriage` e `inCare` sin cambios; `waitMinutes` desde la llegada) + implementación: comparador `byMinutesSinceTriageDesc` (nulos al final) en la sección `triaged` de `buildQueue`. (R5, R8)
- [ ] T4 Prueba unitaria R11: la constante que importa `reports` es la misma y vale 30 para el nivel II; con 30 min exactos de clasificación a atención, `overdue` es `false` y el cumplimiento de `report-rows.ts` es `true`; con 30 min y 1 ms, `overdue` es `true` y el cumplimiento, `false`. Sin código nuevo si pasa. (R11)
- [ ] T5 Adaptar las pruebas de F-06 (design.md, "Pruebas de F-06 afectadas"):
  - `queue.rules.spec.ts`:
    - helper `row(...)` con `triagedAt` (por defecto `arrivalAt` si hay nivel);
    - **"R1: reparte por estado y ordena…"** con `triagedAt` explícitos, el título "triaged por nivel y minutos desde la clasificación" y el orden esperado nuevo de `triaged`;
    - `minutesSinceTriage` en "R2: cada elemento tiene la forma…";
    - "R4: nivel I vence…" en milisegundos (`isOverdue(2, 1_800_000)` → `false`, `isOverdue(2, 1_800_001)` → `true`, `isOverdue(1, 0)` → `false`, `isOverdue(1, 1)` → `true`);
    - "R4: overdue solo en TRIAGED" con `t1-ok` (59 s) → `true` y una fila de nivel I con `triagedAt = NOW` → `false`.
  - `test/f06-queue.int-spec.ts`:
    - título y comentario de **"R1: … repartidas y ordenadas"** (más tiempo desde la clasificación primero; mismo resultado);
    - `minutesSinceTriage` en "R2";
    - "R4": nivel I en `NOW` → `[0, false]` y `NOW + 1 s` → `[0, true]`; `t2NewB` en `NOW + 20 min` → `[30, false]` y `NOW + 20 min + 1 s` → `[30, true]`.

  (R1, R2, R3, R5)

- [ ] T6 Pruebas de integración R3, R5, R6 y R9 en `test/dt02-queue.int-spec.ts` (Docker, `FixedClock`; clasificar con `POST /triage-decision` con el reloj en la hora deseada, nunca con `setStatus`):
  - nivel II con llegada a `T − 90 min` y clasificación a `T − 30 min`: en `T` → `waitMinutes = 90`, `minutesSinceTriage = 30`, `overdue = false`; en `T + 1 ms` y `T + 1 s` → `overdue = true` con `minutesSinceTriage = 30`;
  - nivel I clasificado en `T`: en `T` → `false`; en `T + 1 s` → `true`;
  - el ejemplo de orden de R5;
  - `start-care` → `inCare` sin alerta;
  - horas del cliente ignoradas.

  (R3, R5, R6, R9)

- [ ] T7 Prueba de contrato R10 (bloque `DT-02-api` en `test/contract.e2e-spec.ts`) + implementación: `QueueItemDto.minutesSinceTriage` (`integer`, `nullable`, requerido) y descripciones de `waitMinutes`, `maxWaitMinutes`, `overdue` (tiempo exacto; puede ser `true` con `minutesSinceTriage` igual al máximo), `QueueDto.triaged` y de la operación `GET /queue` (manteniendo `I = 0 min` y `II = 30 min`); añadir `minutesSinceTriage` a la lista exacta de campos de la prueba R2 de F-06 en ese archivo. (R4, R10)
- [ ] T8 Documentación (design.md, "Documentación de producto"):
  - enmienda de **F-06.AC2** (dentro de cada nivel, mayor tiempo desde la clasificación primero; `WAITING_TRIAGE` por mayor espera desde la llegada), de PA-F06-2 y de PA-F06-1 (tiempo exacto desde la clasificación: II > 30 min, I vencida en cuanto pasa cualquier tiempo) en `docs/product/features/F-06.md`;
  - notas "Modificado por DT-02-api" en `specs/F-06-api/requirements.md` (glosario: vencida y secciones; R1; R4; PA-F06-2) y `specs/F-06-api/design.md` (riesgos 1 y 3);
  - una línea en `src/modules/queue/README.md`, `docs/architecture.md` (sección de la cola) y `docs/data-model.md` (párrafo de F-06: la cola lee `triaged_at`).

  (R2, R4, R5)

- [ ] T9 Regenerar el snapshot OpenAPI (`npm run openapi:export`) y fijar `info.version = 0.9.0`. El leader anota `contract.version = "0.9.0"` en `feature_list.json`. Dejar en `progress/current/DT-02-api.md` el aviso para F-06-web (design.md, "Impacto en F-06-web"), incluidos la guía de `/cola`, que deja de ser cierta, y el nivel I siempre con alerta en «Clasificadas». (R10)
- [ ] T10 `npm run lint && npm run typecheck && npm test && npm run test:int` y `./init.sh` en verde. (R1–R11)
