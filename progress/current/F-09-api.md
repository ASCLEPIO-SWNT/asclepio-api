# F-09-api — Datos sintéticos y guion de demo

**Estado:** in_progress (sdd: false, sin spec) · rama `feature/F-09-api` · inicio 2026-11-17

## Objetivo
Seed idempotente con datos `DEV-<nombre>-` y guion de demo extremo a extremo (F-09.AC1–AC5).

## Decisiones del humano (2026-11-17, por chat)
- **PA-F09-1 (volumen):** 1 tenant, 1 sede; 1 usuario por rol (RECEPTION, NURSE, PHYSICIAN, ADMIN) con contraseñas solo de desarrollo documentadas; ~8 cuentas de paciente; ~30 atenciones históricas cerradas en los últimos 7 días (America/Bogota), niveles I–V, ~5 correcciones (concordancia < 100 %); ~6 atenciones vivas: 1 pre-registro pendiente, 2 WAITING_TRIAGE (una es el caso 7:42 p. m. de vision.md, sin triage), 3 TRIAGED en cola (una nivel II cerca de vencer la alerta). Máx. 1 pre-registro pendiente y 1 atención activa por paciente.
- Prefijo `DEV-<nombre>-`, datos 100 % sintéticos.
- Seed en `prisma.config.ts` (`migrations.seed`) + script npm `db:seed`. Guardián: solo localhost salvo `ALLOW_REMOTE_SEED=1`. Ningún agente lo ejecuta contra Supabase.
- Sin migraciones ni cambios de contrato: si hacen falta, parar y preguntar.
- AC5: reescribir "Demo extremo a extremo" de `docs/verification.md` (flujo ADR 0008).
- Al cerrar: `feature_list.json`, `progress/`, `docs/roadmap.md` (fila F-09-api + slices web/mobile done en "Estado de slices").

## Plan
1. implementer → seed, config, script, prueba int, docs/verification.md.
2. reviewer.
3. `./init.sh` + `npm run test:int` en verde → done.

## Bloqueos
Ninguno.
