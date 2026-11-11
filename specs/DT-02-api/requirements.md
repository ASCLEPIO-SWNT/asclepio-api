# DT-02-api — Alerta y orden de la cola desde la clasificación (Res. 256 de 2016)

Brief global: docs/product/features/F-06.md (F-06.AC1–AC3; enmienda F-06.AC2 y PA-F06-2)
Contrato: produce 0.9.0 (parte de 0.8.0; cambia la semántica de `overdue` y `maxWaitMinutes`, el orden de `triaged` y añade `minutesSinceTriage`, ver design.md)
RNF aplicables: RNF-10, RNF-12, RNF-14
Depende de: F-06-api (cola, `MAX_WAIT_MINUTES_BY_LEVEL`) y F-07-api (cumplimiento del nivel II medido desde `triaged_at`).
Decisiones humanas de partida (por chat, registradas en progress/current/DT-02-api.md):

- 2026-11-11: la cola sigue la **Res. 256 de 2016**. En las atenciones `TRIAGED`, `overdue` y `maxWaitMinutes` se cuentan **desde `triaged_at`** (clasificación), no desde `arrival_at`. `waitMinutes` sigue desde la llegada, para mostrarlo. Nivel I: atención inmediata (vencida con más de 0 min desde la clasificación). Nivel II: más de 30 min, con la constante única `MAX_WAIT_MINUTES_BY_LEVEL` de `queue.rules.ts`. III–V sin alerta, como ahora.
- 2026-11-11 ("apruebo b"): PA-DT02-1, opción (b): dentro de cada nivel, `triaged` se ordena por mayor `minutesSinceTriage`.
- 2026-11-11 ("a"): PA-DT02-2, opción (a): `overdue` compara el tiempo **exacto** desde `triaged_at` hasta `serverNow`; `minutesSinceTriage` se sigue mostrando en minutos completos.

Glosario de la spec (complementa el de specs/F-06-api/requirements.md, que sigue vigente salvo lo que se indica):

- **Hora del servidor** (`serverNow`): una sola lectura de `Clock.now()` por petición (R3 de F-06, RNF-10).
- **Espera** (`waitMinutes`, sin cambios): `floor((serverNow − arrival_at) / 60 000)` en `WAITING_TRIAGE` y `TRIAGED`; `null` en `IN_CARE`.
- **Tiempo desde la clasificación**: `serverNow − triaged_at`, en milisegundos.
- **Minutos desde la clasificación** (`minutesSinceTriage`, **nuevo**): `floor((serverNow − triaged_at) / 60 000)` en `TRIAGED`; `null` en `WAITING_TRIAGE` y en `IN_CARE`. Es el tramo que mide el indicador "Tiempo de espera Triage II" de la Res. 256 de 2016 (de la clasificación a la atención médica), el mismo que usa el cumplimiento de F-07-api.
- **Tiempo máximo por nivel** (`maxWaitMinutes`, mismo valor, semántica nueva): I → 0, II → 30, III–V y sin nivel → `null`, tomado de `MAX_WAIT_MINUTES_BY_LEVEL` (Res. 5596 de 2015). Desde este slice es el máximo **desde la clasificación**, no desde la llegada.
- **Atención vencida** (`overdue`, semántica nueva; PA-DT02-2, opción (a)): una atención `TRIAGED` de nivel I o II cuyo tiempo **exacto** desde la clasificación supera su tiempo máximo, es decir, `serverNow − triaged_at > maxWaitMinutes · 60 000` ms, con la resolución de milisegundos de `Date`. Nivel II: vencida desde 30 min y 1 ms. Nivel I ("atención inmediata"): vencida en cuanto pasa cualquier tiempo desde la clasificación. En cualquier otro caso, `false`. Ni `waitMinutes` ni el redondeo de `minutesSinceTriage` intervienen.

## Requisitos

### Semántica de la alerta

- **R1** (Ubicuo) El sistema deberá incluir en cada elemento de la cola el campo `minutesSinceTriage`, entero, con los minutos completos desde `triaged_at` hasta `serverNow` en las atenciones `TRIAGED`, y `null` en `waitingTriage` y en `inCare`. (→ F-06.AC1, F-06.AC3)
- **R2** (Ubicuo) El sistema deberá marcar `overdue = true` solo en las atenciones `TRIAGED` de nivel I o II en las que `serverNow − triaged_at`, en milisegundos, sea mayor que el tiempo máximo de su nivel (leído de la única definición `MAX_WAIT_MINUTES_BY_LEVEL`) multiplicado por 60 000, y `overdue = false` en las de nivel III, IV y V. (→ F-06.AC3) (decisión del humano, 2026-11-11; decidido en PA-DT02-2, opción (a))
- **R3** (Ubicuo) El sistema deberá decidir `overdue` con el tiempo exacto, sin tener en cuenta `waitMinutes` ni el redondeo de `minutesSinceTriage`, de modo que:
  - una atención `TRIAGED` de nivel II con 90 minutos completos desde la llegada tenga `overdue = false` a los 30 min 0 s 0 ms exactos desde la clasificación, y `overdue = true` a los 30 min 0 s 1 ms y a los 30 min 1 s, con `minutesSinceTriage = 30` en los tres instantes, y `overdue = true` con `minutesSinceTriage = 31` a los 31 min;
  - una atención `TRIAGED` de nivel I tenga `overdue = false` con `serverNow = triaged_at`, y `overdue = true` 1 ms y 1 s después, con `minutesSinceTriage = 0`.

  (→ F-06.AC3) (decidido en PA-DT02-2, opción (a))

- **R4** (Ubicuo) El sistema deberá devolver `maxWaitMinutes` con el valor del nivel (0 en I, 30 en II, `null` en III–V y sin nivel), igual que en F-06, y documentarlo en el contrato como el tiempo máximo contado desde la clasificación (Res. 256 de 2016). (→ F-06.AC3)

### Orden y lo que no cambia

- **R5** (Ubicuo) El sistema deberá ordenar la sección `triaged` por `finalLevel` ascendente y, dentro de cada nivel, por mayor `minutesSinceTriage` primero, con los empates por `id` ascendente, de modo que, en nivel II, una atención que llegó hace 50 min y se clasificó hace 45 vaya antes que otra que llegó hace 90 y se clasificó hace 10. Las secciones `waitingTriage` (mayor `waitMinutes` primero) e `inCare` (nivel y llegada ascendentes) deberán conservar el orden de F-06, y `waitMinutes` deberá seguir contando desde `arrival_at` (nulo en `inCare`). (→ F-06.AC1, F-06.AC2 enmendado) (decidido en PA-DT02-1, opción (b))
- **R6** (Por estado) Mientras una atención esté en `IN_CARE`, el sistema deberá devolverla con `overdue = false`, `minutesSinceTriage = null` y `waitMinutes = null`, y con `maxWaitMinutes` según su nivel, como en F-06. (→ F-06.AC3)
- **R7** (Por estado) Mientras una atención esté en `WAITING_TRIAGE`, el sistema deberá devolverla con `finalLevel = null`, `maxWaitMinutes = null`, `minutesSinceTriage = null` y `overdue = false`. (→ F-06.AC3)
- **R8** (No deseado) Si una atención de la cola en `TRIAGED` no tiene `triaged_at` (solo posible por una escritura fuera de la API; el CHECK de F-05 obliga además a que `final_level` sea nulo), entonces el sistema deberá devolverla con `minutesSinceTriage = null` y `overdue = false`, ordenada al final de `triaged`, sin responder un error. (→ F-06.AC1)
- **R9** (Ubicuo) El sistema deberá calcular `waitMinutes`, `minutesSinceTriage` y `overdue` con el mismo `serverNow` de la respuesta e ignorar cualquier hora que envíe el cliente. (→ F-06.AC1) (RNF-10)

### Contrato y coherencia con los reportes

- **R10** (Ubicuo) El sistema deberá publicar el contrato 0.9.0 con `QueueItemDto.minutesSinceTriage` (`integer`, `nullable`, requerido) y con las descripciones de `GET /queue`, de la sección `triaged`, de `overdue` y de `maxWaitMinutes` que indiquen que la alerta y el orden de `triaged` se cuentan desde la clasificación (Res. 256 de 2016) y la espera desde la llegada, sin ningún otro cambio de forma en la cola. (→ F-06.AC2, F-06.AC3) (RNF-14)
- **R11** (Ubicuo) El sistema deberá tomar de `MAX_WAIT_MINUTES_BY_LEVEL` tanto el umbral de `overdue` del nivel II como el `maxMinutes` del cumplimiento de F-07-api, de modo que ambos midan desde `triaged_at` con el mismo valor (30) y la misma frontera: una atención de nivel II que pasa a `IN_CARE` en un instante en que la cola, con ese mismo instante como `serverNow`, la marcaría vencida (más de 30 min exactos) deberá contar como no cumplida en F-07, y una no vencida (30 min exactos o menos), como cumplida. (→ F-06.AC3) (decidido en PA-DT02-2, opción (a))

> Trazabilidad por criterio: AC1 → R1, R5, R8, R9 · AC2 → R5, R10 · AC3 → R1–R4, R6, R7, R10, R11.
>
> Relación con F-06-api: R2–R3 sustituyen el criterio de R4 de F-06 ("espera mayor que 0 / 30"); R5 sustituye el orden de `triaged` de R1 de F-06 ("por nivel y mayor espera"); R1 y R10 amplían R2 de F-06 con un campo. El resto de F-06 sigue igual.

## Preguntas abiertas

- [x] **PA-DT02-1** Orden de `triaged` dentro de cada nivel: (a) por `waitMinutes`, como en F-06, o (b) por mayor `minutesSinceTriage`. → Humano, 2026-11-11, por chat ("apruebo b"): **opción (b)**, con los empates por `id` ascendente como en F-06. F-06.AC2 se enmienda. Cubierto por R5 y R10.
- [x] **PA-DT02-2** → Humano, 2026-11-11, por chat ("a"): **opción (a)**, tiempo exacto desde `triaged_at` (nivel II: más de 30 min exactos; nivel I: vencida desde que pasa cualquier tiempo tras la clasificación, coherente con "atención inmediata"), con el umbral de `MAX_WAIT_MINUTES_BY_LEVEL`; `minutesSinceTriage` se sigue mostrando en minutos completos. Cubierto por R2, R3 y R11. Pregunta original: precisión de `overdue`. ¿Se compara el tiempo **exacto** desde `triaged_at` (vencido a partir de 30 min y 1 ms en el nivel II, igual que el cumplimiento de F-07, que exige "≤ 30 min" con decimales, y que la norma, que dice que no debe superar los 30 min), o en **minutos completos** como en F-06 (vencido a los 31 min)? Qué cambia con cada opción:
  - **(a) Tiempo exacto.** La cola y F-07 coinciden en toda atención (R11). El nivel I queda vencido en cuanto pasa cualquier tiempo desde la clasificación, es decir, en la práctica en toda lectura de la cola. Una fila de nivel II puede verse con «30 min» y la alerta a la vez (entre 30:00.001 y 30:59.999), porque `minutesSinceTriage` se sigue mostrando en minutos completos.
  - **(b) Minutos completos.** Es el comportamiento actual de F-06. El nivel I vence a los 60 s. Las atenciones de nivel II atendidas entre 30 y 31 min no salen vencidas en la cola y sí salen no cumplidas en F-07.

  Recomendación del leader: (a), tiempo exacto, mostrando `minutesSinceTriage` en minutos completos.
