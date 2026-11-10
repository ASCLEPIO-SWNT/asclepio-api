# F-06-api — Cola priorizada por nivel y espera, y paso a atención y cierre

Brief global: docs/product/features/F-06.md (F-06.AC1–AC3 y AC5; el AC4, refresco periódico, es de F-06-web)
Contrato: produce 0.7.0 (menor: endpoints nuevos; parte de 0.6.0)
RNF aplicables: RNF-01, RNF-02, RNF-05, RNF-10, RNF-11, RNF-12, RNF-14
Depende de: F-05-api (`encounters.final_level`), F-02-api (máquina de estados, `EncountersService.transition`).
Decisiones humanas de partida: PA-F06-1..5 (humano, 2026-11-09, por chat: "aprobado"; PA-F06-1 con la opción **(a)**) y PA-F02-4 (humano, 2026-10-26: PHYSICIAN pasa a `IN_CARE` y a `CLOSED`, en F-06).

Glosario de la spec:

- **Hora del servidor**: el valor de `Clock.now()` (RNF-10). Toda la cola se calcula con **una sola** lectura del reloj por petición (`serverNow`).
- **Espera** (PA-F06-2): minutos enteros completos desde `arrival_at` hasta `serverNow`, es decir, `floor((serverNow − arrival_at) / 60 000)`, para las atenciones en `WAITING_TRIAGE` y `TRIAGED`. La espera termina al pasar a `IN_CARE`.
- **Tiempo máximo por nivel** (PA-F06-1, opción (a), **solo los fijados por la Res. 5596 de 2015**):
  - nivel I → **0 min** (atención inmediata);
  - nivel II → **30 min**;
  - niveles III, IV y V → **sin tiempo máximo** (`null`): la norma los deja a cada IPS y el MVP no alerta sobre ellos.
- **Atención vencida** (`overdue`): una atención `TRIAGED` de nivel I con espera mayor que 0, o de nivel II con espera mayor que 30. En cualquier otro caso, `overdue = false`.
- **Secciones de la cola** (atenciones activas del alcance):
  - `waitingTriage`: estado `WAITING_TRIAGE`, ordenadas por mayor espera primero;
  - `triaged`: estado `TRIAGED`, ordenadas por `final_level` ascendente y, dentro de cada nivel, por mayor espera primero;
  - `inCare`: estado `IN_CARE`, ordenadas por `final_level` ascendente y después por `arrival_at` ascendente.

  Los empates se resuelven por `id` ascendente. `REGISTERED` es transitorio (F-02 crea la atención directamente en `WAITING_TRIAGE`) y no aparece.
- **Alcance** (PA-F06-4): el tenant del token y, si llega `siteId`, solo esa sede.
- **Datos del paciente en la cola** (PA-F06-5): `initials`, `ageYears` y `sex`. Nunca el nombre completo, el documento ni el motivo de consulta.
- **Iniciales**: la primera letra (en mayúscula y sin tilde) de la primera palabra y de la última palabra de `full_name`. Si el nombre tiene una sola palabra, una letra. Si es NN (sin nombre), `null`.
- **Edad**: años cumplidos en `America/Bogota` desde `birth_date` a `serverNow`; si no hay fecha, `estimated_age_years`; si no hay ninguna de las dos, `null`.
- **Roles de la cola**: `PHYSICIAN`, `NURSE` y `ADMIN`. **Rol de las transiciones**: `PHYSICIAN`.
- **Respuesta de error**: `application/problem+json` (RFC 9457) sin repetir los valores enviados.

## Requisitos

### Cola

- **R1** (Por evento) Cuando se reciba `GET /api/v1/queue` con un token de un rol de la cola, el sistema deberá responder 200 con `{ serverNow, waitingTriage, triaged, inCare }`, con las atenciones activas del alcance repartidas y ordenadas según las secciones de la cola. (→ F-06.AC1, F-06.AC2)
- **R2** (Ubicuo) El sistema deberá representar cada elemento de la cola con `encounterId`, `siteId`, `siteName`, `status`, `finalLevel` (`null` en `waitingTriage`), `arrivalAt`, `waitMinutes` (`null` en `inCare`), `maxWaitMinutes` (según el nivel; `null` sin nivel o en III–V), `overdue` y `patient: { initials, ageYears, sex }`. (→ F-06.AC1, F-06.AC3, F-06.AC5)
- **R3** (Ubicuo) El sistema deberá calcular `waitMinutes` y `overdue` en el servidor con un único `serverNow` por petición, devuelto en la respuesta, e ignorar cualquier hora que envíe el cliente. (→ F-06.AC1) (decidido en PA-F06-2; RNF-10)
- **R4** (Ubicuo) El sistema deberá marcar `overdue = true` solo en las atenciones `TRIAGED` de nivel I con espera mayor que 0 o de nivel II con espera mayor que 30, y `maxWaitMinutes` = 0, 30 o `null` según el nivel. Los tiempos máximos deberán vivir en una única definición en código, con la referencia a la Res. 5596 de 2015. (→ F-06.AC3) (decidido en PA-F06-1, opción (a))
- **R5** (Por evento) Cuando la petición incluya `siteId` con un UUID de una sede del tenant del token, el sistema deberá limitar la cola a las atenciones de esa sede. (→ F-06.AC1) (decidido en PA-F06-4)
- **R6** (No deseado) Si `siteId` no es un UUID, entonces el sistema deberá responder 400. Si es un UUID de una sede inexistente o de otro tenant, deberá responder 200 con las tres secciones vacías, sin revelar si la sede existe en otro tenant. Si llega cualquier otro parámetro de consulta, deberá responder 400. (→ F-06.AC1)
- **R7** (Ubicuo) El sistema deberá excluir de la respuesta de la cola el nombre completo, el tipo y el número de documento, la fecha de nacimiento, el id del paciente y el motivo de consulta. Solo deberá incluir los datos del paciente de la cola. (→ F-06.AC5) (decidido en PA-F06-5)
- **R8** (Ubicuo) El sistema deberá excluir de la cola las atenciones `REGISTERED`, `CLOSED` y `CANCELLED` y las de otros tenants. (→ F-06.AC1)

### Paso a atención y cierre

- **R9** (Por evento) Cuando se reciba `POST /api/v1/encounters/{id}/start-care` sin cuerpo (o con `{}`), con un token de `PHYSICIAN` y una atención del tenant en `TRIAGED`, el sistema deberá pasarla a `IN_CARE` con la transición genérica (evento `STATUS_CHANGED` y auditoría `ENCOUNTER_STATUS_CHANGED` en la misma transacción, R38–R39 de F-02) y responder 200 con la atención en la forma de `GET /encounters/{id}`. (→ F-06.AC1) (PA-F02-4)
- **R10** (Por evento) Cuando se reciba `POST /api/v1/encounters/{id}/close` sin cuerpo (o con `{}`), con un token de `PHYSICIAN` y una atención del tenant en `IN_CARE`, el sistema deberá pasarla a `CLOSED` de la misma forma que R9 y responder 200. (→ F-06.AC1) (PA-F02-4)
- **R11** (No deseado) Si `start-care` llega sobre una atención que no está en `TRIAGED`, o `close` sobre una que no está en `IN_CARE` (también tras un cambio concurrente), entonces el sistema deberá responder 409 sin modificar la atención ni insertar eventos. (→ F-06.AC1) (R33 de F-02)
- **R12** (No deseado) Si el id de la atención no existe, es de otro tenant o está mal formado, entonces `start-care` y `close` deberán responder 404 con la misma respuesta de error en los tres casos. Si el cuerpo trae algún campo, deberán responder 400. En ambos casos, sin modificar nada. (→ F-06.AC1)
- **R13** (Ubicuo) El sistema deberá conservar `final_level`, `triaged_at` y `triaged_by` al pasar a `IN_CARE` y a `CLOSED`, de modo que la atención cerrada mantiene su nivel final. (→ F-06.AC1) (RNF-03)

### Autorización y errores

- **R14** (No deseado) Si un token de personal con rol distinto de `PHYSICIAN`, `NURSE` o `ADMIN` llega a `GET /queue`, un token con rol distinto de `PHYSICIAN` llega a `start-care` o `close`, o un token de paciente llega a cualquiera de ellos, entonces el sistema deberá responder 403 con la respuesta de error, sin modificar nada. Sin token válido deberá responder 401. (→ F-06.AC1)
- **R15** (Ubicuo) El sistema deberá responder todos los errores de los endpoints de F-06 en `application/problem+json`, y deberá excluir de los logs del flujo de la cola los datos del paciente. (→ F-06.AC5) (RNF-05)

> Trazabilidad por criterio: AC1 → R1–R3, R5, R6, R8–R14 · AC2 → R1 · AC3 → R2, R4 · AC5 → R2, R7, R15.

## Preguntas abiertas

- [x] **PA-F06-1** Tiempos máximos por nivel. → Humano, 2026-11-09: opción **(a)**: alertar solo los niveles fijados por la Res. 5596 de 2015, que son I (inmediato, 0 min) y II (30 min). III, IV y V sin tiempo máximo ni alerta en el MVP. Cubierto por R4.
- [x] **PA-F06-2** Definición de espera. → Humano, 2026-11-09: desde `arrival_at` (llegada legal) hasta que la atención pasa a `IN_CARE`. Cubierto por R2 y R3.
- [x] **PA-F06-3** Intervalo de refresco. → Humano, 2026-11-09: 30 s. Es responsabilidad de F-06-web (F-06.AC4); la API solo devuelve `serverNow`.
- [x] **PA-F06-4** ¿Cola por sede o por tenant? → Humano, 2026-11-09: por sede con filtro (`siteId` opcional, como la bandeja de recepción). Cubierto por R5 y R6.
- [x] **PA-F06-5** ¿Qué datos del paciente se muestran? → Humano, 2026-11-09: iniciales, edad y sexo, sin documento. Cubierto por R2 y R7.
