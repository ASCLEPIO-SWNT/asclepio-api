# CSV de atenciones — formato interno (F-07-api)

> **Aviso:** este es un **formato interno** de Asclepio. **No es** el formato oficial de reporte de la **Res. 373** ni de **SISPRO**, y no debe presentarse como tal (PA-F07-1, humano, 2026-11-10). Si se necesita el reporte oficial, habrá que construirlo aparte a partir de la especificación oficial.

Lo genera `GET /api/v1/reports/encounters.csv?from=YYYY-MM-DD&to=YYYY-MM-DD[&siteId=uuid]` (solo `ADMIN`). El código vive en `src/modules/reports/report-csv.ts` (`CSV_COLUMNS`, `toCsv`).

## Población y orden

- Hay **una fila por atención** del tenant del token (y de la sede `siteId`, si llega) cuyo `arrival_at` cae en `[from 00:00 −05:00, to+1 00:00 −05:00)` de `America/Bogota`, en cualquier estado. Es la misma población que `GET /reports/summary` con los mismos parámetros: el número de filas es igual a `population.encounters`.
- Las filas van ordenadas por `arrival_at` y después por `encounter_id`.
- El periodo tiene un máximo de 366 días, contando ambos extremos.

## Formato

- **RFC 4180:**
  - Separador coma y fin de línea **CRLF**, también tras la última fila.
  - Cabecera en la primera fila y codificación UTF-8.
  - Una celda que contiene coma, comillas, CR o LF va entre comillas dobles, y las comillas internas se duplican.
- **Cabeceras HTTP:** `Content-Type: text/csv; charset=utf-8` y `Content-Disposition: attachment; filename="asclepio-atenciones-<from>_<to>.csv"`.
- **Horas:** ISO-8601 en hora de Bogotá con desfase fijo y precisión de segundos (`2026-11-10T19:42:00-05:00`). Colombia no tiene horario de verano.
- **Minutos:** número con punto decimal y 1 decimal (`8.5`, `30.0`).
- **Booleanos:** `true` o `false`.
- **Valores ausentes:** celda vacía.
- **Neutralización de fórmulas (R14, D7):** toda celda de texto (en la práctica, `site_name`) que empiece por `=`, `+`, `-`, `@`, tabulador o retorno de carro va precedida de una comilla simple `'`. Así Excel o LibreOffice no la ejecutan como fórmula.

## Columnas (D6), en este orden

| # | Columna | Contenido |
|---|---|---|
| 1 | `encounter_id` | UUID de la atención. Es el único identificador de la fila. |
| 2 | `site_name` | Nombre de la sede (texto neutralizado). |
| 3 | `status` | Estado de la atención: `REGISTERED`, `WAITING_TRIAGE`, `TRIAGED`, `IN_CARE`, `CLOSED` o `CANCELLED`. |
| 4 | `origin` | `PRE_REGISTRATION` o `DIRECT`. |
| 5 | `complaint_source` | `TYPED` o `VOICE_ON_DEVICE` (solo la fuente, nunca el texto del motivo). |
| 6 | `arrival_at` | Hora legal de llegada (la fija recepción con el reloj del servidor). |
| 7 | `triaged_at` | Hora de la decisión de triage. Vacía si no la hay. |
| 8 | `in_care_at` | Hora del paso a `IN_CARE` (evento `STATUS_CHANGED`). Vacía si no llegó. |
| 9 | `closed_at` | Hora del paso a `CLOSED`. Vacía si no se cerró. |
| 10 | `final_level` | Nivel final de triage, de 1 a 5, decidido por enfermería. Vacío sin decisión. |
| 11 | `decision_action` | `VALIDATE`, `CORRECT` o `MANUAL`. Vacía sin decisión. |
| 12 | `suggestion_status` | Estado de la sugerencia de la fila (*): `OK`, `INVALID_OUTPUT`, `TIMEOUT` o `FAILED`. Vacío sin sugerencia. |
| 13 | `suggested_level` | Nivel sugerido, ya ajustado por los safety guards. Solo en `OK`. |
| 14 | `llm_level` | Nivel que propuso el LLM antes de los guards. Solo en `OK`. |
| 15 | `guard_applied` | `true` si un safety guard subió el nivel. Vacío sin sugerencia. |
| 16 | `provider` | `GROQ` u `OPENROUTER` (respaldo). Vacío si no respondió ningún proveedor. |
| 17 | `minutes_to_triage` | Minutos de `arrival_at` a `triaged_at`. |
| 18 | `minutes_triage_to_care` | Minutos de `triaged_at` a `in_care_at`: desde la clasificación hasta la atención médica, que es la medida del indicador "Tiempo de espera Triage II" de la **Res. 256 de 2016**. |
| 19 | `compliant` | Solo en las atenciones de **nivel 2 que llegaron a `IN_CARE`**: `true` si `minutes_triage_to_care ≤ 30` (Res. 5596 de 2015, el mismo `30` que usa la cola) y `false` si no. Vacío en el resto, incluido el nivel 1, que no tiene umbral numérico en la norma. |

(*) La sugerencia de la fila es la **decidida** (`suggestion_id` de la decisión) en `VALIDATE` y `CORRECT`. En `MANUAL` o sin decisión es la **vigente**: la de mayor `created_at` y después mayor id. El resumen (`fallback.suggestions`), en cambio, cuenta **todas** las sugerencias de la población.

## Qué no lleva nunca (R13, PA-F07-4)

El CSV sale del sistema, así que lleva el mínimo de datos. Nunca incluye:

- el nombre ni el documento del paciente, ni ningún otro dato que lo identifique (fecha de nacimiento, sexo, edad);
- el motivo de consulta ni el motivo de corrección;
- los nombres o ids del personal (quién registró, quién decidió o quién solicitó la sugerencia);
- la instantánea enviada al LLM, su respuesta cruda ni la explicación.

Cada descarga queda auditada en `audit_log` (`REPORT_EXPORTED`, `metadata { from, to, siteId, rows }`). El contenido del CSV nunca se registra en los logs.
