# F-06-api — Tareas

> **Orden estricto.** En cada tarea, primero la prueba `R<n>: …` y luego el código. No se empieza ninguna tarea hasta que la spec esté aprobada.
>
> **Sin migraciones** (design.md "Impacto en datos"). Si durante la implementación pareciera necesaria una, **parar** y documentarlo (docs/specs.md §5).
>
> Nada se ejecuta contra Supabase.

- [x] T1 Refactor sin cambio de comportamiento: mover `ageInYears` de `modules/ai/triage-input.ts` a `common/clock/age.ts`, con sus pruebas, y hacer que `triage-input.ts` la importe. `npm test` sigue en verde, sin tocar las pruebas de F-04. (R2)
- [x] T2 Prueba unitaria + `modules/queue/queue.rules.ts` (pura):
  - `MAX_WAIT_MINUTES_BY_LEVEL` con el comentario "Res. 5596 de 2015: I inmediato, II 30 min; III–V sin tiempo máximo en el MVP (PA-F06-1, opción (a), humano, 2026-11-09)".
  - `R3:` `waitMinutes` (59 s → 0, 60 s → 1).
  - `R4:` `isOverdue` (I 0/1, II 30/31, III–V y sin nivel → `false`) y `maxWaitMinutes`.
  - `R2:` `initials` ("maría josé pérez" → "MP", tildes, una palabra, espacios múltiples, NN → `null`).
  - `R1:`/`R8:` `buildQueue`: reparto y orden de las tres secciones, empates por `id`, `REGISTERED`/`CLOSED`/`CANCELLED` excluidos, `waitMinutes = null` en `inCare` y `finalLevel = null` en `waitingTriage`.

  (R1, R2, R3, R4, R8)
- [x] T3 Pruebas de integración + `EncountersService.listActiveForQueue(tenantId, siteId?)` (D2): una sola consulta, solo los campos de D2, filtro por tenant, sede y los tres estados activos. (R1, R5, R8)
- [x] T4 Pruebas de integración + `QueueService`, `QueueController` y DTOs (`GET /queue`, `@StaffRoles('PHYSICIAN', 'NURSE', 'ADMIN')`), con un DTO de consulta que solo admite `siteId` UUID (`forbidNonWhitelisted`):
  - `R1:` atenciones en los seis estados, dos sedes y dos tenants → tres secciones correctas.
  - `R3:` `serverNow` y `waitMinutes` con `FixedClock`.
  - `R4:` `overdue` en I y II con el reloj fijado justo antes y justo después del límite.
  - `R5:` filtro de sede.
  - `R6:` `siteId` mal formado → 400, de otro tenant → secciones vacías, parámetro extra → 400.
  - `R7:` búsqueda profunda en la respuesta del nombre completo, el documento, `birthDate`, el id del paciente y el motivo → nada.

  (R1, R2, R3, R4, R5, R6, R7, R8)
- [x] T5 Pruebas de integración + `EncountersService.startCare` y `close` y los endpoints `POST /encounters/:id/start-care` y `POST /encounters/:id/close` (`@StaffRoles('PHYSICIAN')`, `UuidParamPipe`, `@HttpCode(200)`):
  - `R9:`/`R10:` 200 con `EncounterDto`, evento `STATUS_CHANGED` (from/to) y auditoría `ENCOUNTER_STATUS_CHANGED` en la misma transacción.
  - `R11:` 409 en cada estado no válido (`WAITING_TRIAGE` → `start-care`, `TRIAGED` → `close`, `CLOSED`, `CANCELLED`) y con dos `start-care` simultáneos → un 200 y un 409.
  - `R12:` 404 igual en los tres casos y 400 con cuerpo `{ status: 'CLOSED' }`.
  - `R13:` `final_level`, `triaged_at` y `triaged_by` intactos tras `close`, y el CHECK de F-05 se cumple.
  - Tras `start-care`, la atención pasa de `triaged` a `inCare` en la cola.

  (R9, R10, R11, R12, R13)
- [x] T6 Pruebas transversales:
  - `R14:` matriz de roles (en la cola, `RECEPTION` → 403; en las transiciones, `NURSE`, `RECEPTION` y `ADMIN` → 403; paciente → 403 en todos; sin token → 401), en e2e y en integración (sin cambios).
  - `R15:` errores en `problem+json` y logger capturado en la cola sin el nombre del paciente.

  (R14, R15)
- [ ] T7 Documentación: docs/architecture.md (módulo `queue`, `listActiveForQueue`, `startCare`/`close`, `ageInYears` en `common`) y docs/data-model.md (F-06 sin migración; las transiciones `IN_CARE`/`CLOSED` ya están expuestas, PA-F02-4). (R9, R10)
- [ ] T8 Regenerar el snapshot OpenAPI: `API_CONTRACT_VERSION = '0.7.0'`, `QueueDto`, `QueueItemDto` y `QueuePatientDto`, las dos operaciones de transición y la descripción de los tiempos máximos; prueba de contrato (`info.version = 0.7.0` y las tres operaciones); `npm run openapi:export`, comprobando que una segunda ejecución no da diff. El leader fija `contract.version = "0.7.0"` en `feature_list.json`. (R1, R2, R9, R10, R14, R15)
