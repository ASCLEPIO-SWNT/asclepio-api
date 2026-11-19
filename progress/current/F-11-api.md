# F-11-api — en curso

- **Aprobación:** humano, 2026-11-18, «aprobado» en el chat (PA-F11-1, -2, -4 y -5 con la propuesta).
- **Dependencia:** F-10-api `done` y fusionada en `develop` (PR #5).
- **Rama:** `feature/F-11-api` desde `develop`.
- **Migración:** una, con `--create-only` contra el Docker local. El `migrate deploy` en Supabase lo ejecuta el humano.

## Implementación (implementer, 2026-11-18)

- T1–T11 hechas y marcadas `[x]` (T10: código y datos; `npm run ai:eval` **pendiente de ejecución manual por el humano**). Informe: `progress/impl_F-11-api.md`.
- Migración `20261119022808_f11_symptom_interview` (`--create-only`, Docker local). Pendiente: `migrate deploy` en Supabase (humano).
- Contrato 0.11.0. `./init.sh` completo en verde; `npm run test:int` en verde.
- SHA-256 del fixture compartido para F-11-mobile: `343dd9c6231acaf3bee3122b49fdc974174c5899be42c0c8c7684ddd7b7f22cd`.

### Interpretaciones (no bloqueantes; a confirmar por el reviewer o el humano)
1. **R3 frente a R4.** R3 pide `red_flags = '{}'` sin entrevista y R4 pide añadir las señales del motivo. Se aplicó R4 siempre (D3, "en la duda se escala"): sin entrevista y con un motivo con señal, `red_flags` no queda vacío. Con un motivo sin señales, R3 se cumple tal cual. Prueba: `R4: sin interview, un motivo con señal de alarma también queda marcado`. Efecto: el `COMPLAINT` por defecto de los fixtures ("dolor torácico") ahora marca `CHEST_PAIN` en los pre-registros.
2. **Timeout frente a 503 (R12/R17).** Timeout en cualquier llamada → pregunta fija (200). 503 solo si en el primer intento ningún proveedor devolvió salida y ningún fallo fue timeout. Si tras una salida inválida el reintento falla en la llamada, se usa la pregunta fija.
3. **Validador estricto.** La pregunta se valida aunque `done` o `redFlagSuspected` sean `true` (el glosario dice "solo si cumple todo"); el prompt `interview-v1` pide siempre una pregunta.
4. **Máximo de preguntas.** El endpoint responde DONE con 5 turnos (R14), así que el fallback hace como mucho 5 preguntas; la entrevista guardada admite 6 (motor local, F-11.AC1).
5. **Validador de F-04.** Para que el LLM pueda citar lo que `triage-v2` le da, `isPresentField` admite `follow_up[n]` (en rango) y `patient_reported_red_flags` (no vacío). Probado sin mocks del LLM.
6. **Patrones de alarma** (PA-F11-1, provisionales): en `RED_FLAG_PATTERNS` de `interview.rules.ts`, con sintaxis común a JS y `java.util.regex` para portarlos literalmente a Kotlin. Falsos positivos aceptados (p. ej. negaciones). "Se me durmió la mitad de la cara" no la detectan las reglas (queda para `redFlagSuspected`; es la viñeta IV-014).
