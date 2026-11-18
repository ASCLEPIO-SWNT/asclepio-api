# F-10-api — Informe de implementación

- **Rama:** `feature/F-10-api` (7 commits, T1–T7; sin push).
- **Contrato:** `info.version` **0.10.0** (menor: `GET /patient/queue-position` y `GET /patient/queue-position/stream`). `contract.version` de F-10-api en `feature_list.json` ya era `0.10.0` (coincide). `npm run openapi:export` no deja diff.
- **Sin migraciones**, sin dependencias npm nuevas (rxjs y jose ya estaban). Nada contra Supabase ni LLM.
- Estado de la feature: sigue `in_progress` (lo cierra el leader tras el reviewer).

## Archivos tocados

Nuevos:
- `src/modules/patient-queue/estimate.rules.ts` (+ `.spec.ts`): `ESTIMATE` (PA-F10-1), `positionOf`, `estimateWait`.
- `src/modules/patient-queue/position-stream.ts` (+ `.spec.ts`, TestScheduler): stream puro de D3, `STREAM_TIMING` (1 s / 15 s), `PATIENT_QUEUE_TIMING`.
- `src/modules/patient-queue/patient-queue.service.ts`, `patient-queue.controller.ts`, `patient-queue.module.ts`, `dto/patient-queue.dto.ts`, `README.md`.
- `test/f10-queue-source.int-spec.ts`, `test/f10-changes.int-spec.ts`, `test/f10-patient-queue.int-spec.ts`, `test/f10-stream.int-spec.ts`, `test/f10-privacy.int-spec.ts`, `test/f10-stream.e2e-spec.ts`, `test/f10-access.e2e-spec.ts`, `test/sse-client.ts` (cliente SSE de prueba sobre fetch).

Modificados:
- `src/modules/encounters/encounters.service.ts`: `findActiveForPatient`, `countPhaseExits`, `changes$`, `inTransaction` y `markChanged` en `createInTx` / `transition` / `recordTriage`; `createDirect`, `cancel` y `statusChange` usan `inTransaction`.
- `src/modules/encounters/pre-registrations.service.ts` (`confirm`) y `src/modules/triage/triage-decisions.service.ts` (`decide`): `this.prisma.$transaction` → `this.encounters.inTransaction` (único cambio).
- `src/app.module.ts` (`PatientQueueModule`), `src/app.setup.ts` (`API_CONTRACT_VERSION = '0.10.0'`), `openapi/asclepio-api.v1.json`.
- `test/contract.e2e-spec.ts`: rutas nuevas, `0.9.0 → 0.10.0` en las aserciones de versión y tres pruebas F-10.
- `docs/architecture.md` (árbol, tabla de módulos y sección "Posición del paciente (F-10)"), `src/modules/encounters/README.md`, `specs/F-10-api/tasks.md` (T1–T7 `[x]`).

## Decisiones de implementación (dentro de la spec)

- **Emisión tras el commit (T3):** Prisma no tiene hook de commit. Los métodos transaccionales registran `{ tenantId, siteId }` en un `WeakMap` por `tx`, y `EncountersService.inTransaction(fn)` lo publica en `changes$` solo cuando `$transaction` resuelve (deduplicado por sede). Un rollback no emite (prueba con fallo de auditoría). Toda transacción que hoy llama a esos métodos usa `inTransaction`.
- **`countPhaseExits(tenantId, siteId, phase, since, until)`:** se añadió `until` (= `serverNow`) a la firma del design para que la ventana sea `[serverNow − 4 h, serverNow]` cerrada, como dice el glosario.
- **R11:** el controller lee `exp` del Bearer ya verificado por el guard (`decodeJwt` de jose, vía `@Req()` para no publicar la cabecera como parámetro en el contrato).
- **D6 / DONE:** el stream sigue la atención con la que se abrió (o la primera que aparezca si se abrió en `NO_ACTIVE`); si deja de ser la activa (terminó, o hay otra nueva), emite `DONE` y cierra. Mientras no hay atención, escucha cambios de cualquier sede del tenant.
- **Latido:** comentario SSE `: ping` (Nest 12 soporta `MessageEvent.comment`) solo en el recálculo de 15 s sin cambios; un cambio sin diferencia no emite nada.
- **Logs:** solo `tenantId` y `phase` (`patient_queue_read`) y apertura/cierre del stream con `tenantId`.

## Para el leader / reviewer

- `CHECKPOINTS.md` C3 dice "los 10 módulos de `docs/architecture.md`"; ahora hay 11 (`patient-queue`, ya listado en architecture.md). No lo edité (archivo del harness).
- El stream e2e usa `EncountersService` falso y tiempos reales (debounce 1 s); el latido se acorta solo en la prueba de R9 (además cubierto con TestScheduler a 15 s reales).

## Trazabilidad R<n> → prueba

| R | Pruebas (archivo :: nombre) |
|---|---|
| R1 | `test/f10-patient-queue.int-spec.ts` :: `R1: responde 200 con la instantánea de la atención activa…`; `test/f10-queue-source.int-spec.ts` :: `R1: findActiveForPatient devuelve null cuando la atención terminó…`; `test/contract.e2e-spec.ts` :: `R1: info.version es 0.10.0 y GET /patient/queue-position declara…` |
| R2 | `src/modules/patient-queue/estimate.rules.spec.ts` :: `R2: en WAITING_TRIAGE…`, `R2: en TRIAGED la fase es WAITING_CARE…`, `R2: con el mismo nivel, el empate…`, `R2: en IN_CARE la fase es CALLED…`; `test/f10-patient-queue.int-spec.ts` :: `R2: dos pacientes TRIAGED de nivel III y uno nuevo de nivel II → la posición del III pasa de 1 a 2`, `R2: la posición se calcula solo con las atenciones de la sede…` |
| R3 | `estimate.rules.spec.ts` :: `R3: las constantes de PA-F10-1…`, `R3: con 5 salidas…`, `R3: redondea a múltiplos de 5…`, `R3: el máximo nunca baja de 5 min…`; `test/f10-queue-source.int-spec.ts` :: `R3: countPhaseExits cuenta, por sede y en [serverNow − 4 h, serverNow]…`; `test/f10-patient-queue.int-spec.ts` :: `R3: con 5 clasificaciones en las últimas 4 h…` |
| R4 | `estimate.rules.spec.ts` :: `R4: con 4 salidas en la ventana → estimate null e INSUFFICIENT_DATA` |
| R5 | `estimate.rules.spec.ts` :: `R5: una atención ausente de la cola → NO_ACTIVE…`, `R5: sin personas delante conocidas…`; `test/f10-patient-queue.int-spec.ts` :: `R5: sin atención activa (también con un pre-registro pendiente)…`, `R5: en atención (IN_CARE) la fase es CALLED…` |
| R6 | `test/f10-patient-queue.int-spec.ts` :: `R6: búsqueda profunda…`; `test/contract.e2e-spec.ts` :: `R6: QueuePositionDto solo tiene fase, posición…` |
| R7 | `position-stream.spec.ts` :: `R7: emite de inmediato (t = 0)…`; `test/f10-stream.e2e-spec.ts` :: `R7: responde 200 text/event-stream…`, `R7: sin atención activa el stream emite NO_ACTIVE…`; `test/contract.e2e-spec.ts` :: `R7: GET /patient/queue-position/stream declara…` |
| R8 | `position-stream.spec.ts` :: `R8: un cambio emite la nueva instantánea 1 s después…`, `R8: si la instantánea no cambió…`; `test/f10-changes.int-spec.ts` :: `R8: crear…, clasificar, start-care, close y cancel emiten…`, `R8: confirmar un pre-registro…`, `R8: un rechazo de la transacción (409 o rollback…) no emite nada`; `test/f10-stream.e2e-spec.ts` :: `R8: tras un cambio en la sede del paciente…≤ 2 s; un cambio de otra sede no emite`; `test/f10-stream.int-spec.ts` :: `R8: clasificar al de delante emite la nueva posición en ≤ 2 s…; R10: al cancelar, DONE y cierre` |
| R9 | `position-stream.spec.ts` :: `R9: cada 15 s recalcula…` (TestScheduler); `test/f10-stream.e2e-spec.ts` :: `R9: sin cambios, cada recálculo periódico envía un comentario de latido…` |
| R10 | `position-stream.spec.ts` :: `R10: al llegar a DONE…`; `test/f10-stream.e2e-spec.ts` :: `R10: cuando la atención termina…`, `R10: una nueva atención del paciente…también es DONE`; `test/f10-stream.int-spec.ts` (cancelación real) |
| R11 | `position-stream.spec.ts` :: `R11: se cierra cuando vence el token (closeAfterMs)…`; `test/f10-stream.e2e-spec.ts` :: `R11: cierra el stream cuando vence el token con el que se abrió` |
| R12 | `test/f10-access.e2e-spec.ts` :: `R12: cualquier token de personal → 403; sin token o con uno inválido → 401; siempre problem+json…` |
| R13 | `test/f10-queue-source.int-spec.ts` :: `R13: findActiveForPatient … solo con su tenant y patientId…`; `test/f10-patient-queue.int-spec.ts` :: `R13: un parámetro de consulta → 400 problem+json…`; `test/f10-stream.e2e-spec.ts` :: `R13: un parámetro de consulta en el stream → 400…`; `test/f10-privacy.int-spec.ts` :: `R13: GET y stream registran solo el tenant y la fase…` |

## Resultados

- `npm test`: unitarias **32 suites / 274 pruebas** en verde; e2e **13 suites / 96 pruebas** en verde.
- `npm run test:int` (Docker local, puerto 54329): **45 suites / 348 pruebas** en verde.
- `npm run lint`, `npm run typecheck`: limpios.
- `./init.sh` (completo): `FAIL: 0 · WARN: 0 · Estado: VERDE`.
