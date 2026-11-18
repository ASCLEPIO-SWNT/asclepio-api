# F-07-api — Diseño

## Resumen

Se construye el módulo `reports` (solo para `ADMIN`): un resumen de indicadores y un CSV por atención para un periodo en hora de Bogotá. **No tiene tablas propias ni migraciones**: lee mediante los services de `encounters`, `triage` y `ai` (ADR 0001). Todos los cálculos son funciones puras probadas sin base de datos.

| Lugar | Qué aporta |
|---|---|
| `modules/reports/report-period.ts` | Pura: `parsePeriod(from, to)` → `{ start, end }` en UTC con límites de Bogotá (−05:00 fijo, porque Colombia no tiene horario de verano), y la validación de R2. |
| `modules/reports/report-stats.ts` | Pura: `median`, `p90` (rango más cercano), `percent`, `round1`, `weightedKappa(pairs)` (cuadrático, 5 categorías) y la matriz 5×5. |
| `modules/reports/report-rows.ts` | Pura: `buildRows(encounters, decisions, suggestions)` → una `ReportRow` por atención, con su sugerencia decidida o, si no la hay, la vigente (D4), sus minutos y su cumplimiento. `summarize(rows, suggestions)` → el resumen de R5–R10. |
| `modules/reports/report-csv.ts` | Pura: `toCsv(rows)` con las columnas de D6, RFC 4180, CRLF y la neutralización de R14. |
| `modules/reports/reports.service.ts` | Carga los datos (D2), aplica `buildRows`, `summarize` y `toCsv`, y registra la auditoría del CSV. |
| `modules/reports/reports.controller.ts` | `GET /reports/summary` y `GET /reports/encounters.csv` (`@StaffRoles('ADMIN')`), con un DTO de consulta (`from`, `to`, `siteId?`; `forbidNonWhitelisted`). |
| `modules/reports/dto/report-summary.dto.ts` | DTOs del resumen (R5–R9). |
| `modules/reports/reports.module.ts` | Importa `EncountersModule`, `TriageModule`, `AiModule` y `AuditModule`. |
| `modules/encounters/encounters.service.ts` | **Nuevo** `listForReport(tenantId, start, end, siteId?)` (D2). |
| `modules/triage/triage-decisions.service.ts` + `triage.module.ts` | **Nuevo** `listByEncounters(tenantId, encounterIds)` → `{ encounterId, action, level, suggestionId }[]`, sin `reason`. `TriageModule` exporta el service. |
| `modules/ai/triage-suggestions.service.ts` | **Nuevo** `listByEncounters(tenantId, encounterIds)` → `{ id, encounterId, status, suggestedLevel, llmLevel, guardApplied, provider, createdAt }[]`, sin instantánea ni respuesta cruda. |
| `modules/queue/queue.rules.ts` | `MAX_WAIT_MINUTES_BY_LEVEL` se **reutiliza** (se exporta si aún no lo está). No se duplica. |
| `modules/audit` | `AuditAction` añade `REPORT_EXPORTED`. |

Dependencias entre módulos: `reports → encounters, triage, ai, audit` (más `queue.rules` como constante pura). Se actualiza docs/architecture.md.

## Decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| D1 | Dos endpoints: `GET /reports/summary` (JSON) y `GET /reports/encounters.csv` (CSV), con los mismos parámetros y las mismas funciones de población (R16). | Un solo endpoint con `Accept` negociado. | La descarga desde la web es un enlace directo con `Content-Disposition`, y cada respuesta tiene su contrato. |
| D2 | Carga en **tres consultas** sin cruzar tablas de otro módulo:<br>(1) `encounters.listForReport`: atenciones de la población con `id`, `site_id`, nombre de la sede, `status`, `origin`, `complaint_source`, `arrival_at`, `triaged_at`, `final_level` y, de `encounter_events`, el `occurred_at` del `STATUS_CHANGED` a `IN_CARE` y a `CLOSED`, en una sola consulta con subconsultas o agregados;<br>(2) `triage.listByEncounters(ids)`;<br>(3) `ai.listByEncounters(ids)`.<br>La unión se hace en memoria (`buildRows`). | Una consulta SQL con JOIN entre las tres tablas desde `reports`. | Regla del proyecto: un módulo no toca las tablas de otro. Con el límite de 366 días y el volumen del MVP, unos miles de filas caben en memoria. **Techo conocido:** si un tenant superara ~50 000 atenciones por periodo, habría que mover los agregados a SQL dentro de cada service o paginar el CSV con streaming. |
| D3 | El cumplimiento se mide **desde la clasificación** (`triaged_at`) hasta `IN_CARE`, como el indicador de la Res. 256 de 2016, y solo para el nivel II (≤ 30 min, reutilizando el `30` de `MAX_WAIT_MINUTES_BY_LEVEL`). El nivel I se informa sin porcentaje, porque la norma dice "inmediata" sin minutos. | Medir desde la llegada (`arrival_at`), como hace hoy la cola de F-06. | Es lo que dice la norma colombiana (verificado el 2026-11-10 en un protocolo institucional que transcribe el indicador). **Inconsistencia conocida:** la cola de F-06 marca `overdue` contando desde la llegada. Se propone alinearla en un slice aparte (ver progress/current/F-07-api.md). |
| D4 | La sugerencia de cada fila es la **decidida** (`suggestion_id` de la decisión) si la hay. Si no (`MANUAL` o sin decisión), es la **vigente**: la de mayor `created_at` e `id`. En cambio, `fallback.suggestions` cuenta **todas** las sugerencias de la población, no solo una por atención. | Solo la última. | La concordancia exige la sugerencia sobre la que se decidió (F-05 D4: la vigente puede ser otra). El fallback mide cada solicitud a la IA. |
| D5 | Kappa ponderado cuadrático sobre la matriz de 5 niveles: `κ = 1 − Σ wᵢⱼ·Oᵢⱼ / Σ wᵢⱼ·Eᵢⱼ`, con `wᵢⱼ = (i − j)²`. `null` si hay menos de 2 pares o si el denominador es 0. Tres decimales. | Kappa simple. | Decisión PA-F07-2. Para escalas ordinales, el cuadrático penaliza más los desacuerdos lejanos (I frente a IV) que los vecinos. |
| D6 | **Columnas del CSV**, en este orden, con cabeceras en `snake_case`: `encounter_id`, `site_name`, `status`, `origin`, `complaint_source`, `arrival_at`, `triaged_at`, `in_care_at`, `closed_at`, `final_level`, `decision_action`, `suggestion_status`, `suggested_level`, `llm_level`, `guard_applied`, `provider`, `minutes_to_triage`, `minutes_triage_to_care`, `compliant`. Notas: `minutes_to_triage` = llegada → triage y `minutes_triage_to_care` = triage → atención (Res. 256); `compliant` vale `true`/`false` solo en II evaluables y va vacío en el resto; los minutos llevan 1 decimal con punto; las horas van en ISO-8601 con `-05:00`; `guard_applied` es `true`/`false`, o vacío si no hay sugerencia. | Incluir edad, sexo e iniciales. | Las métricas de F-07 no los necesitan, y el CSV sale del sistema: mínimo de datos (PA-F07-4). |
| D7 | Neutralización de fórmulas en toda celda de texto (en la práctica solo `site_name`, que escribe un administrador). Las enumeraciones e ids no pueden empezar por esos caracteres. | No hacer nada porque "son datos internos". | El CSV se abre en Excel o LibreOffice, donde una sede llamada `=HYPERLINK(...)` se ejecutaría. Es un control de seguridad barato. |
| D8 | Auditoría solo del CSV (`REPORT_EXPORTED`), no del resumen. | Auditar también el resumen. | El CSV saca del sistema datos por atención. El resumen solo devuelve agregados. |

## Impacto en contrato

Versión: **0.7.0 → 0.8.0** (menor: dos operaciones nuevas).

- `GET /api/v1/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD[&siteId=uuid]` — `ADMIN`.
  - **200** `ReportSummaryDto`:
    - `period { from, to, siteId | null }`
    - `generatedAt`
    - `population { encounters, triaged }`
    - `timeToTriage { byLevel: [{ level, n, median, p90 }] ×5, total: { n, median, p90 } }`
    - `timeToCare { byLevel: [{ level: 1 | 2, n, median, p90, mean }] }` (minutos de triage a atención; Res. 256 de 2016)
    - `compliance { level: 2, maxMinutes: 30, evaluable, compliant, percent, notEvaluated }`
    - `concordance { pairs, exactAgreementPercent, weightedKappa, underTriagePercent, overTriagePercent, matrix: int[5][5] }`
    - `fallback { decisions: { total, VALIDATE: {count, percent}, CORRECT, MANUAL }, suggestions: { total, OK, INVALID_OUTPUT, TIMEOUT, FAILED }, providers: { total, GROQ, OPENROUTER }, guards: { total, applied, percent } }`
  - **400** · **401** · **403** · **422**.
- `GET /api/v1/reports/encounters.csv?from&to[&siteId]` — `ADMIN`. **200** `text/csv; charset=utf-8` con `Content-Disposition: attachment` · **400** · **401** · **403** · **422** (`problem+json`).
- La descripción documenta que el CSV es un **formato interno**, no el de la Res. 373 ni SISPRO, y que el cumplimiento sigue el indicador "Tiempo de espera Triage II" de la Res. 256 de 2016 (desde la clasificación hasta la atención médica).
- Clientes: F-07-web consumirá 0.8.0.

## Impacto en datos

**Sin impacto en datos.** No hay migración. Solo lecturas mediante services. La única escritura es la auditoría `REPORT_EXPORTED` en `audit_log`, que ya existe. Las consultas usan el índice `(tenant_id, arrival_at)` de `encounters`, el `UNIQUE (encounter_id)` de `triage_decisions` y el índice `(encounter_id, created_at, id)` de `triage_suggestions`. Para los eventos sirve el índice existente `encounter_events (encounter_id, occurred_at, id)` (verificado en `schema.prisma`).

## Riesgos y pruebas

**Riesgos:**
- (1) La cola de F-06 cuenta el vencimiento desde la llegada y el reporte desde el triage: una atención puede verse "vencida" en la cola y "cumplida" en el reporte. Se resuelve alineando la cola (slice propuesto aparte).
- (2) El techo de volumen de D2.
- (3) El CSV es interno, no oficial, y esa advertencia debe verse en la web (F-07-web).
- (4) Los periodos con muy pocos pares hacen el kappa inestable: se devuelve `pairs` para que la web lo advierta.

**Pruebas unitarias (puras):**
- `parsePeriod`: límites de Bogotá a las 23:59 y a las 00:00, `from > to`, 366 y 367 días, fechas imposibles.
- `median`/`p90` con n = 0, 1, 2, 10 y 11.
- `weightedKappa`: caso de acuerdo perfecto → 1; caso con valor calculado a mano (dejar la tabla de la prueba con el cálculo); menos de 2 pares → `null`.
- Subclasificación y sobreclasificación.
- `buildRows`: sugerencia decidida frente a vigente (D4), MANUAL sin par, cumplimiento de II en el límite (30 y 31 min de triage a atención), nivel I sin porcentaje, y no evaluable sin `IN_CARE`.
- `toCsv`: cabecera exacta, CRLF, comillas y comas en `site_name`, neutralización `=`/`+`/`-`/`@`, horas con `-05:00`, vacíos.

**Pruebas e2e sin base:** 401/403 (R18) y 400/422 de parámetros (R1, R2).

**Pruebas de integración (Docker)**, con un conjunto preparado de atenciones en todos los estados, decisiones de las tres acciones y sugerencias de los cuatro estados en dos sedes y dos tenants:
- R5–R9: cifras esperadas calculadas a mano en la prueba.
- R4: filtro de sede, y sede ajena → vacío.
- R11–R13: cabeceras HTTP, filas y búsqueda profunda de nombre, documento, motivo y motivo de corrección → nada.
- R15: auditoría.
- R16: filas del CSV = `population.encounters` y conteos que cuadran.
- R17: aislamiento entre tenants.
- R19: logger capturado.
