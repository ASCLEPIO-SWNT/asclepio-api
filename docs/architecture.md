# Arquitectura — asclepio-api

Monolito modular NestJS 12 + TypeScript estricto, en ESM (`"type": "module"`, imports relativos con `.js`), con Jest (ts-jest ESM) (ADR 0001). PostgreSQL en Supabase vía Prisma, en el esquema `asclepio` (ADR 0003).

## Estructura
```
src/
├── main.ts                 # bootstrap: prefijo /api/v1, Swagger, filtro problem+json, logger
├── app.module.ts
├── app.setup.ts            # prefijo, ValidationPipe, filtro problem+json, OpenAPI (compartido con pruebas y export)
├── openapi-export.ts       # npm run openapi:export
├── generated/prisma/       # cliente Prisma generado (no versionado)
├── common/                 # transversal: health, problem+json, y más adelante guards, reloj y prisma.service
└── modules/
    ├── auth/  users/  tenancy/
    ├── patients/  encounters/  triage/  ai/
    ├── queue/  reports/  audit/
prisma/
├── schema.prisma           # provider postgresql, schemas = ["asclepio"] (Prisma 7: sin URLs aquí)
├── migrations/             # inmutables una vez creadas
└── seed.ts                 # idempotente (F-09)
openapi/asclepio-api.v1.json
ai/prompts/  ai/vignettes/
prisma.config.ts            # CLI de Prisma: DIRECT_URL (migraciones). Runtime: adapter pg con DATABASE_URL
test/                       # e2e/integración (Jest)
```

## Módulos y datos

| Módulo | Responsabilidad | Tablas propias | Puede usar (services) |
|---|---|---|---|
| `auth` | Login, JWT, guards de autenticación y rol | — | `users`, `audit` |
| `users` | Usuarios y roles | `users` | `tenancy` |
| `tenancy` | Tenants, sedes y contexto de tenant por petición | `tenants`, `sites` | — |
| `patients` | Búsqueda y alta de pacientes | `patients` | `audit` |
| `encounters` | Atenciones, máquina de estados, línea de tiempo y captura clínica | `encounters`, `encounter_events`, `vital_signs`, `symptom_findings` | `patients`, `audit` |
| `triage` | Decisiones humanas (VALIDATE/CORRECT/MANUAL) | `triage_decisions` | `encounters`, `ai`, `audit` |
| `ai` | Sugerencia: `LlmClient` (`GroqAdapter`, `OpenRouterAdapter`), `TriagePromptBuilder`, `TriageResponseValidator`, `SafetyGuards`, `TriageAdvisor` | `triage_suggestions` | `encounters` (solo lectura de la captura) |
| `queue` | Cola priorizada | — | `encounters`, `triage` |
| `reports` | Tiempos, cumplimiento, concordancia y CSV | — | `encounters`, `triage`, `ai` |
| `audit` | Escritura append-only de `audit_log` | `audit_log` | — |

## Dependencias

**Permitidas**
- `modules/*` → `common/*`.
- `modules/A` → el **service exportado** por `modules/B`, si figura en la tabla anterior.
- Solo el módulo dueño de una tabla usa su delegado Prisma (`prisma.<tabla>`).

**Prohibidas**
- Un módulo que consulta tablas de otro (`prisma.encounters` desde `queue`, por ejemplo).
- Dependencias circulares entre módulos.
- `common/` que importa de `modules/`.
- Llamadas HTTP al LLM fuera de los adaptadores de `ai`.
- Leer la hora del cliente para campos legales: se usa el `Clock` de `common/` (inyectable, para poder probarlo).
- Supabase JS, Supabase Auth, Storage o REST.

## Contrato
- `@nestjs/swagger` genera el OpenAPI, y `npm run openapi:export` lo escribe en `openapi/asclepio-api.v1.json` (ADR 0007).
- Prefijo `/api/v1`. Los errores siguen `application/problem+json` mediante un filtro global.

## Qué es "buen trabajo" aquí
- El cambio vive en el módulo correcto y respeta la tabla de dependencias.
- Cada `R<n>` tiene su prueba `R<n>: …` y pasa.
- No hay datos personales en logs, eventos ni payloads al LLM.
- La decisión humana es obligatoria antes de cualquier nivel final.
- Las migraciones son nuevas, nunca se editan, y se crean con `--create-only`.
- El snapshot OpenAPI está actualizado si cambió un endpoint.
