# F-07-api — Tareas

> **Orden estricto.** En cada tarea, primero la prueba `R<n>: …` y luego el código. No se empieza ninguna tarea hasta que la spec esté aprobada.
>
> **Sin migraciones** (design.md "Impacto en datos"). Si pareciera necesaria una, **parar** y documentarlo (docs/specs.md §5).
>
> Nada se ejecuta contra Supabase.
>
> **Ramas:** se trabaja en `feature/F-07-api`, creada desde `develop` actualizado, con PR a `develop` (convención del 2026-11-10).

- [x] T1 Prueba unitaria + `report-period.ts` (pura):
  - `R1:` formatos inválidos y fechas imposibles (`2026-02-30`).
  - `R2:` `from > to` → 422; 366 días → válido; 367 → 422.
  - `R3:` límites `[from 00:00 −05:00, to+1 00:00 −05:00)` con `arrival_at` a las 23:59:59 de Bogotá (dentro) y a las 00:00:00 del día siguiente (fuera).

  (R1, R2, R3)
- [x] T2 Prueba unitaria + `report-stats.ts` (pura):
  - `R6:` `median` y `p90` con n = 0, 1, 2, 10 y 11.
  - `R8:` `weightedKappa` con acuerdo perfecto → 1, un caso calculado a mano (con la tabla del cálculo en la prueba) y menos de 2 pares → `null`; matriz 5×5.
  - `R10:` `percent` con denominador 0 → `null` y redondeo a 1 decimal (kappa a 3).

  (R6, R8, R10)
- [x] T3 Prueba unitaria + `report-rows.ts` (pura):
  - `R6:` minutos hasta triage.
  - `R7:` `timeToCare` de I y II (triage → atención, con la media); cumplimiento solo de II con 30 y 31 min en el límite, I sin porcentaje, no evaluable sin `IN_CARE` y III–V sin cumplimiento, usando el `30` **importado** de `queue.rules.ts`.
  - `R8:` solo pares de `VALIDATE`/`CORRECT`, y sub y sobreclasificación.
  - D4: la sugerencia decidida frente a una vigente más reciente.
  - `R9:` conteos por acción, estado, proveedor y guard (todas las sugerencias de la población).

  (R6, R7, R8, R9)
- [x] T4 Prueba unitaria + `report-csv.ts` (pura):
  - `R11:` cabecera exacta, CRLF y orden de filas.
  - `R12:` columnas de D6 en orden, horas con `-05:00`, minutos con punto y 1 decimal, vacíos.
  - `R14:` `site_name` con `=`, `+`, `-`, `@`, tabulador y CR, y con coma o comillas (RFC 4180).
  - `R13:` el tipo `ReportRow` no tiene campos de nombre, documento ni motivo.

  (R11, R12, R13, R14)
- [x] T5 Pruebas de integración + los métodos de lectura de D2:
  - `EncountersService.listForReport`: población por periodo, tenant y sede, con `in_care_at` y `closed_at` tomados de los eventos.
  - `TriageDecisionsService.listByEncounters`: sin `reason`; `TriageModule` exporta el service.
  - `TriageSuggestionsService.listByEncounters`: sin instantánea ni respuesta cruda.
  - `R17:` aislamiento entre tenants en los tres.

  (R3, R4, R17)
- [x] T6 Pruebas de integración + `ReportsService`, `ReportsController` y DTOs (`GET /reports/summary`, `@StaffRoles('ADMIN')`), con un conjunto preparado de atenciones en todos los estados, decisiones de las tres acciones y sugerencias de los cuatro estados, en dos sedes y dos tenants (las sugerencias se insertan como dueño de la base, **nunca con un LLM real**):
  - `R5:`–`R9:` cifras esperadas calculadas a mano en la prueba.
  - `R4:` filtro de sede, y sede ajena → todo en cero o `null`.
  - `R10:` `generatedAt` del `FixedClock`.

  (R4, R5, R6, R7, R8, R9, R10)
- [x] T7 Pruebas de integración + `GET /reports/encounters.csv`:
  - `R11:` `Content-Type`, `Content-Disposition` con el nombre del archivo, y filas.
  - `R13:` búsqueda en el texto del CSV del nombre completo, el documento, el motivo de consulta, el motivo de corrección y los nombres del personal → nada.
  - `R15:` auditoría `REPORT_EXPORTED` con `metadata = { from, to, siteId, rows }`.
  - `R16:` filas = `population.encounters` del resumen con los mismos parámetros, y conteos de `final_level`, `decision_action` y `suggestion_status` que cuadran.

  (R11, R13, R15, R16)
- [x] T8 Pruebas transversales:
  - `R18:` `RECEPTION`, `NURSE` y `PHYSICIAN` → 403; paciente → 403; sin token → 401; en e2e y en integración.
  - `R1:`/`R2:` por HTTP (400 y 422 en `problem+json`).
  - `R19:` logger capturado en los dos flujos sin datos del paciente ni el contenido del CSV.

  (R1, R2, R18, R19)
- [ ] T9 Documentación:
  - docs/architecture.md: módulo `reports`, los tres métodos de lectura y `TriageModule` exporta su service.
  - docs/data-model.md: F-07 sin migración.
  - docs/verification.md: cómo comprobar el resumen y el CSV a mano.
  - Un archivo `docs/reports-csv.md` que documente las columnas de D6, avisando de que es un formato **interno**, no el de la Res. 373 ni SISPRO.

  (R12)
- [ ] T10 Regenerar el snapshot OpenAPI:
  - `API_CONTRACT_VERSION = '0.8.0'`, `ReportSummaryDto` y la respuesta `text/csv` del segundo endpoint.
  - Descripción del formato interno y del cumplimiento según la Res. 256 de 2016 (desde la clasificación).
  - Prueba de contrato (`info.version = 0.8.0` y las dos operaciones).
  - `npm run openapi:export`, comprobando que una segunda ejecución no da diff.
  - El leader fija `contract.version = "0.8.0"` en `feature_list.json`.

  (R5, R11, R18)
