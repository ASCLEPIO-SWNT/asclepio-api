# F-06-api — Diseño

## Resumen

Se construye la cola priorizada que leen medicina, enfermería y administración, más las dos transiciones que faltaban en la máquina de estados (`TRIAGED → IN_CARE → CLOSED`, por PHYSICIAN). **Sin migraciones**: `final_level` llegó con F-05 y el índice `(tenant_id, status, arrival_at)` de F-02 cubre la consulta.

| Lugar | Qué aporta |
|---|---|
| `common/clock/age.ts` | `ageInYears(birthDate, today)` **se mueve aquí** desde `modules/ai/triage-input.ts`, que pasa a importarlo, para no duplicar la regla del 29 de febrero (D4). |
| `modules/queue/queue.rules.ts` | Pura: `MAX_WAIT_MINUTES_BY_LEVEL` (`{1: 0, 2: 30}`, con la referencia a la Res. 5596 de 2015 y la decisión PA-F06-1), `waitMinutes(arrivalAt, now)`, `isOverdue(level, wait)`, `initials(fullName)` y `buildQueue(rows, now)` → las tres secciones ordenadas. |
| `modules/queue/queue.service.ts` | Lee con `EncountersService.listActiveForQueue` y aplica `buildQueue`. |
| `modules/queue/queue.controller.ts` | `GET /queue` (`@StaffRoles('PHYSICIAN', 'NURSE', 'ADMIN')`), con un DTO de consulta que solo admite `siteId` (UUID). |
| `modules/queue/dto/queue.dto.ts` | `QueueDto`, `QueueItemDto` y `QueuePatientDto` (R2). |
| `modules/queue/queue.module.ts` | Importa `EncountersModule`. Registrado en `AppModule`. |
| `modules/encounters/encounters.service.ts` | **Nuevo** `listActiveForQueue(tenantId, siteId?)` (D2). **Nuevos** `startCare(principal, id)` y `close(principal, id)`: cada uno abre una transacción y llama a `transition(…, 'IN_CARE' \| 'CLOSED', …)`, igual que `cancel`. |
| `modules/encounters/encounters.controller.ts` | `POST :id/start-care` y `POST :id/close` (`@StaffRoles('PHYSICIAN')`, `UuidParamPipe`, `@HttpCode(200)`, cuerpo vacío o `{}`) → `EncounterDto` (R9, R10). |

Dependencias entre módulos: `queue → encounters`, como dice docs/architecture.md. La cola no necesita `triage`, porque el nivel final está en `encounters` (D8 de F-05).

## Decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| D1 | Endpoint propio `GET /queue` con tres secciones y `serverNow`. | Reutilizar `GET /encounters` con filtros y ordenar en el cliente. | AC2 exige un orden específico y AC1 una espera calculada con el reloj del servidor. Además, la cola tiene una forma reducida sin datos personales (AC5), mientras que `GET /encounters` expone el paciente completo. |
| D2 | `listActiveForQueue` hace **una** consulta: `WHERE tenant_id = ? [AND site_id = ?] AND status IN ('WAITING_TRIAGE','TRIAGED','IN_CARE')`, seleccionando solo `id`, `site_id`, nombre de la sede, `status`, `final_level`, `arrival_at` y del paciente `full_name`, `birth_date`, `estimated_age_years` y `sex`. El orden y el cálculo se hacen en memoria (`buildQueue`, puro y probado). | Ordenar en SQL con `CASE` por sección. | El volumen activo de una IPS en el MVP son decenas de filas. La lógica de orden pura es trivial de probar. **Techo conocido:** sin paginación. Si un tenant superara ~1 000 atenciones activas, habría que paginar por sección. |
| D3 | `full_name` sale de `encounters` solo para calcular `initials` y se descarta. El DTO de la cola no tiene ningún campo con el nombre, el documento ni el id del paciente (R7). | Calcular las iniciales en el cliente. | Si se calcularan en el cliente, el nombre completo viajaría por la red y se vería en las herramientas del navegador del puesto (AC5). |
| D4 | La edad usa `ageInYears` movida a `common/clock/age.ts`. `triage-input.ts` (F-04) la importa desde ahí y sus pruebas siguen en verde. | Una segunda copia en `queue`. | Una sola regla de edad en Bogotá. |
| D5 | Tiempos máximos solo para I (0) y II (30) (PA-F06-1, opción (a)). `overdue` solo se calcula en `TRIAGED`. En `WAITING_TRIAGE` no hay nivel todavía y en `IN_CARE` la espera terminó. | Valores provisionales para III–V. | Decisión del humano: no inventar tiempos que la norma deja a cada IPS. |
| D6 | `siteId` de otra IPS o inexistente → 200 con secciones vacías (R6), sin 404. | 404 o 403. | Es un filtro, no un recurso: igual que la bandeja de recepción (F-02), no revela si la sede existe en otro tenant. |
| D7 | `start-care` y `close` son endpoints dedicados sin cuerpo, sobre la transición genérica existente (`transition`, que ya valida la máquina de estados, hace el UPDATE condicional, inserta el evento y la auditoría y responde 409/404). | Un `PATCH /encounters/{id}` con `status`. | Mismo patrón que `cancel`. Cada endpoint declara su rol, y el cliente no puede pedir transiciones arbitrarias. |

## Impacto en contrato

Versión: **0.6.0 → 0.7.0** (menor: tres operaciones nuevas).

- `GET /api/v1/queue?siteId=<uuid>` — `PHYSICIAN`, `NURSE`, `ADMIN`.
  - **200** `QueueDto { serverNow: date-time, waitingTriage: QueueItemDto[], triaged: QueueItemDto[], inCare: QueueItemDto[] }`.
  - `QueueItemDto { encounterId, siteId, siteName, status, finalLevel: int 1–5 | null, arrivalAt: date-time, waitMinutes: int | null, maxWaitMinutes: int | null, overdue: bool, patient: QueuePatientDto }`.
  - `QueuePatientDto { initials: string | null, ageYears: int | null, sex: 'M' | 'F' | 'X' | null }`.
  - **400** (`siteId` no UUID o parámetro desconocido) · **401** · **403**.
- `POST /api/v1/encounters/{id}/start-care` — `PHYSICIAN`. Sin cuerpo. **200** `EncounterDto` · **400** · **401** · **403** · **404** · **409**.
- `POST /api/v1/encounters/{id}/close` — `PHYSICIAN`. Sin cuerpo. **200** `EncounterDto` · **400** · **401** · **403** · **404** · **409**.
- La descripción de la cola documenta los tiempos máximos (I = 0, II = 30, III–V sin alerta; Res. 5596 de 2015).
- Clientes: F-06-web consumirá 0.7.0. Mobile no.

## Impacto en datos

**Sin impacto en datos.** No hay migración. Las transiciones usan `encounter_events` y `audit_log` de la forma que ya existe (`STATUS_CHANGED`, `ENCOUNTER_STATUS_CHANGED`). La consulta usa el índice `(tenant_id, status, arrival_at)`.

## Riesgos y pruebas

**Riesgos:**
- (1) **Espera desde la llegada** (PA-F06-2): para el nivel II, la Res. 5596 habla de atención en 30 min tras el triage. Medir desde la llegada es más estricto y adelanta la alerta. Es una decisión del humano.
  - Modificado por DT-02-api (2026-11-11): desde `triaged_at`, tiempo exacto: la alerta y el orden de `triaged` se miden desde la clasificación (Res. 256 de 2016; specs/DT-02-api/).
- (2) Sin paginación (techo de D2).
- (3) El nivel I aparece como vencido en cuanto pasa 1 minuto en `TRIAGED`, como corresponde a "inmediato".
  - Modificado por DT-02-api (2026-11-11): desde `triaged_at`, tiempo exacto: el nivel I vence en cuanto pasa cualquier tiempo desde la clasificación (specs/DT-02-api/, R3).

**Pruebas unitarias** (`queue.rules.ts`, sin base):
- `waitMinutes` en 59 s → 0, 60 s → 1 y con milisegundos.
- `isOverdue`: I con 0 y 1 min, II con 30 y 31, III–V nunca, y nunca sin nivel.
- `initials`: "maría josé pérez" → "MP", "Ánder" → "A", espacios múltiples, NN → `null`.
- `buildQueue`: reparto por estado, orden por nivel y espera, empates por `id`, `REGISTERED`/`CLOSED`/`CANCELLED` excluidos.
- `ageInYears` (movida; las pruebas de F-04 siguen pasando).

**Pruebas e2e sin base:** matriz de roles (R14) y 400 de parámetros (R6, R12).

**Pruebas de integración (Docker):**
- R1 con atenciones en los seis estados y en dos sedes y dos tenants.
- R3 con `FixedClock`.
- R5, y R6 con sede de otro tenant → secciones vacías.
- R7: búsqueda profunda del nombre, el documento, el id del paciente y el motivo → nada.
- R9–R11 con el evento y la auditoría, también con un cambio concurrente (`Promise.all` de dos `start-care` → un 200 y un 409).
- R12 y R13 (`final_level` intacto tras `close`).
- R15: el logger capturado no contiene el nombre.
