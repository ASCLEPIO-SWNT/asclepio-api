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

## 2026-10-26 — F-01-api: autenticación, roles y tenancy → done
- **Resultado:** login de personal (email) y de paciente (documento) con JWT HS256 de 8 h (`jose`; audiencias `asclepio-staff` y `asclepio-patient`), sin refresh token. Bloqueo de 15 min tras 5 fallos y 401 genérico. Contraseñas con scrypt de `node:crypto`. Guard global que deniega por defecto (`@Public`, `@StaffRoles`, `@PatientOnly`) y tenant tomado del token (404 entre tenants). `GET /me`. Alta de cuenta de paciente con consentimiento (`PATIENT_CONSENT_VERSION`, `consent_at`), mayoría de edad, CC/CE/PA, `identity_verified = false`, vinculación sin sobrescribir el `patients` existente y 409 si ya hay cuenta. Endpoints públicos de IPS y sedes y de consentimiento, con throttling (10 por minuto por IP y endpoint). Auditoría append-only en la misma transacción y sin datos personales. CLI `users:create` y `sites:create` con prefijo `DEV-`.
- **Datos:** 3 migraciones (`f01_auth_tenancy`, `f01_app_role_grants` con el rol `asclepio_app` limitado a SELECT e INSERT en `audit_log`, y `f01_audit_log_fk_restrict`). **Sin aplicar aún en Supabase:** lo hace el responsable de backend con `migrate deploy`.
- **Pruebas:** unitarias 41, e2e 29 e integración 86 (`npm run test:int`, PostgreSQL 17 en Docker en el puerto 54329, con guardián de localhost). R1–R51 cubiertos. Contrato **0.2.0**.
- **Revisión:** la 1 fue RECHAZADA (la FK `audit_log.tenant_id` con SET NULL permitía modificar la auditoría al borrar un tenant). Se corrigió con RESTRICT y la revisión 2 quedó APROBADA.
- **Pendientes:** (1) el humano debe actualizar su `.env` (`JWT_SECRET` de 32 caracteres o más y `PATIENT_CONSENT_VERSION`); (2) `ProblemDetails.instance` debería usar `req.path` en lugar de `originalUrl`; (3) `init.sh` podría comprobar `PATIENT_CONSENT_VERSION`; (4) el hook de migraciones impide editar la migración vacía de `--create-only` (pendiente de decisión del humano); (5) hará falta `trust proxy` para el throttling cuando haya despliegue; (6) el texto de `docs/legal/consentimiento.md` lo tiene que redactar el equipo.

## 2026-10-27 — F-02-api: pre-registro del paciente y confirmación de llegada → done
- **Resultado:** el paciente edita su perfil (nombre, fecha de nacimiento y sexo, solo antes de que se verifique su identidad) y envía un pre-registro (sede, motivo, `complaint_source`), con hora del servidor. Máximo un pre-registro vigente y una atención activa por paciente (índices únicos parciales). Expiración perezosa a las 6 h. El paciente ve el estado sin datos de triage. Recepción tiene la bandeja de pendientes del tenant (filtro `siteId`) y puede confirmar (verifica la identidad; crea la atención con `arrival_at` del servidor y la pasa a `WAITING_TRIAGE` con dos eventos; la doble confirmación da 409) o rechazar con motivo. Registro directo (NN con edad estimada, menores), búsqueda por documento, máquina de estados con 409 en transiciones inválidas, cancelación por RECEPTION y NURSE con motivo. `encounter_events` append-only con actor y hora del servidor, auditoría sin datos personales y consulta de la atención con su línea de tiempo. Contrato **0.3.0**.
- **Datos:** 2 migraciones (`f02_patients_encounters`, `f02_app_role_grants`). **Sin aplicar aún en Supabase.**
- **Pruebas:** 49 unitarias, 42 e2e y 188 de integración (Docker). R1–R49 cubiertos.
- **Revisión:** APROBADA.
- **Incidente:** el commit `42f48b8` (harness) arrastró por error renombrados preparados por el implementer sin sus imports, y `main` dejó de compilar hasta el commit de cierre de F-02. Lección: el leader debe comprobar `git diff --cached` antes de un commit parcial con el implementer trabajando en el mismo repo.
- **Pendientes (observaciones del reviewer):** (1) las FK de `encounters` y `pre_registrations` hacia tenants, sites, patients y users tienen `ON UPDATE CASCADE` (modificación sin rastro): pasarlas a RESTRICT en una migración nueva; (2) `ProblemDetails.instance` usa `originalUrl` y puede devolver el documento de la query: usar `req.path`; (3) revisar con `--create-only` los índices parciales (preview `partialIndexes`) en futuras migraciones.
