# F-02-api — Pre-registro del paciente y confirmación de llegada (sdd: true)

- **Inicio:** 2026-10-26 · Dependencias: F-01-api done (contrato 0.2.1).
- **Fuentes:** `docs/product/features/F-02.md` (F-02.AC1–AC10), ADR 0008 (pre-registro desde el teléfono del paciente; recepción confirma en la web; la llegada legal es la confirmación), ADR 0003, `docs/data-model.md` (propuesta de `pre_registrations` y estados de `encounters`), RNF-01, 02, 03, 10, 11, 12 y 15.
- **Decisiones humanas ya tomadas:** sede elegida de una lista; pre-registro expira a las 6 h; el paciente solo ve el estado (nunca el nivel); cuentas con `identity_verified = false` hasta que recepción verifique en el primer pre-registro; menores registrados directamente por recepción; pruebas de integración con PostgreSQL en Docker; `migrate deploy` en Supabase lo ejecuta el responsable de backend.
- **Preguntas abiertas heredadas del brief:** PA-F02-1 (datos mínimos del paciente), PA-F02-2 (paso automático a WAITING_TRIAGE), PA-F02-3 (quién cancela y si exige motivo), PA-F02-4 (quién pasa a IN_CARE/CLOSED).

## Plan
1. spec_author → `specs/F-02-api/`.
2. ⏸ Aprobación humana.
3. implementer → reviewer → done.

## Estado
- 2026-10-26: spec escrita (R1–R49, T1–T20) → **spec_ready**. ⏸ 9 preguntas abiertas presentadas al humano.
- **2026-10-26: APROBADA por el humano en el chat** ("acepto las propuestas, aprobado"): PA-F02-1…9 con las propuestas y precisiones de la spec. El spec_author las registra (spec, brief F-02 y roadmap) antes de implementar.
- 2026-10-26: sin preguntas abiertas → **in_progress**. Se lanza el implementer.
