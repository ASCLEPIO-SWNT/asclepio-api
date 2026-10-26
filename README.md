# asclepio-api

Backend de **Asclepio**: triage de urgencias asistido por IA para IPS en Colombia. *La IA propone, el profesional decide.*

Es un monolito modular en NestJS + TypeScript, con PostgreSQL en Supabase vía Prisma y una IA basada en un LLM (Groq, con OpenRouter de respaldo). Este repo es también el **hub de documentación** del producto y la **fuente del contrato OpenAPI**.

## Espacio de trabajo
Los tres repos van uno junto al otro (los clientes leen `../asclepio-api`):
```
asclepio/
├── asclepio-api/      ← este repo
├── asclepio-web/
└── asclepio-mobile/
```

## Arranque
> El esqueleto técnico llega con **F-00-api**. Hasta entonces, el repo solo contiene el harness y la documentación.

```bash
cp .env.example .env      # rellena los valores reales (nunca los subas)
./init.sh                 # verifica el entorno, el harness, el .env, el estado y la calidad
./init.sh --quick         # igual, pero sin pruebas
```

Después de F-00: `npm install`, `npm run start:dev` → `http://localhost:3000/api/v1/health`.

## Cómo trabajar con el harness (SDD)
1. Abre Claude Code en este directorio. `CLAUDE.md` lo pone en el rol **leader**.
2. El leader elige la siguiente feature `pending` de `feature_list.json` y lanza `spec_author`.
3. La spec queda en `specs/<id>/` → **la revisas y respondes "aprobado" en el chat**.
4. `implementer` implementa con las pruebas primero; `reviewer` verifica `CHECKPOINTS.md`.
5. Con todo en verde, la feature queda `done` y su resumen pasa a `progress/history.md`.

Lectura recomendada: `AGENTS.md` → `docs/product/vision.md` → `docs/roadmap.md` → `docs/specs.md`.

## Reglas clave
- Base **compartida**: nada de `migrate reset`, `migrate dev` ni `db push` (hay hooks que lo bloquean). Ver `docs/adr/0003-supabase-postgres-prisma.md`.
- Solo datos **sintéticos**.
- El payload al LLM nunca lleva nombre ni documento.
