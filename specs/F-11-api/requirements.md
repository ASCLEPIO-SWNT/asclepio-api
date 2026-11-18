# F-11-api — Entrevista de síntomas: persistencia, IA de triage, prioridad y fallback en el servidor

Brief global: docs/product/features/F-11.md (AC2, AC3 en el servidor, AC5–AC7)
Contrato: produce 0.11.0 (menor: un campo opcional nuevo y un endpoint nuevo; parte de 0.10.0)
RNF aplicables: RNF-01, RNF-04, RNF-05, RNF-07, RNF-08, RNF-09, RNF-11, RNF-12, RNF-14, RNF-16
Depende de: F-10-api (contrato 0.10.0), F-02-api (prerregistro y confirmación), F-04-api (snapshot y LLM), F-06-api (cola).
ADR: 0010.

Glosario de la spec:

- **Dimensión**: `ONSET`, `DURATION`, `INTENSITY`, `LOCATION`, `ASSOCIATED`, `HISTORY`, `MEDS_ALLERGIES` o `ALARM_SIGNS`.
- **Entrevista** (`interview`): `{ engine: ON_DEVICE | SERVER, modelId: string ≤80, turns: Turn[] (0–6), redFlags: RedFlag[] (sin repetidos), endedBy: COMPLETE | MAX_QUESTIONS | RED_FLAG | PATIENT }`.
  - `Turn`: `{ dimension, question: string 1–200, answer: string 1–500 | null }`, donde `null` significa "No sé / prefiero no responder".
- **Señal de alarma** (`RedFlag`, PA-F11-1, provisional): `CHEST_PAIN`, `BREATHING_DIFFICULTY`, `LOSS_OF_CONSCIOUSNESS`, `SEIZURE`, `SEVERE_BLEEDING`, `STROKE_SIGNS` o `SUICIDAL_IDEATION`.
- **Reglas de alarma** (`interview.rules.ts`): patrones en español sobre el texto normalizado (minúsculas, sin tildes) que asignan una `RedFlag`. Los casos viven en el fixture `test/fixtures/red-flag-cases.json`, que se copia literalmente desde y hacia `asclepio-mobile` (el mismo archivo).
- **Validador de pregunta**: acepta una salida del LLM solo si cumple todo lo siguiente:
  - es JSON con exactamente `{ done: boolean, question: string ≤140, dimension: Dimensión, redFlagSuspected: boolean }`;
  - la pregunta termina en "?" y contiene un solo "?";
  - la dimensión no se repite en los turnos;
  - la pregunta no contiene ningún patrón prohibido: diagnóstico ("tienes", "podría ser", "diagnóstico", "es probable que"), tratamiento o dosis ("toma", "tómate", "mg", "pastilla", "medicamento para", "te recomiendo") ni nivel o gravedad ("nivel", "triage", "no es grave", "es grave", "urgente").
- **Preguntas fijas**: una por dimensión, en código. Se usan cuando la salida del LLM es inválida dos veces.

## Requisitos

### Prerregistro con entrevista
- **R1** (Por evento) Cuando `POST /api/v1/patient/pre-registrations` incluya `interview` válida según el glosario, el sistema deberá guardarla en `pre_registrations.symptom_interview` y sus `redFlags` en `pre_registrations.red_flags`. (→ F-11.AC6)
- **R2** (No deseado) Si `interview` no cumple el glosario (más de 6 turnos, longitudes, enums, `redFlags` repetidas o campos extra), entonces el sistema deberá responder 400 en `application/problem+json` sin crear el prerregistro ni repetir los valores enviados. (→ F-11.AC6)
- **R3** (Por evento) Cuando el prerregistro llegue sin `interview`, el sistema deberá crearlo exactamente como en 0.10.0, con `symptom_interview = NULL` y `red_flags = '{}'`. (→ F-11.AC5)
- **R4** (Por evento) Cuando el texto del motivo o de alguna respuesta active las reglas de alarma en el servidor, el sistema deberá añadir esas señales a `red_flags` aunque el cliente no las haya enviado, y nunca deberá quitar las que envió. (→ F-11.AC3)
- **R5** (Por evento) Cuando recepción confirme un prerregistro, el sistema deberá copiar `symptom_interview` y `red_flags` a la atención en la misma transacción en que copia el motivo. (→ F-11.AC6)

### Visibilidad para el personal
- **R6** (Ubicuo) El sistema deberá incluir `symptomInterview` (o `null`) y `redFlags` en `GET /encounters/{id}` y en cada elemento de la bandeja de prerregistros pendientes. (→ F-11.AC6, F-11.AC7)
- **R7** (Ubicuo) El sistema deberá ordenar la bandeja de prerregistros pendientes con primero los que tienen `redFlags` no vacío y después el orden actual. (→ F-11.AC7)
- **R8** (Ubicuo) El sistema deberá ordenar la sección `waitingTriage` de la cola con primero las atenciones con `redFlags` no vacío y después la mayor espera desde la llegada, e incluir `hasRedFlags` en cada elemento de la cola. El orden de `triaged` e `inCare` no cambia. (→ F-11.AC7)

### IA de triage (F-04)
- **R9** (Ubicuo) El sistema deberá añadir al snapshot del LLM `follow_up: [{ dimension, question, answer }]`, con cada texto pasado por `redact()`, y `patient_reported_red_flags: RedFlag[]`, y fijar `PROMPT_VERSION = 'triage-v2'`. (→ F-11.AC6) (RNF-04, RNF-09)
- **R10** (Ubicuo) El sistema deberá mantener sin cambios las SafetyGuards de ADR 0005. Las señales referidas por el paciente no deberán modificar el nivel por sí mismas. (→ F-11.AC6) (PA-F11-2)

### Fallback en el servidor
- **R11** (Por evento) Cuando se reciba `POST /api/v1/patient/symptom-interview/next-question` con un token de paciente y `{ chiefComplaintText: 1–2000, turns: Turn[] (0–5) }`, el sistema deberá aplicar primero las reglas de alarma y, si no hay señales, pedir al LLM (Groq, con OpenRouter de respaldo) la siguiente pregunta y responder 200 con `{ kind: QUESTION, dimension, question }`, `{ kind: DONE }` o `{ kind: RED_FLAG, redFlags }`. (→ F-11.AC5, F-11.AC3)
- **R12** (Por evento) Cuando la salida del LLM no pase el validador, el sistema deberá reintentar una vez. Si vuelve a fallar, o si el LLM excede el timeout, deberá responder con la pregunta fija de la primera dimensión no cubierta. Si ya están cubiertas todas, deberá responder `DONE`. (→ F-11.AC2)
- **R13** (Por evento) Cuando el LLM devuelva `redFlagSuspected = true`, el sistema deberá responder `RED_FLAG` con las señales de las reglas o, si no hay ninguna, con la lista vacía. (→ F-11.AC3)
- **R14** (Por evento) Cuando los turnos recibidos sean 5, o el LLM devuelva `done = true` con ≥3 dimensiones respondidas, el sistema deberá responder `DONE`. (→ F-11.AC1) (PA-F11-4)
- **R15** (Ubicuo) El sistema deberá enviar al LLM los textos del endpoint pasados por `redact()` con el nombre y el documento del paciente del token, y no deberá persistir en base de datos ni escribir en logs el contenido de la petición ni de la respuesta. (→ F-11.AC5) (RNF-04, RNF-05)
- **R16** (No deseado) Si un mismo paciente supera 30 peticiones a `next-question` en 10 min, entonces el sistema deberá responder 429 con `Retry-After`. (→ F-11.AC5)
- **R17** (No deseado) Si un token de personal llega a `next-question`, entonces el sistema deberá responder 403. Sin token válido deberá responder 401. Ante un cuerpo inválido deberá responder 400. Si ambos proveedores del LLM fallan, deberá responder 503. Todo en `application/problem+json`. (→ F-11.AC5)

## Preguntas abiertas
Resueltas el 2026-11-18 por el humano («aprobado» en el chat): se aceptan todas las propuestas.
- [x] PA-F11-1 Lista de señales y patrones (provisional; propuesta en el brief). — bloquea R4, R11
- [x] PA-F11-2 Sin guard nueva (propuesta: aceptar). — bloquea R10
- [x] PA-F11-4 Máximo de 6 preguntas y fin con ≥3 dimensiones (propuesta: aceptar). — bloquea R14
- [x] PA-F11-5 Límite de frecuencia del fallback: 30 peticiones cada 10 min por paciente (propuesta: aceptar). — bloquea R16
