Cola priorizada por nivel y espera (F-06-api): `queue.rules.ts` (puro: `MAX_WAIT_MINUTES_BY_LEVEL`, `waitMinutes`, `isOverdue`, `initials`, `buildQueue`), `QueueService` y `QueueController` (`GET /queue`). Sin tablas propias: lee con `EncountersService.listActiveForQueue`. Ver docs/architecture.md, sección "Cola y paso a atención (F-06)".

DT-02-api: la cola lee también `triaged_at`; la alerta (`overdue`, tiempo exacto) y el orden de `triaged` se cuentan desde la clasificación (`minutesSinceTriage`, Res. 256 de 2016).
