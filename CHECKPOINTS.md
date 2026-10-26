# CHECKPOINTS — Evaluación del estado final (asclepio-api)

> En sistemas multi-agente no se evalúa el camino, se evalúa el destino.
> El `reviewer` recorre cada casilla, marca `[x]` o `[ ]` con evidencia y rechaza el cierre si queda alguna vacía en los checkpoints que aplican.

## C1 — El harness está completo
- [ ] Existen `AGENTS.md`, `CLAUDE.md`, `init.sh` (ejecutable), `feature_list.json`, `progress/current/` y `progress/history.md`.
- [ ] Existen `docs/architecture.md`, `docs/conventions.md`, `docs/specs.md` y `docs/verification.md`.
- [ ] Existen el hub `docs/product/`, `docs/adr/`, `docs/roadmap.md` y `docs/data-model.md`.
- [ ] `./init.sh` termina con exit code 0.

## C2 — El estado es coherente
- [ ] Como mucho una feature `in_progress` en `feature_list.json`.
- [ ] Toda feature `done` tiene pruebas asociadas que pasan.
- [ ] `progress/current/` contiene solo el archivo de la feature activa (o nada).
- [ ] `docs/roadmap.md` refleja los slices `done`.

## C3 — El código respeta la arquitectura
- [ ] `src/modules/` solo contiene los 10 módulos de `docs/architecture.md`.
- [ ] Ningún módulo importa el repositorio o modelo Prisma de otro módulo; accede mediante su service exportado.
- [ ] Lo transversal está en `src/common/`; el esquema y las migraciones, en `prisma/`.
- [ ] No hay dependencias nuevas sin justificación en el `design.md`.
- [ ] No hay `console.log` de depuración ni TODOs sin contexto.

## C4 — La verificación es real
- [ ] Al menos un archivo de prueba Jest por módulo con código.
- [ ] Las pruebas de integración usan datos con prefijo `DEV-`/de prueba y los limpian al terminar; nunca se ejecutan `migrate reset` ni `db push`.
- [ ] Las pruebas de `TriageResponseValidator` y `SafetyGuards` **no usan mocks del LLM**: reciben entradas y respuestas literales.
- [ ] `npm test` muestra más de 0 pruebas, todas en verde.

## C5 — La sesión se cerró bien
- [ ] No hay archivos sin trackear sospechosos (`*.log`, `*.tmp`, `coverage/` fuera de `.gitignore`).
- [ ] `progress/history.md` tiene una entrada por la última sesión.
- [ ] La última feature trabajada tiene el estado correcto.

## C6 — Spec-Driven Development
- [ ] Toda feature `sdd: true` en `spec_ready`, `in_progress` o `done` tiene `specs/<id>/{requirements,design,tasks}.md`.
- [ ] `requirements.md` usa EARS estricto y cada `R<n>` está trazado a un `F-0X.ACn`.
- [ ] Toda feature `done` con `sdd: true` tiene todas sus tareas `[x]`.
- [ ] Cada `R<n>` está cubierto por al menos una prueba cuyo nombre empieza por `R<n>:`.
- [ ] No quedan preguntas abiertas `- [ ]` en una spec aprobada.

## C7 — Seguridad clínica y privacidad
- [ ] Ningún flujo asigna `final_level` ni pasa a `TRIAGED` sin una fila en `triage_decisions` (`VALIDATE`, `CORRECT` o `MANUAL`).
- [ ] `CORRECT` exige un motivo no vacío (con prueba).
- [ ] Cada regla de `SafetyGuards` tiene su prueba y ninguna baja la gravedad (con prueba).
- [ ] El payload al LLM no contiene nombre ni documento (con prueba).
- [ ] Los logs no contienen datos personales.
- [ ] `audit_log` y `encounter_events` solo admiten inserciones: no hay código que los actualice o borre, y los grants de `asclepio_app` lo garantizan.
- [ ] Las horas legales se asignan con el reloj del servidor.

## C8 — Contrato
- [ ] `openapi/asclepio-api.v1.json` está regenerado (`npm run openapi:export` no produce diff).
- [ ] `info.version` sigue semver: un cambio incompatible sube la mayor.
- [ ] `contract.version` de la feature en `feature_list.json` coincide con el snapshot.
- [ ] Los errores se documentan como `application/problem+json`.
