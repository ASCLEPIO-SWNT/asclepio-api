# DT-02-api — Alerta de la cola desde la clasificación (Res. 256 de 2016)

- 2026-11-11: el humano decidió por chat ("apruebo") corregir la inconsistencia de F-06 registrada en F-07: la Res. 256 de 2016 mide la espera del Triage II desde la clasificación hasta la atención médica, mientras que la cola de F-06 marca `overdue` desde la llegada (PA-F06-2).
- Dirección aprobada: en las atenciones `TRIAGED`, `overdue` y `maxWaitMinutes` se cuentan desde `triaged_at`; `waitMinutes` sigue desde la llegada (para mostrarlo). Cambio de semántica de un campo publicado → probablemente contrato 0.9.0. Revisar el impacto en F-06-web.
- Rama `feature/DT-02-api`, creada sobre `feature/F-07-api` porque el PR #2 (contrato 0.8.0) aún no está fusionado en `develop`.
- Siguiente paso: spec_author → spec_ready → aprobación de la spec por chat.
- 2026-11-11 (spec_author): spec escrita en `specs/DT-02-api/` (11 requisitos, 1 pregunta abierta). Resumen:
  - Campo nuevo `minutesSinceTriage` (entero, `null` fuera de `triaged`), calculado en el servidor; `overdue` = I > 0 / II > 30 sobre él, con `MAX_WAIT_MINUTES_BY_LEVEL`; `waitMinutes` sigue desde la llegada; `inCare` sin alerta y `maxWaitMinutes` por nivel, como en F-06.
  - Contrato 0.8.0 → 0.9.0 (semántica incompatible de `overdue`/`maxWaitMinutes` + campo requerido; en 0.y.z se sube `y`). Sin migraciones.
  - F-06-web: sigue funcionando sin regenerar tipos; al regenerar, los fixtures necesitan `minutesSinceTriage` y conviene mostrar «Clasificada hace N min» junto al máximo (slice web propio).
  - Pregunta abierta **PA-DT02-1** (bloquea la aprobación): orden de `triaged` dentro de cada nivel, (a) por `waitMinutes` como ahora (asumida) o (b) por `minutesSinceTriage`.
  - Pendiente del leader: pasar la feature a `spec_ready` en `feature_list.json` (el spec_author no edita ese archivo).
- 2026-11-11 (spec_author, revisión 2): el humano respondió PA-DT02-1 por chat: "apruebo b".
  - **PA-DT02-1 → [x] (b):** dentro de cada nivel, `triaged` se ordena por mayor `minutesSinceTriage`, con los empates por `id`. Cambian R5, R10 y R8 (sin `triaged_at`, al final). Se enmienda F-06.AC2 en el brief (T8). La prueba R1 de F-06 se adapta (T5): en la unitaria cambia el orden esperado, en la de integración solo el título, porque los fixtures clasifican al llegar. Hay que avisar a F-06-web de que su guía de `/cola` ("en cada nivel, primero la mayor espera") deja de ser cierta.
  - **Corrección:** la primera versión atribuía al humano mantener los minutos completos, pero eso no lo decidió. Se abre **PA-DT02-2 (- [ ])**: `overdue` con el tiempo exacto desde `triaged_at` (opción a, coincide con el "≤ 30 min" de F-07; el nivel I queda vencido en cuanto pasa cualquier tiempo desde la clasificación) o en minutos completos (opción b, como F-06; vencido a los 31). El leader recomienda (a), mostrando `minutesSinceTriage` en minutos completos. R2, R3 y R11 indican qué cambia con cada opción. D3 del diseño queda pendiente de esta pregunta.
  - Estado de la spec: 11 requisitos; 1 pregunta abierta (PA-DT02-2), que bloquea la aprobación.
- 2026-11-11 (spec_author, revisión 3): el humano respondió PA-DT02-2 por chat: "a".
  - **PA-DT02-2 → [x] (a), tiempo exacto:** `overdue` es verdadero cuando `serverNow − triaged_at > max · 60 000` ms, con el umbral de `MAX_WAIT_MINUTES_BY_LEVEL`. `minutesSinceTriage` se sigue mostrando en minutos completos.
  - Instantes límite: nivel II a 30:00.000 → `false`; a 30:00.001 y a 30:01 → `true` (con `minutesSinceTriage = 30`). Nivel I a 0 → `false`; a 1 ms y a 1 s → `true`.
  - R2, R3, R11, D3 y T2, T5 y T6 quedan con una sola opción. R11: la cola y el cumplimiento de F-07 tienen la misma frontera (30 min exactos).
  - Pruebas de F-06 que cambian de valor: `isOverdue` pasa a milisegundos; en "R4: overdue solo en TRIAGED", `t1-ok` (59 s) pasa a `true`; en la R4 de integración, los límites pasan a `NOW`/`NOW + 1 s` (nivel I) y `NOW + 20 min`/`+20 min 1 s` (`t2NewB`).
  - Para F-06-web: todo nivel I en «Clasificadas» aparece con la alerta, y un nivel II puede verse con «30 min» y la alerta a la vez.
  - Estado de la spec: 11 requisitos, **sin preguntas abiertas**. Lista para que el leader la marque `spec_ready` y pida la aprobación.
- 2026-11-11 (leader): PA-DT02-1 = (b) y PA-DT02-2 = (a) respondidas por el humano por chat; spec sin preguntas abiertas. DT-02-api → **spec_ready**. Esperando el "aprobado" de la spec.

## Aprobación
- 2026-11-11: el humano aprobó la spec por chat ("apruebo"). DT-02-api → **in_progress**.

## Implementación (implementer)
- 2026-11-11: T1–T9 hechas. Contrato **0.9.0** exportado (`openapi/asclepio-api.v1.json`, `info.version = 0.9.0`); segunda exportación sin diff. El leader debe anotar `contract.version = "0.9.0"` en `feature_list.json`.

### Aviso para F-06-web (slice web propio, p. ej. DT-02-web; no se edita desde aquí)
- Sin regenerar tipos, la web sigue funcionando: toma `overdue` tal como llega y respeta el orden del servidor; `minutesSinceTriage` se ignora en tiempo de ejecución.
- Al regenerar (`npm run api:types` con 0.9.0), `QueueItemDto.minutesSinceTriage` (integer | null) es **requerido**: `src/features/queue/testing/queueFixtures.ts` y cualquier literal de la cola dejan de compilar hasta añadirlo.
- La fila de «Clasificadas» muestra la espera desde la llegada junto a «Máx. {n} min» / «Atención inmediata»: el máximo ahora se compara con el tiempo desde la clasificación. Conviene mostrar `minutesSinceTriage` («Clasificada hace {n} min») o reformular el máximo («Máx. {n} min desde la clasificación»), en los 5 idiomas (`messages/features/*.json`).
- **Toda fila de nivel I en «Clasificadas» aparece con la alerta** desde la primera lectura tras la clasificación (tiempo exacto, máximo 0), y una fila de nivel II puede verse con «30 min» y la alerta a la vez (entre 30:00.001 y 30:59.999). La web no debe "corregirlo" (F-06-web R5).
- **La guía de `/cola` deja de ser cierta**: "las clasificadas van por nivel y, en cada nivel, primero la mayor espera" (`dashboards.test.tsx` y los mensajes de la guía) pasa a "primero la que lleva más tiempo desde la clasificación"; "supera el tiempo máximo de su nivel" puede precisar "desde la clasificación".
- Revisar pruebas o la spec de F-06-web que asuman "Clasificadas por mayor espera" en el orden de los fixtures.
- `queue_overdue` («Tiempo máximo superado») sigue siendo válido. `docs/ui-dashboards.md` debe citar la versión enmendada de PA-F06-2.
