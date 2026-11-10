# F-06-api — Cola priorizada, paso a atención y cierre

- 2026-11-09: F-05-api y F-04-web en `done`. El humano aprobó por chat ("aprobado") las respuestas a PA-F06-1..5:
  - PA-F06-1: opción (a), alertar solo I (0 min) y II (30 min), los tiempos de la Res. 5596; III–V sin alerta.
  - PA-F06-2: la espera va desde `arrival_at` hasta `IN_CARE`.
  - PA-F06-3: refresco de 30 s (en la web).
  - PA-F06-4: cola por sede con filtro.
  - PA-F06-5: del paciente, solo iniciales, edad y sexo.
- 2026-11-09 (spec_author, desde la sesión de la raíz, sin hooks; solo se escribieron la spec y el estado): spec en `specs/F-06-api/`:
  - 15 requisitos (R1–R15), 7 decisiones (D1–D7) y 8 tareas, sin preguntas abiertas.
  - Contrato 0.6.0 → 0.7.0: `GET /queue`, `POST /encounters/{id}/start-care` y `POST /encounters/{id}/close` (PHYSICIAN, PA-F02-4).
  - **Sin migraciones.**
- Estado previo: **spec_ready**.

## Aprobación
- 2026-11-09: el humano aprobó la spec por chat ("Apruebo la spec"). F-06-api → **in_progress**. Brief F-06 y roadmap actualizados con PA-F06-1..5 resueltas.
- Siguiente paso: implementar desde una sesión de Claude Code abierta **dentro de `asclepio-api/`**, empezando por T1.
