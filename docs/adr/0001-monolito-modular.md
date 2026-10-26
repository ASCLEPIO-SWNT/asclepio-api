# ADR 0001 — Backend como monolito modular en NestJS + TypeScript

- **Estado:** Aceptada
- **Fecha:** 2026-10-26

## Contexto
Somos un equipo pequeño de curso que debe entregar un MVP de extremo a extremo. El dominio (atenciones, triage, IA, cola, reportes, auditoría) tiene límites claros, pero no hay necesidad de escalar ni de desplegar cada parte por separado.

## Decisión
El backend es un único proceso **NestJS + TypeScript** con estos módulos: `auth`, `users`, `tenancy`, `patients`, `encounters` (con la línea de tiempo), `triage`, `ai`, `queue`, `reports` y `audit`.
- Un módulo **no accede a las tablas de otro**: usa el service exportado por ese módulo.
- El código vive en `src/modules/<módulo>/`. Lo transversal va en `src/common/` y el esquema en `prisma/`.

## Alternativas descartadas
- **Microservicios:** suman despliegue, red, contratos internos y consistencia distribuida sin ningún beneficio a esta escala.
- **Monolito sin módulos (capas globales):** acopla todo y hace imposible razonar sobre los límites de datos ni dividir el trabajo entre agentes.
- **Otro framework (Express suelto, Fastify sin estructura):** obliga a reinventar la inyección de dependencias, la validación y Swagger que NestJS trae integrados.

## Consecuencias
- Un solo despliegue y una sola base. Las pruebas de integración son simples.
- Los límites se mantienen por convención y revisión (C3 en `CHECKPOINTS.md`), no por red.
- Si más adelante hace falta, un módulo se puede extraer porque su acceso a datos ya pasa por su service.
