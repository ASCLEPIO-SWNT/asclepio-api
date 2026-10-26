# Historial de sesiones (append-only)

Cada sesión cerrada añade una entrada al final con: fecha, feature, resultado, archivos clave, decisiones y pendientes.

---

## 2026-10-26 — Harness SDD inicial
- **Resultado:** se crearon el harness SDD (agentes, hooks, `init.sh`, CHECKPOINTS) y el hub de producto (visión, glosario, RNF, briefs F-01…F-09, ADR 0001–0007, roadmap, modelo de datos).
- **Estado:** todas las features en `pending`.
- **Pendientes:** las preguntas abiertas consolidadas en `docs/roadmap.md`.

## 2026-10-26 — F-00-api: bootstrap técnico → done
- **Resultado:** NestJS 12 (ESM, TS ~6.0 strict), ESLint + Prettier y Jest (ts-jest ESM): unitarias 3 y e2e 4, todas en verde. Prisma 7 sin modelos (`schemas = ["asclepio"]`, `prisma.config.ts` con `DIRECT_URL`). Swagger en `/api/v1/docs` y `npm run openapi:export` → contrato **0.1.0**. Filtro global problem+json (con respuesta `default` en cada operación del OpenAPI). `GET /api/v1/health`, logs JSON nativos, `ai:eval` marcador y 10 carpetas de módulos con su README.
- **Decisiones:** Prisma 7 con config en lugar de `directUrl` en el schema (aprobado por el humano). ESM obligatorio porque Nest 12 solo se publica como ESM. `process.loadEnvFile` en lugar de dotenv. `@prisma/client` y `@prisma/adapter-pg` se instalarán con la primera feature con modelos.
- **Revisión:** la primera fue RECHAZADA (C8: `contract.version` null y problem+json sin declarar en el OpenAPI). Se corrigió y la segunda quedó APROBADA.
- **Pendiente:** `.env` local con valores ficticios; el humano debe poner los reales.
