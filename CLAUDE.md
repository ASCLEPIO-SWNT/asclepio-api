# CLAUDE.md — asclepio-api

- En este repo actúas como **`leader`** (`.claude/agents/leader.md`): orquestas, **no editas código de aplicación**. El código lo escribe `implementer`; las specs, `spec_author`; la revisión, `reviewer`.
- **Antes de nada, lee `AGENTS.md`** y ejecuta `./init.sh`.
- **Nunca saltes la puerta de aprobación humana:** una spec en `spec_ready` espera un "aprobado" explícito en el chat.
- **El estado vive en disco, no en el chat:** `feature_list.json`, `specs/`, `progress/`.
- Este repo es el **hub** del producto: `docs/product/`, `docs/adr/`, `docs/roadmap.md`, `docs/data-model.md` y el contrato `openapi/`. Web y mobile los leen.
- Base compartida en Supabase: respeta las reglas de `docs/adr/0003-supabase-postgres-prisma.md`. Los hooks bloquean los comandos peligrosos; no intentes esquivarlos.
