# Spec-Driven Development (SDD)

> Este archivo es **idéntico** en `asclepio-api`, `asclepio-web` y `asclepio-mobile`. Si lo cambias en uno, cámbialo en los tres.

Toda feature con `"sdd": true` en `feature_list.json` sigue este flujo:

```
requirements (EARS) → design → tasks → ⏸ aprobación humana por chat → código
```

Los tres archivos viven en `specs/<id>/` (por ejemplo, `specs/F-05-api/`):

| Archivo | Quién lo escribe | Qué contiene |
|---|---|---|
| `requirements.md` | `spec_author` | Requisitos EARS numerados `R1, R2…`, cada uno trazado a un `F-0X.ACn`, y las preguntas abiertas. |
| `design.md` | `spec_author` | Decisiones técnicas con la alternativa descartada, **Impacto en contrato** e **Impacto en datos**. |
| `tasks.md` | `spec_author` (los `[x]` los marca `implementer`) | Checklist ordenado; cada tarea indica qué `R<n>` cubre. |

## 1. `requirements.md` — EARS en español

### Reglas
- Un requisito por línea, numerado `R1`, `R2`… La numeración no se reutiliza: si un requisito se elimina, se tacha.
- Cada requisito termina con su traza: `(→ F-0X.ACn)`. Un requisito sin traza a un criterio global no se acepta. Si hace falta, primero se propone el cambio al brief.
- Cada requisito es **verificable con una prueba** cuyo nombre empieza por `R<n>:`.
- Se usa estrictamente una de las cinco plantillas, con "deberá" como verbo:

| Tipo | Plantilla |
|---|---|
| **Ubicuo** | El sistema deberá `<respuesta>`. |
| **Por evento** | Cuando `<evento>`, el sistema deberá `<respuesta>`. |
| **Por estado** | Mientras `<estado>`, el sistema deberá `<respuesta>`. |
| **No deseado** | Si `<condición>`, entonces el sistema deberá `<respuesta>`. |
| **Opcional** | Donde `<característica>`, el sistema deberá `<respuesta>`. |

- Prohibido: "debería", "podría", "rápido", "amigable", "etc." y otros términos sin medida. Si falta un valor clínico o un umbral, **no se inventa**: va a Preguntas abiertas.

### Estructura
```markdown
# <id> — <título>

Brief global: <ruta al F-0X.md>
Contrato: <versión que produce (api) o consume (clientes)>
RNF aplicables: RNF-xx, …

## Requisitos
- **R1** (<tipo>) <texto EARS>. (→ F-0X.ACn)
- …

## Preguntas abiertas
- [ ] PA-1 <pregunta> — bloquea R<n>
```

### Ejemplo completo (slice ficticio `F-05-api`: validar o corregir)

```markdown
# F-05-api — Validar o corregir la sugerencia

Brief global: docs/product/features/F-05.md
Contrato: produce 1.4.0 (menor: endpoint nuevo)
RNF aplicables: RNF-01, RNF-02, RNF-03, RNF-10, RNF-12

## Requisitos
- **R1** (Por evento) Cuando una enfermera envíe una decisión `VALIDATE` sobre una atención en `WAITING_TRIAGE` con sugerencia `OK`, el sistema deberá registrar la decisión con el nivel sugerido, `decided_by` igual al usuario autenticado y `decided_at` igual a la hora del servidor. (→ F-05.AC1, F-05.AC2)
- **R2** (Por evento) Cuando una enfermera envíe una decisión `CORRECT`, el sistema deberá exigir un nivel entero entre 1 y 5 y un motivo no vacío. (→ F-05.AC1)
- **R3** (No deseado) Si una decisión `CORRECT` llega sin motivo o con un nivel fuera de 1–5, entonces el sistema deberá responder 422 en `application/problem+json` sin registrar nada. (→ F-05.AC1)
- **R4** (No deseado) Si el usuario autenticado no tiene el rol `NURSE`, entonces el sistema deberá responder 403 en `application/problem+json`. (→ F-05.AC4)
- **R5** (Por evento) Cuando se registre una decisión, el sistema deberá, en la misma transacción, pasar la atención a `TRIAGED`, fijar `final_level`, `triaged_at` (hora del servidor) y `triaged_by`, insertar un `encounter_event` de tipo `TRIAGE_DECIDED` y una entrada en `audit_log`. (→ F-05.AC3, F-05.AC6)
- **R6** (No deseado) Si la atención ya tiene una decisión registrada, entonces el sistema deberá responder 409 en `application/problem+json` sin modificar la decisión existente. (→ F-05.AC5)
- **R7** (Ubicuo) El sistema deberá ignorar cualquier hora enviada por el cliente para `decided_at` y `triaged_at`. (→ F-05.AC2)

## Preguntas abiertas
- [x] PA-1 ¿Se permite re-triage? → No en el MVP (respuesta de producto, 2026-10-26). Cubierto por R6.
```

Pruebas esperadas (nombres): `R1: registra VALIDATE con hora del servidor y responsable`, `R4: responde 403 si el rol no es NURSE`, `R6: responde 409 si ya hay decisión`…

## 2. `design.md`

Secciones obligatorias:

```markdown
# <id> — Diseño

## Resumen
Qué se construye y en qué módulos o capas (según docs/architecture.md).

## Decisiones
| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|

## Impacto en contrato
- Endpoints nuevos o cambiados (método, ruta, request, response, errores problem+json).
- Versión del contrato: actual → nueva (semver: mayor si es incompatible).
- (Clientes) versión que consume y tipos que regenera.
- Si no hay impacto: "Sin impacto en contrato".

## Impacto en datos
- ¿Migración? sí/no.
- Tablas o columnas nuevas o cambiadas, índices, grants.
- Inmutabilidad y tiempo (ver docs/data-model.md en la API).
- Si no hay impacto: "Sin impacto en datos".

## Riesgos y pruebas
Qué se prueba con integración y qué con pruebas unitarias.
```

## 3. `tasks.md`

```markdown
# <id> — Tareas

- [ ] T1 Migración: <descripción> (R5)        ← las migraciones van primero y en tareas aisladas
- [ ] T2 Prueba R1 + implementación de <…> (R1)
- [ ] T3 …
- [ ] Tn Regenerar el snapshot OpenAPI y fijar contract.version (si aplica)
```

- Orden de ejecución estricto. El `implementer` escribe **primero la prueba** de cada `R<n>`, luego el código, y marca `[x]`.
- Cada tarea cita los `R<n>` que cubre, y todos los `R<n>` aparecen en al menos una tarea.

## 4. Puerta de aprobación humana

1. El `spec_author` escribe los tres archivos y el `leader` marca la feature como `spec_ready`.
2. El `leader` **se detiene** y pide en el chat: *"Spec de `<id>` lista en `specs/<id>/`. ¿Apruebas?"*.
3. Solo con un **"aprobado"** explícito en el chat pasa a `in_progress`. Si el humano pide cambios, vuelve al `spec_author`.
4. **Una spec con preguntas abiertas sin resolver (`- [ ]`) no se puede aprobar.**
5. El `leader` deja constancia de la aprobación (fecha y quién) en `progress/current/<id>.md`.

## 5. Cambios de spec durante la implementación

Si al implementar aparece un requisito nuevo o una contradicción, el `implementer` **para** y lo documenta en `progress/current/<id>.md`. El `leader` devuelve la feature a `spec_ready` y vuelve a pedir aprobación. No se arregla "por debajo".
