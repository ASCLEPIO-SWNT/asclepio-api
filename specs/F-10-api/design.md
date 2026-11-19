# F-10-api — Diseño

## Resumen

Hay un módulo nuevo, `patient-queue`, que calcula la posición del paciente reutilizando `buildQueue` y la publica como instantánea y como stream SSE. **No hay migraciones.**

| Lugar | Qué aporta |
|---|---|
| `modules/patient-queue/estimate.rules.ts` | Pura: `ESTIMATE = { windowMinutes: 240, minExits: 5, low: 0.5, high: 1.5, roundTo: 5 }` (comentario PA-F10-1), `estimateWait(aheadCount, exits)` y `positionOf(queue, encounterId)` → `{ phase, position, aheadCount }`. |
| `modules/patient-queue/patient-queue.service.ts` | `snapshot(principal)`: busca la atención activa del paciente → `EncountersService.listActiveForQueue(tenant, siteId)` → `buildQueue` → `positionOf` → `EncountersService.countPhaseExits(...)` → `estimateWait`. `stream(principal)`: un `Observable<MessageEvent>` (ver D3). |
| `modules/patient-queue/patient-queue.controller.ts` | `GET /patient/queue-position` y `@Sse() GET /patient/queue-position/stream`, ambos con `@PatientOnly()`. |
| `modules/patient-queue/dto/patient-queue.dto.ts` | `QueuePositionDto`, `WaitEstimateDto`. |
| `modules/encounters/encounters.service.ts` | **Nuevo** `findActiveForPatient(tenantId, patientId)` → `{ id, siteId, status } \| null`. **Nuevo** `countPhaseExits(tenantId, siteId, phase, since)`. **Nuevo** `changes$: Observable<{ tenantId, siteId }>` (un `Subject` interno), que se emite **después del commit** en `createInTx`, `transition` y el paso a `TRIAGED`. |

Dependencias: `patient-queue → encounters, queue` (solo la función pura `buildQueue`). No toca tablas de otros módulos.

## Decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| D1 | SSE con `@Sse()` (ADR 0009). | Polling o WebSockets. | Decisión del humano (2026-11-18). Es unidireccional y no trae dependencias nuevas. |
| D2 | La posición sale de `buildQueue` sobre las activas de la sede. | Un `ORDER BY` propio en SQL. | Una sola regla de orden para el personal y el paciente (F-10.AC2). Techo conocido: el cálculo es en memoria, igual que F-06 D2. |
| D3 | Stream = `merge(of(inicio), changes$.filter(misma sede).debounceTime(1000), interval(15000))` → `switchMap(snapshot)` → emite solo si cambió (comparando el JSON sin `serverNow`), y si no, un latido. Se cierra con `takeUntil(timer(exp − now))` y al llegar a `DONE`. | Recalcular solo cada N s. | Cumple ≤2 s tras el cambio (R8), y el intervalo de 15 s cubre los eventos perdidos. `ponytail:` bus en memoria de un solo proceso; con varias instancias, `LISTEN/NOTIFY`. |
| D4 | Estimación por throughput reciente de la fase y la sede. | Promedio de atención por nivel × pacientes delante. | No se sabe cuántos profesionales atienden en paralelo; el throughput lo refleja. El orden por nivel ya está en `aheadCount`. Hay un fallback explícito `INSUFFICIENT_DATA`. |
| D5 | El paciente **no** recibe su nivel (R6). | Mostrarlo. | Se mantiene ADR 0008 / F-02: el DTO del paciente oculta el nivel. |
| D6 | `DONE` se detecta cuando, en el recálculo, el paciente ya no tiene activa la atención con la que abrió el stream. | Un evento específico. | Usa la misma ruta de recálculo y no añade estado. |

## Impacto en contrato

Versión: **0.9.0 → 0.10.0** (menor: dos operaciones nuevas).

- `GET /api/v1/patient/queue-position`, solo paciente.
  - **200** `QueuePositionDto`:
    - `phase`: `NO_ACTIVE` | `WAITING_TRIAGE` | `WAITING_CARE` | `CALLED` | `DONE`
    - `position`: int ≥ 1 | null
    - `aheadCount`: int ≥ 0 | null
    - `estimate`: `WaitEstimateDto` | null, con `WaitEstimateDto { minMinutes: int, maxMinutes: int }`
    - `estimateBasis`: `RECENT_THROUGHPUT` | `INSUFFICIENT_DATA` | null
    - `serverNow`: date-time
  - **400** (parámetro de consulta) · **401** · **403**.
- `GET /api/v1/patient/queue-position/stream`, solo paciente. **200** `text/event-stream` con eventos `event: position`, cuyo `data` es un `QueuePositionDto`, y comentarios de latido. Errores **401** y **403** antes de abrir el stream.
- Cliente: F-10-mobile consume 0.10.0.

## Impacto en datos

**Sin impacto en datos.** Usa `encounters.triaged_at`, `encounter_events` (`STATUS_CHANGED → IN_CARE`) y el índice `(tenant_id, status, arrival_at)`. Solo lectura.

## Riesgos y pruebas
- **Unitarias** (`estimate.rules.spec.ts`): fases, posición, empates, frontera de 4/5 salidas, redondeo y mínimo de 5.
- **Integración** (Docker local):
  - reordenamiento al clasificar a otro paciente con un nivel más urgente;
  - privacidad: el paciente B nunca ve la atención de A, y no aparece ningún id ni nivel en la búsqueda profunda;
  - `countPhaseExits` por sede.
- **e2e:** el stream emite la instantánea inicial, emite en ≤2 s tras una transición, envía el latido con un reloj falso y se cierra al vencer el token y en `DONE`.
- **Riesgo:** conexiones SSE que el proxy deja colgadas. Se mitiga con el latido de 15 s.
