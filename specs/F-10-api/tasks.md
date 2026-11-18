# F-10-api — Tareas

> **Orden estricto.** Primero la prueba `R<n>: …` y luego el código. **No hay migraciones.** Nada se ejecuta contra Supabase.

- [x] T1 Prueba unitaria + `modules/patient-queue/estimate.rules.ts` (puro):
  - `ESTIMATE` con el comentario PA-F10-1;
  - `positionOf` (fases, posición 1, ausente → `NO_ACTIVE`);
  - `estimateWait` (4 salidas → `INSUFFICIENT_DATA`, 5 → rango, redondeo, mínimo 5).

  (R2, R3, R4, R5)
- [x] T2 Integración + `EncountersService.findActiveForPatient` y `countPhaseExits` (por sede, ventana, las dos fases). (R1, R3, R13)
- [x] T3 Integración + `changes$` en `EncountersService`, emitido tras el commit de crear, transicionar y clasificar. Una prueba comprueba que un rollback no emite. (R8)
- [x] T4 Integración + `PatientQueueService.snapshot`, el controller `GET /patient/queue-position` y los DTOs:
  - `R1:` instantánea;
  - `R2:` dos pacientes `TRIAGED` de nivel III y uno nuevo de nivel II → la posición del III pasa de 1 a 2;
  - `R5:` sin activa;
  - `R6:` búsqueda profunda sin ids ni niveles;
  - `R13:` parámetro extra → 400.

  (R1, R2, R5, R6, R13)
- [x] T5 e2e + `@Sse()` `GET /patient/queue-position/stream` según D3:
  - `R7:` evento inicial;
  - `R8:` emite en ≤2 s tras una transición en la misma sede y no emite por otra sede;
  - `R9:` latido con el scheduler de prueba;
  - `R10:` `DONE` y cierre;
  - `R11:` cierre al vencer el token.

  (R7, R8, R9, R10, R11)
- [x] T6 Transversales: `R12:` matriz de tokens (personal → 403, sin token → 401) en los dos endpoints, con `problem+json`; logger capturado sin datos del paciente. (R12, R13)
- [ ] T7 `npm run openapi:export`, `contract.version = 0.10.0` en `feature_list.json` y verificación de que `docs/architecture.md` lista el módulo `patient-queue`.
