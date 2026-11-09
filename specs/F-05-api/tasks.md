# F-05-api — Tareas

> **Orden estricto.** En cada tarea, primero la prueba `R<n>: …` y luego el código. No se empieza ninguna tarea hasta que la spec esté aprobada.
>
> **Nada se ejecuta contra Supabase.** Las migraciones se crean con `prisma migrate dev --create-only` **solo** contra el PostgreSQL local de Docker (puerto 54329), pasando `DIRECT_URL` y `DATABASE_URL` locales en la línea de comandos (nunca con `.env`), y se aplican solo en Docker (`npm run test:int`). Antes de crear la migración, `prisma migrate status` en Docker (lección del incidente de F-04).

- [x] T1 Migración 1 `f05_triage_decisions` (aislada): en `prisma/schema.prisma`:
  - modelo `TriageDecision` y enum `triage_decision_action`;
  - columnas `finalLevel`, `triagedAt` y `triagedBy` en `Encounter` (relación `triagedByUser` RESTRICT);
  - `@@unique([id, encounterId])` en `TriageSuggestion`;
  - **todas las FK con `onDelete: Restrict, onUpdate: Restrict`**, incluida la compuesta `(suggestion_id, encounter_id) → triage_suggestions(id, encounter_id)` (design.md D7, D8 e "Impacto en datos").

  Generar con: `docker compose -f docker-compose.test.yml up -d --wait`, `node scripts/assert-local-db.mjs …` y `DIRECT_URL="postgresql://asclepio_test:asclepio_test_local@localhost:54329/asclepio_test" DATABASE_URL="postgresql://asclepio_app:asclepio_app_local@localhost:54329/asclepio_test" npx prisma migrate dev --create-only --name f05_triage_decisions`.

  Añadir al final el SQL manual de los CHECK de D7 y D8. Revisar a mano: ninguna FK `CASCADE`/`SET NULL` y ningún `DROP` de objetos de F-01 a F-04 (índices parciales incluidos). Commit aislado. (R11, R19)
- [x] T2 Migración 2 `f05_app_role_grants` (aislada): migración vacía con el mismo comando; SQL `GRANT SELECT, INSERT ON asclepio.triage_decisions TO asclepio_app;` sin `UPDATE`, `DELETE`, `TRUNCATE`, contraseñas ni `ALTER DEFAULT PRIVILEGES`. Commit aislado. (R19)
- [x] T3 Aplicar en Docker y escribir las pruebas de integración de base:
  - `R19:` `UPDATE`/`DELETE` sobre `triage_decisions` como `asclepio_app` → `42501`; segunda fila con el mismo `encounter_id` → violación de unicidad; `suggestion_id` de otra atención → error de FK; `MANUAL` con sugerencia, `VALIDATE` sin sugerencia, `CORRECT` sin motivo, motivo en `VALIDATE` y `level` 0 o 6 → CHECK; borrar o cambiar ids referenciados → error de FK.
  - `R11:` `encounters` con `final_level` sin `triaged_at`, o en `TRIAGED` sin `final_level` → CHECK.
  - Las pruebas de F-01 a F-04 siguen en verde. (R11, R19)
- [x] T4 Prueba unitaria + `triage-decision.rules.ts` (pura): `R1:` `VALIDATE` toma el `suggestedLevel` (con un guard que subió el nivel, toma el ajustado); `R2:` `CORRECT` con nivel distinto; `R3:` `MANUAL` sin sugerencia y con sugerencia vigente `INVALID_OUTPUT`/`TIMEOUT`/`FAILED`; `R6:` `CORRECT` igual → `SAME_AS_SUGGESTED`; `R7:` `suggestionId` distinto del vigente, o vigente no `OK` → `NOT_CURRENT_OR_INVALID`; `R8:` `MANUAL` con vigente `OK` → `HAS_VALID_SUGGESTION`. (R1, R2, R3, R6, R7, R8)
- [x] T5 Prueba unitaria + `dto/triage-decision.dto.ts` (D6): `R4:` acción ausente o desconocida, `suggestionId` ausente o no UUID en `VALIDATE`/`CORRECT`, `level` en `VALIDATE`, `suggestionId` o `reason` en `MANUAL`, `reason` en `VALIDATE`, `level` 2.5 o `"2"`, y `decidedAt`/`decidedBy`/`finalLevel`/`tenantId`/`id` → 400; `R5:` `level` 0/6 y motivo ausente, en blanco o de 501 caracteres en `CORRECT` → 422; motivo con espacios alrededor → se recorta; `R20:` campos de hora o responsable → 400. (R4, R5, R20)
- [x] T6 Piezas transversales: `AuditAction` añade `TRIAGE_DECIDED`; `FORBIDDEN_KEYS` añade `finallevel` y `correctionreason` (no `reason`, enmienda 2026-11-09), comprobando que `encounterId` y `action` siguen permitidas; `EncounterEventType` añade `TRIAGE_DECIDED`; `lockForCapture` recibe un `conflictDetail` opcional (por defecto, el texto actual de F-03 y F-04, sin cambiar sus respuestas). Prueba unitaria `R21:` de `assertSafeMetadata`. (R9, R13, R21)
- [x] T7 Pruebas de integración + `TriageSuggestionsService.findCurrent` (exportado desde `AiModule`): devuelve la sugerencia de mayor `created_at`/`id` del tenant y la atención, o `null`; otro tenant → `null`. (R7, R8)
- [x] T8 Pruebas de integración + `EncountersService.recordTriage` (D3): UPDATE condicional a `TRIAGED` con `final_level`, `triaged_at` y `triaged_by`; un solo evento `TRIAGE_DECIDED` (from/to y `payload = { decisionId, action }`); auditoría; 0 filas → 409. `R11:` `transition(…, 'TRIAGED')` sigue respondiendo 409. (R9, R11)
- [x] T9 Pruebas de integración + `TriageDecisionsService.decide` y `POST /encounters/:id/triage-decision` (`@StaffRoles('NURSE')`, `UuidParamPipe`) con la transacción de D2. Las sugerencias se preparan insertándolas como dueño de la base o con un `LlmClient` falso, **nunca con un LLM real**:
  - `R1:`, `R2:`, `R3:` 201 con la forma de R15 y cada columna (`decided_at` del `FixedClock`, `decided_by` y tenant del token).
  - `R9:` estado, `final_level`, `triaged_at`, `triaged_by`, evento y auditoría.
  - `R6:`/`R7:`/`R8:` 422 y 409, sin filas ni cambios.
  - `R12:` segunda decisión → 409 con la primera intacta, y dos simultáneas (`Promise.all`) → exactamente un 201 y un 409.
  - `R13:` 409 en `REGISTERED`, en `CANCELLED` y con una cancelación confirmada antes.
  - `R14:` 404 igual en los tres casos.
  - `R10:` `AuditService` que falla → 500 y todo revertido.
  - Después de decidir, `POST /triage-suggestions` → 409. (R1, R2, R3, R6, R7, R8, R9, R10, R12, R13, R14)
- [x] T10 Pruebas de integración + `GET /encounters/:id/triage-decision` (`@StaffRoles('NURSE', 'PHYSICIAN')`): `R16:` 200 con la decisión (`suggestedLevel` de la sugerencia, `null` en `MANUAL`) y 404 con un `detail` distinto si no hay decisión; `R14:` 404 entre tenants. (R14, R15, R16)
- [x] T11 Pruebas de integración + `EncounterSummaryDto` y su mapeo: `R17:` `GET /encounters` y `GET /encounters/{id}` con `finalLevel`, `triagedAt` y `triagedBy` (`null` antes de decidir) y el evento `TRIAGE_DECIDED` en `events`; `R18:` las respuestas de `/patient/pre-registrations` y `/patient/profile` de un paciente con atención decidida no contienen `finalLevel`, `triagedAt`, `triagedBy`, `level` ni `decision` (búsqueda profunda). (R17, R18)
- [x] T12 Pruebas transversales: `R22:` matriz de roles en los dos endpoints (`RECEPTION`, `ADMIN` y, en el `POST`, `PHYSICIAN` → 403; paciente → 403; sin token → 401), en e2e y en integración (403 sin filas); `R23:` todos los errores en `problem+json` sin eco del motivo ni de los valores; `R21:` captura del logger y lectura de `encounter_events.payload` y `audit_log.metadata`, buscando el motivo y el nivel enviados (no aparecen). (R21, R22, R23)
- [x] T13 Documentación y paso del humano:
  - docs/data-model.md: sección "F-05-api" con `triage_decisions`, las columnas de `encounters`, el `UNIQUE (id, encounter_id)` y los CHECK.
  - docs/architecture.md: módulo `triage`, `recordTriage`, `findCurrent`, `triage → users`.
  - En `progress/current/F-05-api.md` y en `progress/impl_F-05-api.md`, **sin ejecutarlo**:
    - (1) en Supabase, solo lectura: `npx prisma migrate status` y `SELECT count(*) FROM asclepio.encounters WHERE status IN ('TRIAGED','IN_CARE','CLOSED');` (debe ser 0);
    - (2) `DIRECT_URL="<URL directa de Supabase, puerto 5432>" npx prisma migrate deploy`;
    - (3) la comprobación de grants (`triage_decisions`: solo `SELECT` e `INSERT`).

  (R11, R19)
- [x] T14 Regenerar el snapshot OpenAPI: `API_CONTRACT_VERSION = '0.6.0'`, el `oneOf` con discriminador `action` (D6), `TriageDecisionDto`, los campos nuevos de `EncounterSummaryDto` y `TRIAGE_DECIDED` en la descripción de `EncounterEventDto.type`; prueba de contrato (`info.version = 0.6.0` y las dos operaciones); `npm run openapi:export`, comprobando que una segunda ejecución no da diff. El leader fija `contract.version = "0.6.0"` en `feature_list.json`. (R4, R15, R16, R17, R22, R23)
