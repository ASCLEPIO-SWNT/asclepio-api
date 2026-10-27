# F-03-api — Captura clínica: signos vitales, síntomas y hallazgos, y motivo de consulta

Brief global: docs/product/features/F-03.md (F-03.AC1–AC4; el AC5 es de F-03-web)
Contrato: produce 0.4.0 (menor: endpoints nuevos; parte de 0.3.0)
RNF aplicables: RNF-01, RNF-02, RNF-05, RNF-10, RNF-11, RNF-12, RNF-14, RNF-16
Depende de: F-02-api (atenciones en `WAITING_TRIAGE`, `encounter_events`, `EncountersService`).
Decisiones humanas de partida: PA-F03-1, PA-F03-3 y PA-F03-4 (humano, 2026-10-27, por chat); PA-F03-2 (leader por delegación del humano, 2026-10-27, por chat).

Glosario de la spec:

- **Hora del servidor**: el valor de `Clock.now()` (RNF-10); nunca una hora enviada por el cliente.
- **Toma**: un conjunto de signos vitales medidos a la vez; se guarda como **una fila** de `vital_signs`.
- **Lista de signos aceptada** (PA-F03-1, **PROVISIONAL — no validada clínicamente, revisar con asesor clínico**): los campos, unidades, tipos y carácter obligatorio u opcional de la tabla de design.md D3, que vive en el código en una sola definición (`VITAL_SIGN_DEFINITIONS`). Obligatorios en cada toma: `respiratoryRate`, `oxygenSaturation`, `supplementalOxygen`, `systolicBp`, `heartRate`, `consciousness` y `temperatureC`. Opcionales: `diastolicBp` y `glucoseMgDl`.
- **Rango admitido de un signo** (PA-F03-2, **PROVISIONAL — no validado clínicamente, revisar con asesor clínico**): el intervalo cerrado `[mín, máx]` de la tabla de design.md D3 para cada signo numérico (un valor igual a un límite se acepta). `supplementalOxygen` y `consciousness` no tienen rango: su dominio lo valida R3.
- **Regla de coherencia aceptada** (PA-F03-2): si llega `diastolicBp`, `systolicBp` debe ser mayor que `diastolicBp`.
- **Tipos de hallazgo aceptados** (PA-F03-3): `SYMPTOM`, `FINDING` y `COMPLAINT_NOTE`.
- **Captura**: una petición aceptada a `POST /api/v1/encounters/{id}/vital-signs` o a `POST /api/v1/encounters/{id}/symptom-findings`.
- **Rol de captura**: `NURSE`. **Roles de lectura de la captura**: `NURSE` y `PHYSICIAN`.
- **Valores clínicos**: los valores de los signos vitales y los textos (`description`) de los hallazgos.
- **Respuesta de error**: `application/problem+json` (RFC 9457) sin repetir en `detail` ni en `errors[].message` los valores enviados por el cliente.

## Requisitos

### Signos vitales

- **R1** (Por evento) Cuando se reciba `POST /api/v1/encounters/{id}/vital-signs` con un token de `NURSE`, una atención del tenant del token en `WAITING_TRIAGE` y un cuerpo que cumpla R3, R4, R5 y R6, el sistema deberá insertar una fila nueva en `vital_signs` con `tenant_id` del token, `encounter_id`, los valores recibidos (los signos opcionales no enviados quedan NULL), `recorded_at` = hora del servidor y `recorded_by` = usuario autenticado, y responder 201 con la toma (`id`, `encounterId`, un campo por cada signo de la lista aceptada, `recordedAt` y `recordedBy` `{ id, fullName }`). (→ F-03.AC1)
- **R2** (Ubicuo) El sistema deberá registrar cada toma como una inserción nueva, sin modificar ni borrar ninguna fila existente de `vital_signs`, de modo que tras N tomas aceptadas sobre la misma atención (también si llegan de forma simultánea) existan N filas con sus valores originales. (→ F-03.AC1)
- **R3** (No deseado) Si el cuerpo de `POST /api/v1/encounters/{id}/vital-signs` incluye un campo que no pertenece a la lista de signos aceptada, un signo numérico que no es un número, un número no entero en un signo entero, un `temperatureC` con más de un decimal, un `supplementalOxygen` que no es booleano o un `consciousness` distinto de `A`, `C`, `V`, `P` y `U`, entonces el sistema deberá responder 400 con la respuesta de error y el campo en `errors[]`, sin insertar ninguna fila. (→ F-03.AC1, F-03.AC2) (decidido en PA-F03-1)
- **R4** (No deseado) Si a la toma le falta alguno de los signos obligatorios de la lista aceptada, entonces el sistema deberá responder 422 con la respuesta de error y un elemento en `errors[]` por cada signo obligatorio ausente, sin insertar la toma (ningún signo de esa toma se guarda), ninguna fila, ningún evento ni ninguna auditoría. (→ F-03.AC2) (decidido en PA-F03-1)
- **R5** (No deseado) Si uno o más signos de la toma tienen un valor fuera de su rango admitido, entonces el sistema deberá responder 422 con la respuesta de error y un elemento en `errors[]` por cada signo fuera de rango (`field` = nombre del campo y `message` con el rango admitido, sin el valor enviado), rechazando la toma entera: no deberá guardar ninguno de sus signos, ni siquiera los que estén dentro de rango, ni insertar ningún evento ni ninguna auditoría. (→ F-03.AC2) (decidido en PA-F03-2; el bloqueo de la toma entera es un riesgo conocido anotado para el asesor clínico, design.md "Riesgos")
- **R6** (No deseado) Si la toma incluye `diastolicBp` y `systolicBp` no es mayor que `diastolicBp`, entonces el sistema deberá responder 422 con la respuesta de error y los campos `systolicBp` y `diastolicBp` en `errors[]`, sin insertar ninguna fila. (→ F-03.AC2) (decidido en PA-F03-2)

### Síntomas y hallazgos

- **R7** (Por evento) Cuando se reciba `POST /api/v1/encounters/{id}/symptom-findings` con un token de `NURSE`, una atención del tenant del token en `WAITING_TRIAGE` y un cuerpo `{ items }` con entre 1 y 20 elementos, cada uno con `kind` de los tipos de hallazgo aceptados y `description` de 1 a 500 caracteres sin contar espacios iniciales y finales, el sistema deberá insertar en una sola transacción una fila de `symptom_findings` por elemento, todas con `tenant_id` del token, `encounter_id`, la misma `recorded_at` = hora del servidor y `recorded_by` = usuario autenticado, y responder 201 con `{ items }` en el orden recibido, cada uno con `id`, `encounterId`, `kind`, `description`, `recordedAt` y `recordedBy` `{ id, fullName }`. (→ F-03.AC3) (decidido en PA-F03-3)
- **R8** (No deseado) Si en `POST /api/v1/encounters/{id}/symptom-findings` falta `items`, `items` está vacío o tiene más de 20 elementos, un `kind` no es `SYMPTOM`, `FINDING` ni `COMPLAINT_NOTE`, una `description` falta, solo tiene espacios o supera 500 caracteres, o llega un campo no declarado, entonces el sistema deberá responder 400 con la respuesta de error y el campo en `errors[]`, sin insertar ninguna fila. (→ F-03.AC3) (decidido en PA-F03-3)
- **R9** (Ubicuo) El sistema deberá registrar cada hallazgo como una inserción nueva, sin modificar ni borrar ninguna fila existente de `symptom_findings`. (→ F-03.AC3)

### Motivo de consulta

- **R10** (Ubicuo) El sistema no deberá ofrecer en F-03 ninguna vía (endpoint ni método de service exportado) que modifique `encounters.chief_complaint_text` ni `encounters.complaint_source`; las precisiones de enfermería sobre el motivo deberán registrarse como hallazgos de tipo `COMPLAINT_NOTE` mediante R7, de modo que tras registrar una nota el motivo original siga igual. (→ F-03.AC3) (decidido en PA-F03-4)

### Estado de la atención y aislamiento

- **R11** (No deseado) Si la atención de `POST /api/v1/encounters/{id}/vital-signs` o de `POST /api/v1/encounters/{id}/symptom-findings` está en un estado distinto de `WAITING_TRIAGE` (`REGISTERED`, `TRIAGED`, `IN_CARE`, `CLOSED` o `CANCELLED`), entonces el sistema deberá responder 409 con la respuesta de error sin insertar ninguna fila, evento ni auditoría; y si una cancelación de la misma atención se confirma antes que la captura, la captura deberá responder 409. (→ F-03.AC1, F-03.AC3)
- **R12** (No deseado) Si `POST /api/v1/encounters/{id}/vital-signs`, `POST /api/v1/encounters/{id}/symptom-findings` o `GET /api/v1/encounters/{id}/clinical-capture` reciben el id de una atención inexistente, de otro tenant o mal formado, entonces el sistema deberá responder 404 con la misma respuesta de error en los tres casos, sin insertar ninguna fila. (→ F-03.AC1, F-03.AC3)
- **R13** (No deseado) Si el cuerpo de una captura incluye `recordedAt`, `recordedBy`, `tenantId`, `encounterId`, `id`, `createdAt` o cualquier otro campo no declarado, entonces el sistema deberá responder 400 con la respuesta de error sin insertar ninguna fila; `recorded_at` deberá tomarse siempre del reloj del servidor y `recorded_by` y el tenant, del token. (→ F-03.AC1)

### Eventos y auditoría

- **R14** (Por evento) Cuando se registre una toma (R1), el sistema deberá insertar en la misma transacción un `encounter_events` de tipo `VITAL_SIGNS_RECORDED` (`from_status` y `to_status` NULL, `payload = { vitalSignsId }`, `actor_type = STAFF`, `actor_id` = usuario autenticado, `occurred_at` = `recorded_at`) y una fila en `audit_log` con `action = VITAL_SIGNS_RECORDED`, `actor_type = STAFF`, `actor_id`, `tenant_id`, `entity = vital_signs`, `entity_id` = id de la toma y `metadata = { encounterId }`. (→ F-03.AC4)
- **R15** (Por evento) Cuando se registren hallazgos (R7), el sistema deberá insertar en la misma transacción un único `encounter_events` de tipo `SYMPTOM_FINDINGS_RECORDED` (`payload = { findingIds, count }`, `actor_type = STAFF`, `actor_id`, `occurred_at` = `recorded_at`) y una única fila en `audit_log` con `action = SYMPTOM_FINDINGS_RECORDED`, `entity = encounter`, `entity_id` = id de la atención y `metadata = { count }`. (→ F-03.AC4)
- **R16** (No deseado) Si falla la inserción del evento o de la auditoría de una captura, entonces el sistema deberá revertir toda la transacción (sin filas en `vital_signs` ni en `symptom_findings`) y responder 500 con la respuesta de error. (→ F-03.AC4)
- **R17** (Por evento) Cuando se reciba `GET /api/v1/encounters/{id}` tras una captura, el sistema deberá incluir en `events` los eventos `VITAL_SIGNS_RECORDED` y `SYMPTOM_FINDINGS_RECORDED`, con su `payload`, su actor y `occurredAt`, en el orden de R42 de F-02-api. (→ F-03.AC4)
- **R18** (Ubicuo) El sistema deberá excluir de `encounter_events.payload`, de `audit_log.metadata` y de los logs de los flujos de F-03 los valores clínicos, los textos de los hallazgos, el motivo de consulta y los datos personales del paciente. (→ F-03.AC4)

### Inmutabilidad en la base

- **R19** (Ubicuo) El sistema deberá conectarse con el rol `asclepio_app`, que sobre `vital_signs` y `symptom_findings` solo tiene `SELECT` e `INSERT`, de modo que un `UPDATE` o un `DELETE` sobre cualquiera de las dos tablas con ese rol falle con permiso denegado (`42501`); y toda FK desde esas tablas deberá ser `ON DELETE RESTRICT ON UPDATE RESTRICT`, de modo que borrar o cambiar el id de la atención, del tenant o del usuario referenciados falle. (→ F-03.AC1, F-03.AC3)

### Consulta de la captura

- **R20** (Por evento) Cuando se reciba `GET /api/v1/encounters/{id}/clinical-capture` con un token de un rol de lectura de la captura y una atención del tenant del token (en cualquier estado), el sistema deberá responder 200 con `encounterId`, `status`, `chiefComplaintText`, `complaintSource`, `vitalSigns` (todas las tomas, ordenadas por `recorded_at` y después por `id` ascendentes, con la forma de R1) y `symptomFindings` (todos los hallazgos, mismo orden, con la forma de R7). (→ F-03.AC1, F-03.AC3)

### Autorización y errores

- **R21** (No deseado) Si un token de personal con rol distinto de `NURSE` llega a `POST /api/v1/encounters/{id}/vital-signs` o a `POST /api/v1/encounters/{id}/symptom-findings`, un token con rol distinto de `NURSE` o `PHYSICIAN` llega a `GET /api/v1/encounters/{id}/clinical-capture`, o un token de paciente llega a cualquiera de ellos, entonces el sistema deberá responder 403 con la respuesta de error sin insertar ninguna fila; y sin token válido, 401. (→ F-03.AC1, F-03.AC3)
- **R22** (Ubicuo) El sistema deberá responder todos los errores de los endpoints de F-03 en `application/problem+json` sin repetir en `detail` ni en `errors[].message` los valores enviados por el cliente. (→ F-03.AC2)

> Trazabilidad por criterio: AC1 → R1–R3, R11–R13, R19–R21 · AC2 → R3–R6, R22 · AC3 → R7–R12, R19–R21 · AC4 → R14–R18.
> Requisitos que dependen de valores clínicos provisionales (su estructura no cambia si el asesor ajusta los valores en `VITAL_SIGN_DEFINITIONS`): R3, R4 (PA-F03-1); R5, R6 (PA-F03-2).

## Preguntas abiertas

- [x] **PA-F03-1** Lista cerrada de signos vitales, obligatorios y opcionales, con unidad y precisión. → Se elige la opción (b) de la spec (humano, 2026-10-27, por chat), **PROVISIONAL — no validada clínicamente, revisar con asesor clínico**: parámetros fisiológicos del NEWS2 (Royal College of Physicians. _National Early Warning Score (NEWS) 2: Standardising the assessment of acute-illness severity in the NHS_. Londres: RCP, 2017). Obligatorios en cada toma: `respiratoryRate` (rpm, entero), `oxygenSaturation` (%, entero), `supplementalOxygen` (booleano), `systolicBp` (mmHg, entero), `heartRate` (lpm, entero), `consciousness` (`A`, `C`, `V`, `P`, `U`) y `temperatureC` (°C, un decimal). Opcionales: `diastolicBp` (mmHg, entero) y `glucoseMgDl` (mg/dL, entero). La sistólica y la diastólica no van emparejadas: la diastólica es opcional. Glasgow y dolor quedan fuera. Cubierto por R1, R3 y R4.
- [x] **PA-F03-2** Rangos de validación `[mín, máx]` y reglas de coherencia. → Decisión de producto **PROVISIONAL del MVP** (leader por delegación del humano, 2026-10-27, por chat): **no hay fuente publicada**; son límites amplios solo para atrapar errores de digitación, **no validados clínicamente — revisar con asesor clínico**. Rangos inclusivos: `heartRate` 20–300 lpm; `systolicBp` 40–300 mmHg; `diastolicBp` 20–200 mmHg; `respiratoryRate` 4–80 rpm; `oxygenSaturation` 50–100 %; `temperatureC` 25.0–45.0 °C; `glucoseMgDl` 20–600 mg/dL. Regla de coherencia: si llega `diastolicBp`, `systolicBp` > `diastolicBp`. Un valor fuera de rango bloquea la toma entera (riesgo conocido, anotado para el asesor). Cubierto por R5 y R6.
- [x] **PA-F03-3** ¿Catálogo cerrado o texto libre estructurado? → Se acepta la propuesta (humano, 2026-10-27, por chat): texto libre estructurado; `kind` (`SYMPTOM` = lo que refiere el paciente, `FINDING` = lo que observa enfermería, `COMPLAINT_NOTE` = precisión del motivo) y `description` (1–500 caracteres), máximo 20 hallazgos por captura. Sin catálogo ni columna `code` en el MVP. Cubierto por R7 y R8.
- [x] **PA-F03-4** ¿Enfermería edita el motivo de consulta? ¿Se versiona? → Se acepta la propuesta (humano, 2026-10-27, por chat): el motivo original (`encounters.chief_complaint_text` y `complaint_source`) no se edita; las precisiones de enfermería se registran como hallazgos `COMPLAINT_NOTE`, que solo se insertan, con hora del servidor y responsable. El "versionado" es la secuencia de notas. Cubierto por R10.
