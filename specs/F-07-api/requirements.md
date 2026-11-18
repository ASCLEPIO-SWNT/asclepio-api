# F-07-api — Reportes de tiempos, cumplimiento, concordancia y CSV

Brief global: docs/product/features/F-07.md (F-07.AC1–AC5; el AC6 es de F-07-web)
Contrato: produce 0.8.0 (menor: endpoints nuevos; parte de 0.7.0)
RNF aplicables: RNF-01, RNF-05, RNF-10, RNF-11, RNF-12, RNF-14
Depende de: F-05-api (`final_level`, `triaged_at`, `triage_decisions`), F-04-api (`triage_suggestions`) y F-06-api (`IN_CARE`/`CLOSED` y los tiempos máximos de la cola).
Decisiones humanas de partida: PA-F07-1..4 y la medición del cumplimiento (humano, 2026-11-10, por chat: "aprobado F-07"; el cumplimiento se mide **desde la clasificación de triage hasta la atención médica**, como el indicador de la Res. 256 de 2016; humano, 2026-11-10).

Glosario de la spec:

- **Periodo**: `from` y `to` (fechas `YYYY-MM-DD`, ambas inclusive) interpretadas en `America/Bogota`, es decir, el intervalo `[from 00:00 −05:00, to+1 00:00 −05:00)`. Máximo 366 días.
- **Población**: las atenciones del tenant del token (y de la sede, si llega `siteId`) cuyo `arrival_at` cae en el periodo, en cualquier estado.
- **Atención triada**: una atención de la población con `triaged_at` no nulo (tiene decisión, F-05).
- **Minutos hasta triage**: `(triaged_at − arrival_at) / 60 000`, con decimales.
- **Inicio de atención** (`in_care_at`): `occurred_at` del evento `STATUS_CHANGED` con `to_status = IN_CARE`. **Cierre** (`closed_at`): el del evento con `to_status = CLOSED`. **Minutos de triage a atención**: `(in_care_at − triaged_at) / 60 000`. Es la medida del indicador "Tiempo de espera Triage II" de la **Res. 256 de 2016**: minutos desde que el paciente es clasificado hasta que lo atiende el médico.
- **Estadísticos de tiempo** (PA-F07-3): por nivel final y en total, `n`, **mediana** y **p90**, con 1 decimal. La mediana es el promedio de los dos centrales si `n` es par. El **p90** usa el método del rango más cercano: el valor en la posición `ceil(0,9·n)` de la lista ordenada. Con `n = 0`, ambos son `null`.
- **Cumplimiento** (decisión del humano, 2026-11-10, con la Res. 256 de 2016 y la Res. 5596 de 2015): solo para el **nivel II**, que es el único con un tiempo numérico en la norma (atención que "no debe superar los treinta (30) minutos"). Una atención de nivel II es **evaluable** si llegó a `IN_CARE`, y **cumple** si `minutos de triage a atención ≤ 30`. El porcentaje es cumplen / evaluables, y `null` si no hay evaluables. Las de nivel II triadas que no llegaron a `IN_CARE` se informan como `notEvaluated`. El **nivel I** ("requiere atención inmediata") no tiene umbral numérico en la norma: se informa su tiempo de triage a atención (n, mediana, p90 y media) **sin porcentaje de cumplimiento**. Los niveles III, IV y V no tienen cumplimiento.
- **Indicador Res. 256 Triage II**: el **promedio** (además de la mediana y el p90) de los minutos de triage a atención de las atenciones de nivel II evaluables, con 1 decimal.
- **Sugerencia decidida**: la sugerencia referenciada por la decisión (`suggestion_id`) en `VALIDATE` y `CORRECT`. Siempre es `OK`, porque F-05 lo exige.
- **Par de concordancia**: (`suggested_level` de la sugerencia decidida, `final_level`) de cada atención triada con decisión `VALIDATE` o `CORRECT` (F-07.AC2: solo con sugerencia válida).
- **Concordancia** (PA-F07-2): sobre los pares,
  - **acuerdo exacto %**: pares iguales / pares;
  - **kappa de Cohen ponderado cuadrático** con 5 categorías (pesos `1 − (i − j)² / 16`). Es `null` si hay menos de 2 pares o si el acuerdo esperado es 1;
  - **subclasificación %**: `suggested_level > final_level`, es decir, la IA sugirió un nivel menos grave;
  - **sobreclasificación %**: `suggested_level < final_level`.
- **Uso de fallback y guards** (F-07.AC3):
  - entre las atenciones triadas: % por acción (`VALIDATE`, `CORRECT`, `MANUAL`);
  - entre todas las sugerencias de la población: % por estado (`OK`, `INVALID_OUTPUT`, `TIMEOUT`, `FAILED`);
  - entre las sugerencias `OK`: % por proveedor (`GROQ` y `OPENROUTER`, que es el uso del respaldo) y % con `guard_applied`.

  Todos los porcentajes llevan 1 decimal, son `null` si el denominador es 0 y van acompañados del conteo y del denominador.
- **CSV** (PA-F07-1, PA-F07-4): **formato interno documentado**, que no se presenta como el formato oficial de la Res. 373 ni de SISPRO. Tiene una fila por atención de la población, sin nombres, documentos, motivo de consulta ni motivo de corrección.
- **Rol de los reportes**: `ADMIN`.
- **Respuesta de error**: `application/problem+json` sin repetir los valores enviados.

## Requisitos

### Parámetros

- **R1** (No deseado) Si `from` o `to` faltan o no son fechas `YYYY-MM-DD` válidas, `siteId` no es un UUID o llega cualquier otro parámetro de consulta, entonces el sistema deberá responder 400 con la respuesta de error y el campo en `errors[]`. (→ F-07.AC1)
- **R2** (No deseado) Si `from` es posterior a `to` o el periodo supera 366 días, entonces el sistema deberá responder 422 con la respuesta de error y el campo en `errors[]`. (→ F-07.AC1)
- **R3** (Ubicuo) El sistema deberá interpretar el periodo en `America/Bogota` con límites `[from 00:00 −05:00, to+1 00:00 −05:00)`, de modo que una atención con `arrival_at` a las 23:59 hora de Bogotá del día `to` esté en la población y una a las 00:00 del día siguiente no esté. (→ F-07.AC1)
- **R4** (Por evento) Cuando llegue `siteId`, el sistema deberá limitar la población a esa sede. Si la sede es de otro tenant o no existe, deberá calcular sobre una población vacía, sin revelar si la sede existe en otro tenant. (→ F-07.AC1)

### Indicadores

- **R5** (Por evento) Cuando se reciba `GET /api/v1/reports/summary?from&to[&siteId]` con un token de `ADMIN` y parámetros válidos, el sistema deberá responder 200 con `{ period: { from, to, siteId }, generatedAt, population: { encounters, triaged }, timeToTriage, timeToCare, compliance, concordance, fallback }` según R6–R9. (→ F-07.AC1, F-07.AC2, F-07.AC3)
- **R6** (Ubicuo) El sistema deberá calcular `timeToTriage` como una entrada por nivel final 1–5 y una entrada `total`, cada una con `n`, `median` y `p90` de los minutos hasta triage de las atenciones triadas, con los estadísticos del glosario. (→ F-07.AC1) (decidido en PA-F07-3)
- **R7** (Ubicuo) El sistema deberá calcular `timeToCare` (minutos de triage a atención: `n`, `median`, `p90` y `mean`) para los niveles 1 y 2, y `compliance` solo para el nivel 2 con `maxMinutes = 30`, `evaluable`, `compliant`, `percent` y `notEvaluated`, según la definición de cumplimiento (desde la clasificación de triage, Res. 256 de 2016), tomando los 30 minutos de la misma definición que usa la cola de F-06. (→ F-07.AC1) (decisión del humano, 2026-11-10)
- **R8** (Ubicuo) El sistema deberá calcular `concordance` con `pairs`, `exactAgreementPercent`, `weightedKappa`, `underTriagePercent` y `overTriagePercent`, solo sobre los pares de concordancia, y con la matriz 5×5 de conteos `matrix[suggested][final]`. (→ F-07.AC2) (decidido en PA-F07-2)
- **R9** (Ubicuo) El sistema deberá calcular `fallback` con `decisions` (conteo y % por acción), `suggestions` (conteo y % por estado), `providers` (conteo y % por proveedor entre las `OK`) y `guards` (conteo y % de `guard_applied` entre las `OK`). (→ F-07.AC3)
- **R10** (Ubicuo) El sistema deberá redondear los porcentajes, medianas, p90 y el kappa a 1 decimal (el kappa a 3), devolver `null` cuando el denominador sea 0 o el estadístico no esté definido, y calcularlo todo con una sola lectura del reloj (`generatedAt`). (→ F-07.AC1, F-07.AC2, F-07.AC3)

### CSV

- **R11** (Por evento) Cuando se reciba `GET /api/v1/reports/encounters.csv?from&to[&siteId]` con un token de `ADMIN` y parámetros válidos, el sistema deberá responder 200 con `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="asclepio-atenciones-<from>_<to>.csv"` y un CSV RFC 4180 (separador coma, fin de línea CRLF, cabecera en la primera fila) con **una fila por atención de la población**, ordenadas por `arrival_at` y después por `id`. (→ F-07.AC4)
- **R12** (Ubicuo) El sistema deberá emitir exactamente las columnas de design.md D6, en ese orden. Las horas deberán ir en ISO-8601 con zona de Bogotá (`2026-11-10T19:42:00-05:00`) y los valores ausentes como celda vacía. (→ F-07.AC4) (decidido en PA-F07-1)
- **R13** (Ubicuo) El sistema deberá excluir del CSV el nombre y el documento del paciente, el motivo de consulta, el motivo de corrección y los nombres del personal. La fila se identifica por el id de la atención. (→ F-07.AC4) (decidido en PA-F07-4)
- **R14** (Ubicuo) El sistema deberá neutralizar la inyección de fórmulas: toda celda de texto que empiece por `=`, `+`, `-`, `@`, tabulador o retorno de carro deberá ir precedida de `'`. (→ F-07.AC4)
- **R15** (Por evento) Cuando se genere un CSV, el sistema deberá registrar en `audit_log` `action = REPORT_EXPORTED`, `actor_type = STAFF`, `actor_id`, `tenant_id`, `entity = report`, `entity_id = NULL` y `metadata = { from, to, siteId, rows }`. (→ F-07.AC4) (RNF-01)

### Coherencia, aislamiento y autorización

- **R16** (Ubicuo) El sistema deberá calcular el resumen y el CSV sobre la misma población con los mismos parámetros, de modo que el número de filas del CSV sea igual a `population.encounters` y cada `final_level`, acción y estado de sugerencia del CSV cuadre con los conteos del resumen. (→ F-07.AC1, F-07.AC4)
- **R17** (Ubicuo) El sistema deberá incluir solo datos del tenant del token en el resumen y en el CSV. (→ F-07.AC1) (RNF-11)
- **R18** (No deseado) Si un token de personal con rol distinto de `ADMIN` o un token de paciente llega a cualquiera de los dos endpoints, entonces el sistema deberá responder 403. Sin token válido deberá responder 401. (→ F-07.AC5)
- **R19** (Ubicuo) El sistema deberá excluir de los logs del flujo de reportes los datos del paciente y el contenido del CSV, y responder todos los errores en `application/problem+json`. (→ F-07.AC4) (RNF-05)

> Trazabilidad por criterio: AC1 → R1–R7, R10, R16, R17 · AC2 → R5, R8, R10 · AC3 → R5, R9, R10 · AC4 → R11–R16, R19 · AC5 → R18.

## Preguntas abiertas

- [x] **PA-F07-1** Formato Res. 373 / SISPRO. → Humano, 2026-11-10: no se dispone del formato oficial; el CSV es un **formato interno documentado** (D6) que no se presenta como oficial. Fuera de alcance, como dice el brief. Cubierto por R11 y R12.
- [x] **PA-F07-2** ¿Kappa simple o ponderado? → Humano, 2026-11-10: kappa de Cohen **ponderado cuadrático**, más el % de acuerdo exacto. Cubierto por R8.
- [x] **PA-F07-3** Métricas de tiempo. → Humano, 2026-11-10: por nivel, `n`, mediana y p90 de los minutos desde la llegada hasta el triage. Cubierto por R6.
- [x] **PA-F07-4** ¿Documento en el CSV? → Humano, 2026-11-10: no; ni nombre ni documento, la fila se identifica por el id de la atención. Cubierto por R13.
- [x] **Cumplimiento** (pregunta añadida en la spec). → Humano, 2026-11-10: se sigue la norma. La Res. 256 de 2016 mide el "Tiempo de espera Triage II" desde que el paciente **es clasificado** hasta que **lo atiende el médico**, con un estándar de 30 min (Res. 5596 de 2015). Por eso el cumplimiento se calcula solo para II, desde `triaged_at` hasta `IN_CARE`. El nivel I ("atención inmediata", sin minutos en la norma) se informa sin porcentaje. Cubierto por R7.
