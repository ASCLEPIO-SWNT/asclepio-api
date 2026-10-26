# ADR 0005 — SafetyGuards deterministas que solo suben la gravedad

- **Estado:** Aceptada
- **Fecha:** 2026-10-26

## Contexto
Un LLM puede subclasificar un caso grave. La subclasificación es el error clínicamente más peligroso del triage.

## Decisión
- Después de validar la respuesta del LLM, se aplican **reglas deterministas** (`SafetyGuards`) sobre la entrada clínica.
- Una regla **solo puede subir** la gravedad (bajar el número de nivel, por ejemplo de III a II). **Nunca la baja.**
- Cuando una regla actúa, se guarda `guard_applied = true` y `guard_reasons`, con el identificador de la regla y el valor que la disparó. Siempre queda registrado.
- Cada regla tiene al menos una prueba que **no usa mocks del LLM**.
- **Los umbrales concretos no se definen en este ADR.** Están en la pregunta abierta PA-F04-1 y requieren un asesor clínico. No se implementa ninguna regla sin un umbral aprobado y documentado.

## Alternativas descartadas
- **Confiar solo en el LLM:** no hay garantía de que no subclasifique.
- **Reglas que también bajan la gravedad:** aumentarían el riesgo; la sobreclasificación es el error tolerable.
- **Reglas dentro del prompt:** no son deterministas ni verificables.

## Consecuencias
- El sistema tiende a la sobreclasificación, que se mide en los reportes (F-07).
- Los guards son el componente con más exigencia de pruebas (C7).
