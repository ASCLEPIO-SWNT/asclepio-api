# F-01-api — Autenticación, roles y tenancy (sdd: true)

- **Inicio:** 2026-10-26 · Dependencias: F-00-api en done.
- **Fuentes:** `docs/product/features/F-01.md` (AC1–AC5, AC7–AC8), ADR 0003, ADR 0008, `docs/data-model.md`, RNF-01, 02, 05, 10, 11, 12 y 18.
- **Decisiones humanas ya tomadas:** JWT de 8 h sin refresh; contraseña ≥ 10 caracteres y bloqueo de 15 min tras 5 intentos; un rol y un tenant por usuario; cuenta de paciente con documento + contraseña, separada de `users`, sin menores, con consentimiento obligatorio (`consent_at` + versión); pruebas de integración con PostgreSQL local en Docker; `migrate deploy` en la base compartida solo lo ejecuta el responsable de backend.

## Plan de la sesión
1. spec_author → `specs/F-01-api/{requirements,design,tasks}.md`.
2. ⏸ Aprobación humana por chat.
3. implementer → reviewer → done.

## Estado
- 2026-10-26: spec escrita por spec_author (36 R, 18 tareas) → **spec_ready**.
- ⏸ No se puede aprobar: 9 preguntas abiertas (PA-1…PA-9 en `specs/F-01-api/requirements.md`). Se presentaron al humano con propuestas.
- 2026-10-26: el humano respondió PA-1…PA-9 ("acepto las propuestas"); spec actualizada (R1–R47). Apareció PA-10 (creación de sedes).
- **2026-10-26: APROBADA por el humano en el chat** ("acepto PA-10, aprobado"), junto con las 4 decisiones de diseño señaladas (límite por IP y por endpoint, no sobrescribir el `patients` existente, IPS inactiva → 401/422, sex M/F/X). PA-10 → script `sites:create`; el spec_author lo registra antes de implementar.
- 2026-10-26: PA-10 registrada (R48–R51, T17). Sin preguntas abiertas → **in_progress**. Se lanza el implementer.
