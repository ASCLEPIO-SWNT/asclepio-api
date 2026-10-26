# ADR 0002 — Tres repositorios independientes

- **Estado:** Aceptada
- **Fecha:** 2026-10-26

## Contexto
Hay tres artefactos con stacks y ciclos distintos: la API (Node), la web (Node/Vite) y el móvil (Kotlin/Gradle). Queremos que cada uno tenga su propio harness SDD y que los agentes trabajen en un repo acotado.

## Decisión
Hay tres repos Git independientes: `asclepio-api`, `asclepio-web` y `asclepio-mobile`, colocados uno al lado del otro en una carpeta local (que no es un repo). No hay monorepo ni repos adicionales.
- `asclepio-api` es el **hub**: guarda la documentación de producto, los ADR, el roadmap, el modelo de datos y el contrato OpenAPI.
- Web y móvil leen `../asclepio-api/docs` y `../asclepio-api/openapi` en **solo lectura**, y un hook lo hace cumplir.

## Alternativas descartadas
- **Monorepo (Nx, Turborepo, Gradle compuesto):** mezcla toolchains Node y Android y complica el harness y los hooks por stack.
- **Repo de documentación aparte:** sería un cuarto repo que sincronizar, sin ventaja frente a usar la API como hub, que de todos modos es la fuente del contrato.
- **Paquete npm compartido de tipos:** innecesario; los clientes generan sus tipos desde el snapshot OpenAPI.

## Consecuencias
- Cada repo tiene su `feature_list.json`; una feature global se divide en slices por repo (ver `docs/roadmap.md`).
- Las rutas relativas `../asclepio-api` exigen clonar los tres repos uno junto al otro (se documenta en cada README).
- La coordinación entre repos se hace por la versión del contrato, no por commits atómicos.
