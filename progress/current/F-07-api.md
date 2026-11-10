# F-07-api — Reportes de tiempos, cumplimiento, concordancia y CSV

- 2026-11-10: F-06-web y DT-01-mobile en `done` (en `origin/develop`). El humano aprobó por chat ("aprobado F-07") las propuestas a PA-F07-1..4:
  - PA-F07-1: CSV interno documentado, no oficial.
  - PA-F07-2: kappa ponderado cuadrático más acuerdo exacto.
  - PA-F07-3: n, mediana y p90 por nivel.
  - PA-F07-4: sin nombre ni documento.
- Cumplimiento (humano, 2026-11-10): "según la ley colombiana". Verificado: el indicador "Tiempo de espera Triage II" de la **Res. 256 de 2016** cuenta los minutos desde que el paciente **es clasificado** hasta que **lo atiende el médico**, con un estándar de 30 min (Res. 5596 de 2015, Triage II). Para el Triage I la norma dice "atención inmediata", sin minutos. Spec ajustada: cumplimiento solo para II, de `triaged_at` a `IN_CARE`; I se informa sin porcentaje. Fuente: transcripción en el protocolo de triage de Red Salud Armenia (MI-PS-PR-063).
- CSV (humano, 2026-11-10): se acepta la neutralización de fórmulas (D7, R14).
- Volumen (humano, 2026-11-10): MVP académico, se acepta el techo de D2 sin optimizar.
- **Inconsistencia pendiente con F-06 (done):** la cola marca `overdue` desde la llegada (PA-F06-2), mientras que la norma (Res. 256) cuenta desde la clasificación. Propuesta: slice DT en api (`overdue` y `maxWaitMinutes` desde `triaged_at` para las atenciones `TRIAGED`; `waitMinutes` sigue desde la llegada para mostrar) y un ajuste en F-06-web si hace falta. Lo decide el humano.
- 2026-11-10 (spec_author, desde la sesión de la raíz, sin hooks; solo se escribieron la spec y el estado): spec en `specs/F-07-api/`:
  - 19 requisitos (R1–R19), 8 decisiones (D1–D8) y 10 tareas, sin preguntas abiertas.
  - Contrato 0.7.0 → 0.8.0: `GET /reports/summary` y `GET /reports/encounters.csv` (ADMIN).
  - **Sin migraciones.**
- Estado previo: **spec_ready**.

## Aprobación
- 2026-11-10: el humano aprobó la spec por chat ("apruebo"), con el cumplimiento según la Res. 256 de 2016. F-07-api → **in_progress**. Brief F-07 y roadmap actualizados con PA-F07-1..4 resueltas.
- Siguiente paso: implementar en `feature/F-07-api` desde `develop`, en una sesión abierta dentro de `asclepio-api/`.
