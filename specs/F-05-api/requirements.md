# F-05-api — Validar, corregir o clasificar manualmente (decisión de triage)

Brief global: docs/product/features/F-05.md (F-05.AC1–AC6; el AC7 es de F-05-web)
Contrato: produce 0.6.0 (menor: endpoints nuevos y campos nuevos opcionales; parte de 0.5.0)
RNF aplicables: RNF-01, RNF-02, RNF-03, RNF-05, RNF-10, RNF-11, RNF-12, RNF-14, RNF-16, RNF-17
Depende de: F-04-api (`triage_suggestions`, `TriageSuggestionsService`), F-02-api (`EncountersService`, `encounter_events`).
Decisiones humanas de partida: PA-F05-1..3 y las dos reglas adicionales (sugerencia vigente y MANUAL sin sugerencia válida), aprobadas por el humano el 2026-11-09 por chat ("aprobado").

Glosario de la spec:

- **Hora del servidor**: el valor de `Clock.now()` (RNF-10).
- **Decisión**: una fila de `triage_decisions`. Como mucho **una por atención** (PA-F05-1: sin re-triage en el MVP).
- **Sugerencia vigente**: la sugerencia de la atención con mayor `created_at` y después mayor `id` (R21 de F-04-api), o ninguna si la atención no tiene sugerencias.
- **Sugerencia válida**: una sugerencia con `status = OK` (por tanto, con `suggested_level`).
- **Nivel sugerido**: el `suggested_level` de la sugerencia, **ya ajustado por los SafetyGuards** (PA-F05-3).
- **Acciones**:
  - `VALIDATE`: acepta el nivel sugerido de la sugerencia vigente válida.
  - `CORRECT`: fija un nivel 1–5 **distinto** del nivel sugerido de la sugerencia vigente válida, con motivo.
  - `MANUAL`: fija un nivel 1–5 cuando **no hay sugerencia vigente válida** (no hay ninguna, o la vigente no es `OK`).
- **Motivo de corrección** (PA-F05-2): texto libre de 1 a 500 caracteres sin contar espacios iniciales y finales, obligatorio solo en `CORRECT`.
- **Rol que decide**: `NURSE`. **Roles de lectura de la decisión**: `NURSE` y `PHYSICIAN`.
- **Respuesta de error**: `application/problem+json` (RFC 9457) sin repetir en `detail` ni en `errors[].message` los valores enviados ni el motivo.

## Requisitos

### Registrar la decisión

- **R1** (Por evento) Cuando se reciba `POST /api/v1/encounters/{id}/triage-decision` con un token de `NURSE`, una atención del tenant del token en `WAITING_TRIAGE` sin decisión y un cuerpo `{ action: "VALIDATE", suggestionId }` cuyo `suggestionId` sea el de la sugerencia vigente y esta sea válida, el sistema deberá registrar la decisión con `level` = nivel sugerido de esa sugerencia, `suggestion_id`, `reason = NULL`, `decided_by` = usuario autenticado y `decided_at` = hora del servidor, y responder 201 con la decisión en la forma de R15. (→ F-05.AC1, F-05.AC2) (decidido en PA-F05-3)
- **R2** (Por evento) Cuando el cuerpo sea `{ action: "CORRECT", suggestionId, level, reason }` con las mismas condiciones de R1 sobre la sugerencia, un `level` entero 1–5 distinto del nivel sugerido y un motivo de corrección válido, el sistema deberá registrar la decisión con ese `level`, `suggestion_id` y el motivo sin espacios iniciales ni finales, con `decided_by` y `decided_at` como en R1, y responder 201. (→ F-05.AC1, F-05.AC2) (decidido en PA-F05-2)
- **R3** (Por evento) Cuando el cuerpo sea `{ action: "MANUAL", level }` con un `level` entero 1–5 y la atención no tenga sugerencia vigente válida, el sistema deberá registrar la decisión con ese `level`, `suggestion_id = NULL`, `reason = NULL` y `decided_by` y `decided_at` como en R1, y responder 201. (→ F-05.AC1, F-05.AC2)
- **R4** (No deseado) Si el cuerpo no es uno de los tres de R1–R3 (acción desconocida o ausente, `suggestionId` que no es UUID o falta en `VALIDATE`/`CORRECT`, `level` en `VALIDATE`, `suggestionId` en `MANUAL`, `reason` en `VALIDATE` o `MANUAL`, `level` no entero o ausente (o `null`) en `CORRECT`/`MANUAL` [enmienda 2026-11-09], o cualquier campo no declarado como `decidedAt`, `decidedBy`, `finalLevel`, `tenantId` o `id`), entonces el sistema deberá responder 400 con la respuesta de error y el campo en `errors[]`, sin registrar nada. (→ F-05.AC1, F-05.AC2)
- **R5** (No deseado) Si en `CORRECT` o `MANUAL` el `level` está fuera de 1–5, o en `CORRECT` el motivo falta, solo tiene espacios o supera 500 caracteres, entonces el sistema deberá responder 422 con la respuesta de error y el campo en `errors[]`, sin registrar nada. (→ F-05.AC1) (decidido en PA-F05-2)
- **R6** (No deseado) Si en `CORRECT` el `level` es igual al nivel sugerido de la sugerencia, entonces el sistema deberá responder 422 con la respuesta de error y `level` en `errors[]`, sin registrar nada. (→ F-05.AC1)
- **R7** (No deseado) Si en `VALIDATE` o `CORRECT` el `suggestionId` no es el de la sugerencia vigente de la atención (no existe, es de otra atención o de otro tenant, o hay una más reciente) o la sugerencia vigente no es válida, entonces el sistema deberá responder 409 con la respuesta de error y un `detail` constante "la sugerencia no es la vigente o no es válida", sin registrar nada. (→ F-05.AC1) (regla adicional aprobada: sugerencia vigente)
- **R8** (No deseado) Si en `MANUAL` la atención tiene una sugerencia vigente válida, entonces el sistema deberá responder 409 con la respuesta de error y un `detail` constante que indique que hay una sugerencia válida que se debe validar o corregir, sin registrar nada. (→ F-05.AC1) (regla adicional aprobada: MANUAL solo sin sugerencia válida)

### Efectos sobre la atención

- **R9** (Por evento) Cuando se registre una decisión, el sistema deberá, en la misma transacción, pasar la atención de `WAITING_TRIAGE` a `TRIAGED` con un UPDATE condicional sobre ese estado, fijar `final_level` = nivel decidido, `triaged_at` = `decided_at` y `triaged_by` = `decided_by`, insertar un `encounter_events` de tipo `TRIAGE_DECIDED` (`from_status = WAITING_TRIAGE`, `to_status = TRIAGED`, `payload = { decisionId, action }`, `actor_type = STAFF`, `actor_id`, `occurred_at = decided_at`) y una fila en `audit_log` con `action = TRIAGE_DECIDED`, `entity = triage_decisions`, `entity_id` = id de la decisión y `metadata = { encounterId, action }`. (→ F-05.AC3, F-05.AC6)
- **R10** (No deseado) Si falla cualquiera de las escrituras de R9 o la inserción de la decisión, entonces el sistema deberá revertir toda la transacción (sin decisión, atención sin cambios, sin evento ni auditoría) y responder 500 con la respuesta de error. (→ F-05.AC3, F-05.AC6)
- **R11** (Ubicuo) El sistema deberá garantizar que ninguna atención tenga `final_level`, `triaged_at` ni `triaged_by` sin una fila en `triage_decisions`: la única vía que los fija es R9, la transición genérica de `EncountersService` deberá seguir rechazando el paso a `TRIAGED`, y la base deberá exigir con un CHECK que `final_level`, `triaged_at` y `triaged_by` sean todos nulos o todos no nulos, y no nulos cuando el estado es `TRIAGED`, `IN_CARE` o `CLOSED`. (→ F-05.AC3) (RNF-03)

### Unicidad y estado

- **R12** (No deseado) Si la atención ya tiene una decisión, entonces el sistema deberá responder 409 con la respuesta de error sin modificar la decisión existente ni la atención, también cuando dos decisiones sobre la misma atención llegan a la vez (exactamente una responde 201 y la otra 409). (→ F-05.AC5) (decidido en PA-F05-1)
- **R13** (No deseado) Si la atención está en un estado distinto de `WAITING_TRIAGE` y no tiene decisión (`REGISTERED` o `CANCELLED`), o se cancela antes de que se confirme la decisión, entonces el sistema deberá responder 409 con la respuesta de error sin registrar nada. (→ F-05.AC3)
- **R14** (No deseado) Si el id de la atención no existe, es de otro tenant o está mal formado, entonces el sistema deberá responder 404 con la misma respuesta de error en los tres casos, tanto en el `POST` como en el `GET` de R16, sin registrar nada. (→ F-05.AC1)

### Lectura

- **R15** (Ubicuo) El sistema deberá representar una decisión con `id`, `encounterId`, `action`, `level`, `suggestionId` (o `null`), `suggestedLevel` (el nivel sugerido de la sugerencia, o `null` en `MANUAL`), `reason` (o `null`), `decidedAt` y `decidedBy` `{ id, fullName }`. (→ F-05.AC1, F-05.AC2)
- **R16** (Por evento) Cuando se reciba `GET /api/v1/encounters/{id}/triage-decision` con un token de un rol de lectura de la decisión y una atención del tenant del token, el sistema deberá responder 200 con la decisión en la forma de R15, o 404 con un `detail` constante distinto del de R14 si la atención existe pero no tiene decisión. (→ F-05.AC1, F-05.AC2)
- **R17** (Ubicuo) El sistema deberá incluir en las respuestas de personal de `GET /api/v1/encounters` y `GET /api/v1/encounters/{id}` los campos `finalLevel` (entero 1–5 o `null`), `triagedAt` (fecha-hora o `null`) y `triagedBy` (`{ id, fullName }` o `null`), y en `GET /api/v1/encounters/{id}` el evento `TRIAGE_DECIDED` en `events` con su payload, actor, `fromStatus`/`toStatus` y `occurredAt`. (→ F-05.AC3, F-05.AC6)
- **R18** (Ubicuo) El sistema no deberá exponer `final_level`, `triaged_at`, `triaged_by` ni la decisión en ningún endpoint del paciente (`/patient/...`): el paciente sigue viendo solo el estado. (→ F-05.AC3) (PA-PAC-4)

### Inmutabilidad y privacidad

- **R19** (Ubicuo) El sistema deberá conectarse con el rol `asclepio_app`, que sobre `triage_decisions` solo tiene `SELECT` e `INSERT`, de modo que un `UPDATE` o un `DELETE` con ese rol falle con `42501`. Toda FK desde `triage_decisions` deberá ser `ON DELETE RESTRICT ON UPDATE RESTRICT`. La base deberá impedir con restricciones una segunda decisión por atención, una sugerencia de otra atención, `MANUAL` con sugerencia, `VALIDATE`/`CORRECT` sin sugerencia, `CORRECT` sin motivo y motivo en `VALIDATE`/`MANUAL`. (→ F-05.AC2, F-05.AC5) (RNF-02)
- **R20** (Ubicuo) El sistema deberá ignorar o rechazar (R4) cualquier hora o responsable enviados por el cliente: `decided_at` y `triaged_at` salen del reloj del servidor, y `decided_by`, `triaged_by` y el tenant, del token. (→ F-05.AC2) (RNF-10)
- **R21** (Ubicuo) El sistema deberá excluir el motivo de corrección y el nivel de `encounter_events.payload`, de `audit_log.metadata` y de los logs del flujo de F-05. (→ F-05.AC6) (RNF-05)

### Autorización y errores

- **R22** (No deseado) Si un token de personal con rol distinto de `NURSE` llega al `POST`, un token con rol distinto de `NURSE` o `PHYSICIAN` llega al `GET`, o un token de paciente llega a cualquiera de los dos, entonces el sistema deberá responder 403 con la respuesta de error sin registrar nada. Sin token válido deberá responder 401. (→ F-05.AC4)
- **R23** (Ubicuo) El sistema deberá responder todos los errores de los endpoints de F-05 en `application/problem+json`, sin repetir en `detail` ni en `errors[].message` los valores enviados ni el motivo. (→ F-05.AC1)

> Trazabilidad por criterio: AC1 → R1–R8, R14–R16, R23 · AC2 → R1–R4, R15, R16, R19, R20 · AC3 → R9–R11, R13, R17, R18 · AC4 → R22 · AC5 → R12, R19 · AC6 → R9, R10, R17, R21.

## Preguntas abiertas

- [x] **PA-F05-1** ¿Re-triage? → Humano, 2026-11-09: no en el MVP; una segunda decisión responde 409. Cubierto por R12 y R19.
- [x] **PA-F05-2** ¿Motivo de corrección? → Humano, 2026-11-09: texto libre obligatorio de 1 a 500 caracteres, sin catálogo. Cubierto por R2, R5 y R21.
- [x] **PA-F05-3** ¿`VALIDATE` usa el nivel ajustado por el guard? → Humano, 2026-11-09: sí, `VALIDATE` toma el `suggested_level` (ya ajustado). Validar el nivel del LLM sin ajustar desharía la protección del guard. Cubierto por R1 y R15.
- [x] **Regla adicional 1** (humano, 2026-11-09): `VALIDATE` y `CORRECT` solo sobre la sugerencia vigente y válida; si no, 409. Cubierto por R7.
- [x] **Regla adicional 2** (humano, 2026-11-09): `MANUAL` solo si no hay sugerencia vigente válida; si la hay, quien discrepe usa `CORRECT`, que exige motivo y entra en la concordancia de F-07. Cubierto por R8.
