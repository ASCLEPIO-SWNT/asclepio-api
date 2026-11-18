# F-10-api — Posición en la fila y espera estimada del paciente (instantánea + SSE)

Brief global: docs/product/features/F-10.md (AC1–AC4 y AC6; AC5 es de F-10-mobile)
Contrato: produce 0.10.0 (menor: dos operaciones nuevas; parte de 0.9.0)
RNF aplicables: RNF-05, RNF-10, RNF-11, RNF-12, RNF-14
Depende de: F-06-api y DT-02-api (`buildQueue`), F-01-api (token de paciente, `@PatientOnly`).
ADR: 0009 (SSE).

Glosario de la spec:

- **Atención activa del paciente**: la atención del `patientId` del token, en el tenant del token, con estado `WAITING_TRIAGE`, `TRIAGED` o `IN_CARE`. El índice único parcial garantiza que hay a lo sumo una.
- **Fase**:
  - `WAITING_TRIAGE` (estado `WAITING_TRIAGE`);
  - `WAITING_CARE` (`TRIAGED`);
  - `CALLED` (`IN_CARE`);
  - `DONE` (la última atención del paciente pasó a `CLOSED` o `CANCELLED` mientras el stream estaba abierto);
  - `NO_ACTIVE` (no hay atención activa).
- **Posición**: el índice, contando desde 1, de la atención del paciente dentro de la sección `waitingTriage` (fase `WAITING_TRIAGE`) o `triaged` (fase `WAITING_CARE`) de `buildQueue`, calculado sobre las atenciones activas **de su sede** con un único `serverNow`. `aheadCount = posición − 1`. En `CALLED`, `DONE` y `NO_ACTIVE`, ambos son `null`.
- **Salidas de la fase** en la ventana `[serverNow − 4 h, serverNow]`, dentro de la sede:
  - para `WAITING_TRIAGE`, las atenciones con `triaged_at` dentro de la ventana;
  - para `WAITING_CARE`, los `encounter_events` `STATUS_CHANGED` con `to = IN_CARE` y `occurred_at` dentro de la ventana.
- **Estimación** (PA-F10-1, valores provisionales):
  - si hay ≥5 salidas: `intervalo = 240 / salidas` (minutos) y `eta = aheadCount × intervalo`;
  - `minMinutes = floor5(0,5 × eta)` y `maxMinutes = max(5, ceil5(1,5 × eta))`, donde `floor5` y `ceil5` redondean a múltiplos de 5;
  - `estimateBasis = RECENT_THROUGHPUT`;
  - con menos de 5 salidas: `estimate = null` y `estimateBasis = INSUFFICIENT_DATA`.
- **Instantánea**: `{ phase, position, aheadCount, estimate: { minMinutes, maxMinutes } | null, estimateBasis | null, serverNow }`.

## Requisitos

### Instantánea
- **R1** (Por evento) Cuando se reciba `GET /api/v1/patient/queue-position` con un token de paciente, el sistema deberá responder 200 con la instantánea de la atención activa del paciente. (→ F-10.AC1)
- **R2** (Ubicuo) El sistema deberá calcular la posición con la misma función `buildQueue` de F-06/DT-02, limitada a la sede de la atención del paciente, de modo que una atención clasificada con un nivel más urgente quede delante. (→ F-10.AC2)
- **R3** (Ubicuo) El sistema deberá calcular la estimación y `estimateBasis` según el glosario, con las constantes en una única definición en código que cite PA-F10-1. (→ F-10.AC3)
- **R4** (No deseado) Si en la ventana hay menos de 5 salidas de la fase, entonces el sistema deberá devolver `estimate = null` y `estimateBasis = INSUFFICIENT_DATA`. (→ F-10.AC3)
- **R5** (Por estado) Mientras el paciente no tenga atención activa, el sistema deberá responder 200 con `phase = NO_ACTIVE` y `position`, `aheadCount`, `estimate` y `estimateBasis` en `null`. (→ F-10.AC1) (PA-F10-2)
- **R6** (Ubicuo) El sistema deberá excluir de la instantánea los identificadores de atención, sede y paciente, cualquier nivel de triage (también el del propio paciente) y cualquier dato de otros pacientes. (→ F-10.AC6)

### Stream
- **R7** (Por evento) Cuando se reciba `GET /api/v1/patient/queue-position/stream` con un token de paciente, el sistema deberá responder `text/event-stream` y emitir de inmediato un evento `position` con la instantánea. (→ F-10.AC4)
- **R8** (Por evento) Cuando se cree una atención, se registre una decisión de triage o una atención cambie de estado en la sede del paciente, el sistema deberá emitir en el stream, en ≤2 s, la nueva instantánea si difiere de la última emitida. (→ F-10.AC2, F-10.AC4)
- **R9** (Por estado) Mientras el stream esté abierto, el sistema deberá recalcular la instantánea cada 15 s, emitirla solo si cambió y, si no cambió, enviar un comentario SSE de latido. (→ F-10.AC4)
- **R10** (Por evento) Cuando la atención del paciente pase a `CLOSED` o `CANCELLED`, el sistema deberá emitir una instantánea con `phase = DONE` y cerrar el stream. (→ F-10.AC1)
- **R11** (Por evento) Cuando venza el token con el que se abrió el stream, el sistema deberá cerrar el stream. (→ F-10.AC6)

### Autorización y errores
- **R12** (No deseado) Si un token de personal llega a cualquiera de los dos endpoints, entonces el sistema deberá responder 403. Sin token válido deberá responder 401. Ambos en `application/problem+json`. (→ F-10.AC6)
- **R13** (Ubicuo) El sistema deberá obtener la atención solo por el `patientId` y el tenant del token, sin aceptar parámetros de consulta (cualquier parámetro → 400), y deberá excluir de los logs del flujo los datos del paciente. (→ F-10.AC6) (RNF-05, RNF-11)

## Preguntas abiertas
Resueltas el 2026-11-18 por el humano («aprobado» en el chat): se aceptan todas las propuestas.
- [x] PA-F10-1 Constantes de la estimación (4 h, 5 salidas, ×0,5/×1,5, redondeo a 5 min). Propuesta: aceptarlas como provisionales. — bloquea R3, R4
- [x] PA-F10-2 Sin atención activa (prerregistro pendiente): `NO_ACTIVE` sin posición. Propuesta: aceptar. — bloquea R5
