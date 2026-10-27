# ADR 0003 — Supabase como PostgreSQL compartido, con Prisma

- **Estado:** Aceptada
- **Fecha:** 2026-10-26

## Contexto
El equipo necesita una base PostgreSQL accesible para todos sin administrar servidores, y no hay infraestructura de despliegue. La base es compartida, de modo que un error de un desarrollador afecta a todos.

## Decisión
- **Supabase se usa solo como PostgreSQL.** No se usan Supabase Auth, Storage ni la API REST/PostgREST.
- **Prisma** es el ORM y la herramienta de migraciones. Las tablas viven en el esquema `asclepio`, no en `public`.
- `DATABASE_URL` apunta al pooler en modo transacción (puerto 6543, `?pgbouncer=true`). `DIRECT_URL` es la conexión directa o de sesión (puerto 5432) y se usa para migraciones.
- Reglas de la base compartida:
  - Los cambios de esquema se hacen **solo con Prisma Migrate**. En la base compartida solo se ejecuta `prisma migrate deploy`.
  - Están **prohibidos** `prisma migrate reset`, `prisma migrate dev` contra la compartida (sí se permite `--create-only` para generar el SQL) y `prisma db push`.
  - Las migraciones ya versionadas en git no se editan. El flujo es crear la migración con `prisma migrate dev --create-only` contra el PostgreSQL local, rellenarla o revisarla, y hacer commit; desde ese momento es inmutable.
  - El seed es idempotente y los datos de desarrollo llevan el prefijo `DEV-<nombre>-`.
  - NestJS se conecta con un rol propio, `asclepio_app`, **sin `UPDATE`/`DELETE`** sobre `audit_log` y `encounter_events`.
- Las horas son `timestamptz` en UTC.
- **Prisma 7** (decisión humana del 2026-10-26): las URLs ya no van en `schema.prisma`. `prisma.config.ts` usa `DIRECT_URL` para el CLI (validate, migrate deploy). En runtime, `PrismaClient` se instancia con `@prisma/adapter-pg` sobre `DATABASE_URL` (pooler 6543). El cliente se genera en `src/generated/prisma` (no versionado).

## Alternativas descartadas
- **Supabase Auth/REST:** acoplaría la lógica de autorización y multi-tenant a RLS y a la API de Supabase, fuera del monolito que se prueba en NestJS.
- **PostgreSQL local por desarrollador:** se descartó por la decisión de una base compartida, aunque nada impide usarlo para pruebas aisladas.
- **TypeORM o Drizzle:** Prisma ofrece migraciones declarativas y tipos generados con menos configuración.

## Consecuencias
- Hooks del harness bloquean los comandos destructivos y la edición de migraciones existentes.
- Los permisos de `asclepio_app` se crean en una migración SQL (se definirá en la primera feature que toque la base).
- `init.sh` nunca escribe en la base.
- **Coordinación (humano, 2026-10-26):** solo el **responsable de backend** ejecuta `prisma migrate deploy` sobre la base compartida y avisa al equipo antes y después.
- **Pruebas de integración (humano, 2026-10-26):** se ejecutan contra un **PostgreSQL local o desechable (Docker)**, nunca contra Supabase. Supabase se reserva para desarrollo compartido y la demo.
