# F-05-api — Diseño

## Resumen

Enfermería fija el nivel final con una decisión explícita: validar o corregir la sugerencia vigente, o clasificar manualmente cuando no hay sugerencia válida. La decisión se guarda en `triage_decisions` (una por atención). En la **misma transacción**, la atención pasa a `TRIAGED` con `final_level`, `triaged_at` y `triaged_by`, y se insertan un evento `TRIAGE_DECIDED` y la auditoría. Es la única vía hacia `TRIAGED` (RNF-03).

| Lugar | Qué aporta |
|---|---|
| `modules/triage/triage-decision.rules.ts` | Pura: `decide(input, currentSuggestion)` → `{ level, suggestionId, reason }` o un error tipado (`NOT_CURRENT_OR_INVALID` → 409 R7, `HAS_VALID_SUGGESTION` → 409 R8, `SAME_AS_SUGGESTED` → 422 R6). Sin Nest ni Prisma. |
| `modules/triage/triage-decisions.service.ts` | Orquesta la transacción (D2), inserta la decisión y lista. Único usuario de `triage_decisions`. |
| `modules/triage/triage-decisions.controller.ts` | `POST /encounters/:id/triage-decision` (`@StaffRoles('NURSE')`) y `GET` (`@StaffRoles('NURSE', 'PHYSICIAN')`), con `UuidParamPipe`. |
| `modules/triage/dto/triage-decision.dto.ts` | DTO de petición con unión discriminada por `action` (R4, D6) y DTO de respuesta (R15). |
| `modules/triage/triage.module.ts` | Importa `EncountersModule`, `AiModule`, `AuditModule` y `UsersModule`. Registrado en `AppModule`. |
| `modules/encounters/encounters.service.ts` | **Nuevo** `recordTriage(tenantId, id, { level, decisionId, action, actor, now }, tx)` (D3), y `lockForCapture` recibe un `conflictDetail` opcional (D2). `transition` sigue rechazando `TRIAGED`. |
| `modules/encounters/encounter-events.service.ts` | `EncounterEventType` añade `TRIAGE_DECIDED`. |
| `modules/encounters/dto/encounters.dto.ts` y su mapeo | `EncounterSummaryDto` añade `finalLevel`, `triagedAt` y `triagedBy` (R17). Los DTO del paciente no cambian (R18). |
| `modules/ai/triage-suggestions.service.ts` + `ai.module.ts` | **Nuevo** `findCurrent(tenantId, encounterId, tx)` → `{ id, status, suggestedLevel } \| null` (sugerencia vigente, R21 de F-04). **Nuevo** `findSuggestedLevel(tenantId, suggestionId)` → `number \| null` para el GET (R15/R16): por la carrera de D4 la vigente puede no ser la decidida (enmienda 2026-11-09). `AiModule` exporta `TriageSuggestionsService`. |
| `modules/audit` | `AuditAction` añade `TRIAGE_DECIDED`. `FORBIDDEN_KEYS` añade `finallevel` y `correctionreason` (`level` ya está desde F-04). **No** añade `reason`: F-01 la usa en `AUTH_LOGIN_FAILED` (enmienda 2026-11-09). |

Dependencias entre módulos: `triage → encounters, ai, audit, users`, como dice la tabla de docs/architecture.md, más `users` (nombre del responsable, igual que `ai`). `triage` no escribe en tablas de `encounters` ni de `ai`: usa sus services.

## Decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| D1 | Recurso **singular** `/encounters/{id}/triage-decision` (`POST` y `GET`), porque hay como mucho una decisión por atención (PA-F05-1). | Colección `/triage-decisions`. | Refleja la cardinalidad. El `GET` devuelve el objeto o 404 (R16) en lugar de una lista de 0–1 elementos. |
| D2 | Transacción única, en este orden:<br>(1) `lockForCapture(tenantId, id, now, tx, conflictDetail)` bloquea la atención en `WAITING_TRIAGE`, con 404 si no existe en el tenant (R14). Si da 409, se consulta `triage_decisions`: si existe una decisión, el 409 dice "ya tiene una decisión" (R12); si no, "no está en espera de triage" (R13).<br>(2) `ai.findCurrent(…, tx)`.<br>(3) `decide(…)` aplica R6–R8.<br>(4) INSERT en `triage_decisions`; si el índice único de `encounter_id` salta (P2002), 409 de R12.<br>(5) `encounters.recordTriage(…)`, con evento y auditoría (R9).<br>Cualquier error revierte todo (R10). | Validar fuera de la transacción y escribir dentro. | El bloqueo serializa dos decisiones simultáneas (R12) y una cancelación concurrente (R13). El índice único es la segunda barrera. |
| D3 | `recordTriage` hace un UPDATE condicional `WHERE id AND tenant_id AND status = 'WAITING_TRIAGE'` con `status = TRIAGED`, `final_level`, `triaged_at = now` y `triaged_by` (0 filas → 409). Inserta un **solo** evento `TRIAGE_DECIDED` (from `WAITING_TRIAGE`, to `TRIAGED`, `payload = { decisionId, action }`) y la auditoría `TRIAGE_DECIDED` (`entity = triage_decisions`, `metadata = { encounterId, action }`). Es exportado, pero solo lo llama `TriageDecisionsService`, y recibe el `decisionId` ya insertado. | `transition(…, 'TRIAGED')` más un evento aparte. | `transition` prohíbe `TRIAGED` a propósito (R34 de F-02). Un evento con from/to muestra el cambio de estado en la línea de tiempo sin duplicar `STATUS_CHANGED`. Las columnas de `encounters` las escribe su dueño. |
| D4 | La sugerencia vigente se lee **dentro** de la transacción, pero F-04 inserta sugerencias sin bloquear la atención (D6 de F-04). Si se inserta una sugerencia nueva justo después de leer la vigente, la decisión se basa en la que era vigente al decidir. | Bloquear también las inserciones de F-04. | La carrera exige que dos enfermeras actúen a la vez sobre el mismo paciente con ~20 s de LLM de por medio. La decisión queda trazada con su `suggestion_id`, y F-04 ya responde 409 en cuanto la atención está `TRIAGED`. Se documenta como riesgo. |
| D5 | Orden de errores: **400** (forma del cuerpo, R4) → **422** del cuerpo (rango de `level`, motivo, R5) → **404** (R14) → **409** (estado o decisión previa, R12–R13) → **409** de la sugerencia (R7–R8) → **422** `SAME_AS_SUGGESTED` (R6, que necesita leer la sugerencia). | Un único 422 tras leer todo. | Lo que se valida con el cuerpo solo no toca la base. Es el mismo orden que F-03 (que ya da 422 antes de 404, observación del reviewer de F-03). |
| D6 | DTO de petición: `class-validator` con un campo `action` (`IsIn`) y validación condicional (`ValidateIf`) por acción. `forbidNonWhitelisted` rechaza campos de más, y los campos que sobran para la acción elegida (por ejemplo `level` en `VALIDATE`) se rechazan explícitamente con 400. En OpenAPI se describe como `oneOf` de tres esquemas con discriminador `action`. | Tres endpoints (`/validate`, `/correct`, `/manual`). | Un solo recurso con discriminador refleja que son tres variantes de la misma decisión. |
| D7 | Restricciones en la base (R19):<br>· único `(encounter_id)`;<br>· FK compuesta `(encounter_id, tenant_id) → encounters(id, tenant_id)`;<br>· **FK compuesta `(suggestion_id, encounter_id) → triage_suggestions(id, encounter_id)`**, que necesita un `UNIQUE (id, encounter_id)` nuevo en `triage_suggestions`;<br>· CHECK `(action = 'MANUAL') = (suggestion_id IS NULL)`;<br>· CHECK `(action = 'CORRECT') = (reason IS NOT NULL)`;<br>· CHECK `char_length(btrim(reason)) BETWEEN 1 AND 500`;<br>· CHECK `level BETWEEN 1 AND 5`.<br>Que `VALIDATE` coincida con el nivel sugerido y que `CORRECT` sea distinto se garantiza **en código** (R1, R6) y con pruebas. | Comprobar todo solo en código. | La FK compuesta impide en la base una decisión con la sugerencia de otra atención. Comparar el nivel con la sugerencia exigiría un trigger: se deja en código. |
| D8 | Columnas nuevas en `encounters`: `final_level smallint NULL` (CHECK 1–5), `triaged_at timestamptz NULL` y `triaged_by uuid NULL → users` (RESTRICT). CHECK de coherencia: los tres nulos o los tres no nulos, y no nulos si `status IN ('TRIAGED', 'IN_CARE', 'CLOSED')`. Una atención `CANCELLED` puede tenerlos o no, según si se canceló antes o después de decidir. | Leer el nivel final de `triage_decisions` con un JOIN. | F-06 y F-07 consultan `final_level` por atención sin cruzar módulos (el modelo de datos ya lo preveía). El CHECK refuerza RNF-03 en la base. |
| D9 | La respuesta 201 devuelve **solo la decisión** (R15). El cliente vuelve a leer la atención si necesita el nuevo estado. | Devolver la atención completa. | Cada recurso tiene su forma, y el `GET /encounters/{id}` ya trae `finalLevel` y el evento (R17). |
| D10 | Los endpoints `/patient/...` no cambian y una prueba lo verifica (R18): el paciente ve el estado `TRIAGED` con la etiqueta que ya tenga, sin nivel. | — | PA-PAC-4. |

## Impacto en contrato

Versión: **0.5.0 → 0.6.0** (menor: operaciones nuevas y campos nuevos de solo lectura).

- `POST /api/v1/encounters/{id}/triage-decision` — `NURSE`. Cuerpo `TriageDecisionRequest`, que es uno de:
  - `{ action: 'VALIDATE', suggestionId: uuid }`
  - `{ action: 'CORRECT', suggestionId: uuid, level: 1–5, reason: string(1–500) }`
  - `{ action: 'MANUAL', level: 1–5 }`

  Respuestas: **201** `TriageDecisionDto` · **400** · **401** · **403** · **404** · **409** (ya decidida; fuera de `WAITING_TRIAGE`; sugerencia no vigente o no válida; hay sugerencia válida en `MANUAL`) · **422** (`level` fuera de rango, motivo inválido, `CORRECT` igual al sugerido) · **500**.
- `GET /api/v1/encounters/{id}/triage-decision` — `NURSE`, `PHYSICIAN`. **200** `TriageDecisionDto` · **401** · **403** · **404** (atención no encontrada, o sin decisión con un `detail` distinto).
- `TriageDecisionDto`: `id`, `encounterId`, `action` (`TriageDecisionAction`: `VALIDATE` | `CORRECT` | `MANUAL`), `level` (int 1–5), `suggestionId` (uuid \| null), `suggestedLevel` (int 1–5 \| null), `reason` (string \| null), `decidedAt` (date-time) y `decidedBy` (`{ id, fullName }`).
- `EncounterSummaryDto` (y por herencia `EncounterDto`): añade `finalLevel` (int 1–5 \| null), `triagedAt` (date-time \| null) y `triagedBy` (`{ id, fullName }` \| null). La descripción de `EncounterEventDto.type` añade `TRIAGE_DECIDED`.
- Los esquemas del paciente no cambian.
- Clientes: F-05-web consumirá 0.6.0. F-04-web (0.5.0) no se rompe: los campos son aditivos.

## Impacto en datos

**Sí, dos migraciones** creadas con `--create-only` contra el Docker local (ADR 0003).

1. `f05_triage_decisions`:
   - enum `triage_decision_action` (`VALIDATE`, `CORRECT`, `MANUAL`).
   - tabla `triage_decisions`: `id uuid PK`, `tenant_id uuid NOT NULL`, `encounter_id uuid NOT NULL UNIQUE`, `suggestion_id uuid NULL`, `action triage_decision_action NOT NULL`, `level smallint NOT NULL`, `reason text NULL`, `decided_by uuid NOT NULL → users` y `decided_at timestamptz NOT NULL` (lo asigna la API).
   - FKs **RESTRICT/RESTRICT**: `tenant_id → tenants`, `(encounter_id, tenant_id) → encounters(id, tenant_id)`, `(suggestion_id, encounter_id) → triage_suggestions(id, encounter_id)` y `decided_by → users`.
   - `triage_suggestions`: `UNIQUE (id, encounter_id)` nuevo, que es el destino de la FK compuesta (tabla de `ai`; no cambia sus datos).
   - `encounters`: columnas `final_level`, `triaged_at` y `triaged_by` (FK RESTRICT a `users`) y los CHECK de D8.
   - CHECK de D7 (SQL manual al final).
   - Antes de aplicar en Supabase, el humano comprueba en **solo lectura** que no hay atenciones en `TRIAGED`/`IN_CARE`/`CLOSED` (`SELECT count(*) … WHERE status IN (…)` = 0), porque si las hubiera el CHECK de D8 fallaría. No debería haberlas: hasta ahora era imposible llegar a esos estados.
2. `f05_app_role_grants`: `GRANT SELECT, INSERT ON asclepio.triage_decisions TO asclepio_app;` sin `UPDATE`, `DELETE` ni `TRUNCATE`. `encounters` ya tiene `UPDATE` a nivel de tabla (f02), así que las columnas nuevas no necesitan grant.

Inmutabilidad: `triage_decisions` solo admite inserciones. `encounters` se actualiza siempre junto con su evento y su auditoría (docs/data-model.md). Tiempo: `decided_at = triaged_at` = hora del servidor (RNF-10).

## Riesgos y pruebas

**Riesgos:**
- (1) La carrera de D4: una sugerencia nueva insertada justo después de decidir no cambia la decisión.
- (2) Sin re-triage: un error de clasificación no se corrige en el sistema en el MVP (PA-F05-1). El paciente se reclasifica fuera del sistema. Se anota para después del MVP.
- (3) El CHECK de D8 puede fallar al aplicar la migración en Supabase si alguien forzó estados a mano. Hay una comprobación previa en solo lectura (T13).

**Pruebas unitarias:**
- `triage-decision.rules.ts` (pura): cada acción con sugerencia vigente `OK`, no `OK` y ausente; `suggestionId` distinto del vigente; `CORRECT` igual al sugerido; `VALIDATE` toma el `suggested_level` ajustado por un guard (R1, PA-F05-3).
- DTO: `R4:` cada combinación inválida de campos por acción; `R5:` rangos y motivo (en blanco, 501 caracteres, recortado).
- `assertSafeMetadata` con `correctionReason` y `finalLevel` (R21); `reason` sigue admitida por F-01. R21 se garantiza porque F-05 solo escribe `{ decisionId, action }` y `{ encounterId, action }`.

**Pruebas e2e sin base:** 401/403 y matriz de roles (R22); 400 (R4).

**Pruebas de integración (Docker):**
- R1–R3 felices, con todas las columnas y el estado de la atención (R9); R6–R8; R12 secuencial y **simultánea** (`Promise.all` → un 201 y un 409); R13 en `REGISTERED`, `CANCELLED` y con cancelación concurrente; R14 (404 igual en los tres casos); R10 con `AuditService` que falla; R11 (`transition` a `TRIAGED` sigue en 409 y los CHECK de `encounters`); R16; R17 (lista y detalle con `finalLevel` y el evento); R18 (endpoints del paciente sin nivel); R19 (`42501`, FKs y CHECK, incluida la FK compuesta con una sugerencia de otra atención); R20 (campos de hora en el cuerpo → 400); R21 (logger capturado: no aparecen el motivo ni el nivel).
- F-04 después de decidir: `POST /triage-suggestions` → 409 (R2 de F-04 sigue en verde).
