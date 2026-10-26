# ADR 0007 — El contrato OpenAPI lo genera y versiona la API

- **Estado:** Aceptada
- **Fecha:** 2026-10-26

## Contexto
Hay tres repos independientes. Los clientes necesitan un contrato estable y verificable sin acoplarse al código de la API.

## Decisión
- **La API es la fuente de verdad.** El OpenAPI se genera con `@nestjs/swagger` (`npm run openapi:export`) y se versiona en `asclepio-api/openapi/asclepio-api.v1.json` con **semver** (`info.version`).
- Un cambio incompatible sube la versión mayor (y, si cambia la ruta, el prefijo `/api/v2`). Un cambio compatible sube la menor y una corrección, el parche.
- Todas las rutas cuelgan de **`/api/v1`**.
- Los errores siguen **`application/problem+json`** (RFC 9457).
- Los clientes generan sus tipos desde el snapshot (`openapi-typescript` en la web y DTOs Kotlin en el móvil) y **declaran qué versión consumen** (`consumes_contract` en `feature_list.json`).
- **Primero va el contrato:** un slice de cliente no pasa a `in_progress` si la versión de contrato que necesita no está publicada en el snapshot.

## Alternativas descartadas
- **Contrato escrito a mano primero (design-first):** se desincroniza del código sin una herramienta adicional.
- **GraphQL:** añade complejidad sin necesidad en un MVP CRUD con reportes.
- **Tipos compartidos por paquete:** no sirve para Kotlin y acopla los releases.

## Consecuencias
- Toda feature de API con `contract.changes = true` regenera el snapshot y fija `contract.version`.
- El revisor verifica C8 (snapshot actualizado y versión correcta).
