# Convenciones — asclepio-api

## Nombres
- Archivos en `kebab-case` (`triage-advisor.service.ts`). Clases en `PascalCase`; variables y funciones en `camelCase`; constantes en `UPPER_SNAKE_CASE`.
- Tablas y columnas en `snake_case` (con `@@map` y `@map` de Prisma); los modelos de Prisma en `PascalCase` singular.
- Enums en `UPPER_SNAKE_CASE` (`WAITING_TRIAGE`, `VOICE_ON_DEVICE`).
- Rutas REST en plural y `kebab-case`: `/api/v1/encounters/:id/triage-decision`.
- Identificadores en inglés y documentación en español.

## Formato
- Prettier (comillas simples, coma final) y ESLint con `@typescript-eslint` estricto. El hook PostToolUse formatea el archivo tocado.
- TypeScript `strict: true`. Sin `any` implícito.

## Errores
- Siempre `application/problem+json` (RFC 9457): `type`, `title`, `status`, `detail`, `instance` y, para la validación, `errors[]` con `{ field, message }`.
- 400 petición mal formada · 401 sin autenticación · 403 rol no permitido · 404 inexistente o de otro tenant · 409 conflicto de estado · 422 validación de negocio · 502/504 fallo del proveedor LLM (solo interno; al cliente le llega la sugerencia con su `status`).
- Nunca se exponen trazas ni SQL en `detail`.

## Fechas y tiempo
- `timestamptz` en UTC y horas legales con el reloj del servidor (el `Clock` inyectable de `common/`).
- La API emite ISO-8601 con `Z`. La conversión a `America/Bogota` la hacen los clientes y los reportes (los rangos de fechas se interpretan en Bogotá).

## Validación
- DTOs con `class-validator` y `class-transformer`; `ValidationPipe` global con `whitelist: true` y `forbidNonWhitelisted: true`.
- Las respuestas del LLM se validan contra un esquema JSON en `TriageResponseValidator`.

## Logs
- JSON estructurado: `level`, `msg`, `requestId`, `tenantId`, `userId`, `module`.
- **Prohibido** registrar nombres, documentos, texto clínico libre, tokens o secretos.

## Pruebas
- Jest. Las unitarias van junto al código (`*.spec.ts`); las de integración y e2e, en `test/` (`*.e2e-spec.ts`).
- El nombre de la prueba empieza por `R<n>:` cuando cubre un requisito.

## Commits
- Conventional Commits: `feat(triage): …`, `fix(ai): …`, `chore: …`, `docs(adr): …`, `test(encounters): …`.
- Un commit por tarea lógica; referencia la feature en el cuerpo (`Refs: F-05-api`).
