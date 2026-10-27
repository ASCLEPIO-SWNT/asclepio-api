# Verificación — asclepio-api

## Cómo se demuestra que algo funciona
1. `./init.sh`: entorno, harness, `.env`, estado y calidad (lint, typecheck, `prisma validate`, Jest).
2. `npm test`: pruebas unitarias y de integración.
3. `npm run openapi:export` sin diff, si la feature tocó el contrato.
4. Evidencia en `progress/impl_<id>.md` y el veredicto en `progress/review_<id>.md`.

## Trazabilidad R<n> → prueba
- Cada requisito `R<n>` de `specs/<id>/requirements.md` tiene al menos una prueba cuyo nombre empieza por `R<n>:`.
  ```ts
  it('R4: responde 403 si el rol no es NURSE', async () => { … });
  ```
- Para comprobarlo: `npx jest --listTests` más `grep -rn "R[0-9]\+:" src test`.
- `implementer` registra la tabla `R<n>` → `archivo::prueba` en `progress/impl_<id>.md`.

## Pruebas de integración contra la base
- Solo con datos de prueba prefijados (`DEV-<nombre>-test-…`), que se limpian al terminar. La limpieza nunca toca `audit_log` ni `encounter_events`: las pruebas usan un tenant de prueba propio y sus filas quedan, porque son append-only.
- Nunca `migrate reset`, `db push` ni `TRUNCATE`.
- **Decisión (humano, 2026-10-26):** las pruebas de integración usan un **PostgreSQL local o desechable (Docker)**, con su propia `DATABASE_URL` de pruebas. Nunca usan Supabase.
- **Cómo (F-01-api):** `npm run test:int` (`scripts/test-int.sh`):
  1. Comprueba con `scripts/assert-local-db.mjs` que `TEST_DIRECT_URL` y `TEST_DATABASE_URL` apuntan a `localhost`/`127.0.0.1` (por defecto, las de `docker-compose.test.yml`); si no, aborta. **No lee `.env`.**
  2. `docker compose -f docker-compose.test.yml up -d --wait` (PostgreSQL 17 en `127.0.0.1:54329`, credenciales ficticias).
  3. `prisma migrate deploy` con `DIRECT_URL` local fijada en la línea de comandos.
  4. Da `LOGIN` y contraseña local a `asclepio_app` (solo en Docker).
  5. `npm run build` (los scripts CLI se prueban como proceso hijo desde `dist/`) y Jest con `test/jest-int.json` (`test/*.int-spec.ts`), conectado como `asclepio_app`.
  - El contenedor queda levantado para repetir; se detiene con `docker compose -f docker-compose.test.yml down`.
  - Los tenants de prueba (`DEV-test-…-<sufijo>`) no se borran porque `audit_log` los referencia; sí se borran sus usuarios, sedes, pacientes y cuentas.
- `npm test` y `./init.sh` **no** necesitan base: las pruebas e2e (`test/*.e2e-spec.ts`) usan la app completa sin `DATABASE_URL` (Prisma conecta de forma perezosa).

## Alta de personal y sedes (scripts CLI, F-01-api)
- `npm run users:create -- --email <email> --full-name DEV-<nombre> --role <RECEPTION|NURSE|PHYSICIAN|ADMIN> --tenant DEV-<IPS>`; la contraseña (10–128 caracteres) se lee por la entrada estándar, sin eco. Idempotente por email.
- `npm run sites:create -- --tenant DEV-<IPS> --name DEV-<sede>`. Idempotente por IPS y nombre.
- Ambos crean la IPS si no existe, auditan (`USER_CREATED` / `SITE_CREATED`, actor `SYSTEM`) y, mientras `NODE_ENV` no sea `production`, exigen el prefijo `DEV-`. Usan `DATABASE_URL` (de `.env` o del entorno).

## Componentes de IA
- `TriageResponseValidator` y `SafetyGuards`: pruebas **sin mocks del LLM**, con respuestas JSON literales y entradas clínicas sintéticas.
- `TriageAdvisor`: se prueba con un `LlmClient` falso, que es un puerto y no un mock del proveedor real, para cubrir el fallback, el timeout, el reintento y `INVALID_OUTPUT`.
- Privacidad: hay una prueba que construye el payload con un paciente que tiene nombre y documento y verifica que no aparecen.

## Evaluación con viñetas (`npm run ai:eval`)
Se ejecuta **solo** cuando cambian el prompt (`ai/prompts/`, `prompt_version`) o el modelo (`GROQ_MODEL`/`OPENROUTER_MODEL`), y nunca dentro de `init.sh` ni de las pruebas.
1. Comprueba que `.env` tiene las claves reales del LLM.
2. Ejecuta `npm run ai:eval`. Recorre `ai/vignettes/*.json` y llama al LLM real.
3. Revisa el resumen: porcentaje de acierto, porcentaje de subclasificación y guards aplicados.
4. Guarda el resultado en `progress/impl_<id>.md` junto con `prompt_version` y el modelo.
5. Un cambio que aumente la subclasificación no se acepta. El umbral exacto está en PA-F04-6.

## Demo extremo a extremo (comprobación manual)
Requiere F-01…F-09 en `done`, el seed aplicado y la API, la web y el móvil en local.
- [ ] `GET /api/v1/health` → 200.
- [ ] **Móvil (RECEPTION):** login → buscar paciente por documento → no existe → crearlo → crear la atención con el motivo dictado (o escrito si no hay reconocimiento local). La hora de llegada la pone el servidor.
- [ ] **Web (NURSE):** ver la atención en espera → capturar los signos (caso 7:42: FC 112, PA 150/95, SatO₂ 94 %) → solicitar la sugerencia → aparece el nivel con su explicación y factores, y el aviso si hubo guard.
- [ ] **Web (NURSE):** "Validar" y "Corregir" tienen el mismo peso visual → corregir sin motivo está bloqueado → validar. La atención pasa a `TRIAGED` con hora del servidor y responsable.
- [ ] Una segunda decisión sobre la misma atención → 409.
- [ ] **Fallback:** con claves de LLM inválidas (en un `.env` local) se ofrece triage manual y el flujo no se bloquea.
- [ ] **Web (PHYSICIAN):** la cola muestra la atención ordenada por nivel y espera.
- [ ] **Web (ADMIN):** los reportes muestran los tiempos, el cumplimiento y la concordancia → se descarga el CSV, sin nombres y con horas ISO-8601.
- [ ] La línea de tiempo de la atención muestra todos los eventos con hora (en `America/Bogota`) y responsable.
- [ ] Los logs de la API no contienen nombres ni documentos.
