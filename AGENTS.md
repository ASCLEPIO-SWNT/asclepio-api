# AGENTS.md — mapa de asclepio-api

Backend NestJS (monolito modular) de Asclepio, triage de urgencias asistido por IA. *La IA propone, el profesional decide.* Este mapa sigue la **divulgación progresiva**: lee solo lo que necesites en cada momento.

## 1. Antes de empezar
1. Ejecuta `./init.sh`. **Si falla, para** y reporta.
2. Lee `feature_list.json` y los archivos de `progress/current/`.
3. Antes de escribir o revisar cualquier spec, lee `docs/specs.md`.

## 2. Archivos y carpetas

| Ruta | Qué contiene | Cuándo leerlo |
|---|---|---|
| `feature_list.json` | Slices de este repo, estados y dependencias | Siempre, al empezar |
| `progress/current/<id>.md` | Estado vivo de la feature en curso | Siempre, al empezar |
| `progress/history.md` | Registro append-only de sesiones cerradas | Si necesitas contexto histórico |
| `specs/<id>/` | requirements, design y tasks de un slice | Al especificar, implementar o revisar ese slice |
| `docs/specs.md` | Proceso SDD, EARS y la puerta de aprobación | Antes de cualquier spec |
| `docs/architecture.md` | Módulos, límites y dependencias permitidas | Antes de diseñar o implementar |
| `docs/conventions.md` | Nombres, errores, fechas, validación, commits | Antes de implementar |
| `docs/verification.md` | Cómo probar, la trazabilidad, la demo y `ai:eval` | Antes de implementar o revisar |
| `CHECKPOINTS.md` | Criterios C1–C8 del estado final | Al revisar o cerrar |
| `docs/product/vision.md` | Qué es Asclepio y por qué | Contexto de producto |
| `docs/product/glossary.md` | Términos del dominio | Si un término no es claro |
| `docs/product/non-functional.md` | RNF-01… | Al especificar |
| `docs/product/features/F-0X.md` | Brief global de cada feature y sus criterios `F-0X.ACn` | Al especificar ese slice |
| `docs/adr/` | Decisiones de arquitectura cerradas | Antes de proponer algo que las contradiga (no lo hagas) |
| `docs/roadmap.md` | Backlog global, slices, trazabilidad y preguntas abiertas | Al planificar |
| `docs/data-model.md` | Entidades, inmutabilidad y tiempo | Antes de cualquier migración |
| `openapi/asclepio-api.v1.json` | Contrato publicado (fuente de verdad) | Al cambiar endpoints |
| `ai/prompts/`, `ai/vignettes/` | Prompts versionados y viñetas de evaluación | En F-04 |
| `.claude/agents/` | Roles: leader, spec_author, implementer, reviewer | Según tu rol |

## 3. Reglas duras
- **Una feature por sesión.**
- **No se marca `done` sin pruebas en verde** (`./init.sh` completo).
- **No se salta la spec** cuando `sdd: true`.
- **No se salta la aprobación humana**, que se da **por chat**.
- Documenta en `progress/current/<id>.md` mientras trabajas.
- **No inventes requisitos clínicos.** Búscalos en `docs/` o pregunta.
- **El contrato va primero:** un cambio de endpoint actualiza el snapshot OpenAPI y su versión semver.
- **Base compartida (ADR 0003):**
  - Los cambios de esquema se hacen solo con Prisma Migrate.
  - Contra la base compartida solo se ejecuta `prisma migrate deploy`, y lo decide el humano.
  - Prohibidos: `migrate reset`, `migrate dev` (salvo `--create-only`) y `db push`.
  - No se editan migraciones ya versionadas en git; una recién creada con `--create-only` (sin commit) sí se rellena.
  - El seed es idempotente; los datos de desarrollo llevan el prefijo `DEV-<nombre>-`.
  - `audit_log` y `encounter_events` son append-only.
- Un módulo no accede a las tablas de otro: usa su service.
- No se llama a Groq ni a OpenRouter fuera de `npm run ai:eval` o del uso manual de la app.

## 4. Flujo
```
pending → [spec_author] → spec_ready → ⏸ aprobación por chat → in_progress → [implementer → reviewer] → done
```
Las features `sdd: false` (F-00, F-09) saltan la spec, pero no el reviewer.

## 5. Cierre de sesión
1. `./init.sh` en verde.
2. Actualiza el estado en `feature_list.json` (y `docs/roadmap.md` si la feature quedó `done`).
3. Mueve el resumen de `progress/current/<id>.md` al final de `progress/history.md` y borra el archivo de la feature (y `progress/impl_<id>.md` y `progress/review_<id>.md`).
4. Sin archivos temporales, logs de depuración ni TODOs sin contexto.

## 6. Si te bloqueas
Documenta el bloqueo en `progress/current/<id>.md` (qué, por qué, qué se necesita) y **para**. No inventes workarounds.
