# Modelo de datos (inicial)

> Documento de diseño, **no es una migración**. Cada tabla se crea en la feature que la necesite, mediante Prisma Migrate (ADR 0003). El esquema de PostgreSQL es `asclepio`. Las columnas exactas se cierran en el `design.md` de cada spec.

## Diagrama

```mermaid
erDiagram
  tenants ||--o{ sites : tiene
  tenants ||--o{ users : tiene
  tenants ||--o{ patients : tiene
  sites ||--o{ encounters : recibe
  patients ||--o{ encounters : tiene
  users ||--o{ encounters : "triaged_by"
  encounters ||--o{ vital_signs : registra
  encounters ||--o{ symptom_findings : registra
  encounters ||--o{ triage_suggestions : recibe
  encounters ||--o| triage_decisions : "se decide en"
  triage_suggestions ||--o{ triage_decisions : "base de"
  encounters ||--o{ encounter_events : "línea de tiempo"
  users ||--o{ audit_log : actor

  tenants {
    uuid id PK
    text name "único"
    bool active
    timestamptz created_at
  }
  sites {
    uuid id PK
    uuid tenant_id FK
    text name "único por tenant"
  }
  users {
    uuid id PK
    uuid tenant_id FK
    text email
    text password_hash
    text full_name
    enum role "RECEPTION|NURSE|PHYSICIAN|ADMIN"
    bool active
    int failed_attempts
    timestamptz locked_until
  }
  patients {
    uuid id PK
    uuid tenant_id FK
    text document_type
    text document_number "único por tenant; NULL si NN"
    text full_name
    date birth_date
    enum sex "M|F|X"
  }
  encounters {
    uuid id PK
    uuid tenant_id FK
    uuid site_id FK
    uuid patient_id FK
    enum status "REGISTERED|WAITING_TRIAGE|TRIAGED|IN_CARE|CLOSED|CANCELLED"
    timestamptz arrival_at "hora del servidor"
    text chief_complaint_text
    enum complaint_source "TYPED|VOICE_ON_DEVICE"
    smallint final_level "1-5, NULL hasta la decisión"
    timestamptz triaged_at
    uuid triaged_by FK
  }
  vital_signs {
    uuid id PK
    uuid tenant_id FK
    uuid encounter_id FK
    smallint_or_numeric signs "una columna tipada por signo (PA-F03-1)"
    timestamptz recorded_at "hora del servidor"
    uuid recorded_by FK
  }
  symptom_findings {
    uuid id PK
    uuid tenant_id FK
    uuid encounter_id FK
    enum kind "SYMPTOM|FINDING|COMPLAINT_NOTE (PA-F03-3)"
    text description
    timestamptz recorded_at "hora del servidor"
    uuid recorded_by FK
  }
  triage_suggestions {
    uuid id PK
    uuid tenant_id FK
    uuid encounter_id FK
    uuid requested_by FK
    jsonb input_snapshot "sin nombre ni documento"
    enum status "OK|INVALID_OUTPUT|TIMEOUT|FAILED"
    smallint llm_level
    smallint suggested_level "<= llm_level"
    jsonb explanation "summary + factors"
    bool guard_applied
    jsonb guard_reasons
    enum provider "GROQ|OPENROUTER"
    text model
    text prompt_version
    text raw_response
    int tokens_in
    int tokens_out
    int latency_ms
    jsonb attempts
    timestamptz created_at
  }
  triage_decisions {
    uuid id PK
    uuid encounter_id FK "único"
    uuid suggestion_id FK "NULL si MANUAL"
    enum action "VALIDATE|CORRECT|MANUAL"
    smallint level "1-5"
    text reason "obligatorio si CORRECT"
    uuid decided_by FK
    timestamptz decided_at
  }
  encounter_events {
    bigint id PK
    uuid tenant_id FK
    uuid encounter_id FK
    text type
    jsonb payload "sin datos personales"
    uuid actor_id FK
    timestamptz occurred_at
  }
  audit_log {
    bigint id PK
    uuid tenant_id FK
    enum actor_type "STAFF|PATIENT|SYSTEM"
    uuid actor_id "sin FK
    text action
    text entity
    text entity_id
    jsonb metadata "sin datos personales"
    timestamptz occurred_at
  }
```

## Reglas

### Multi-tenant

- Toda tabla con datos de una IPS lleva `tenant_id`, directo o heredado de `encounters`. Todas las consultas filtran por el tenant del usuario autenticado (RNF-11).
- Hay un índice único `(tenant_id, document_type, document_number)` en `patients`; NULL está permitido para los NN, que pueden repetirse.

### Propiedad por módulo (ADR 0001)

| Módulo         | Tablas propias                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| tenancy        | `tenants`, `sites`                                                                                                                     |
| users / auth   | `users`                                                                                                                                |
| patients       | `patients`                                                                                                                             |
| encounters     | `encounters`, `encounter_events`, `pre_registrations` (F-02), `vital_signs`, `symptom_findings` (F-03, D1 de specs/F-03-api/design.md) |
| triage         | `triage_decisions`                                                                                                                     |
| ai             | `triage_suggestions`                                                                                                                   |
| audit          | `audit_log`                                                                                                                            |
| queue, reports | Ninguna; leen mediante services.                                                                                                       |

### Inmutabilidad

- `audit_log` y `encounter_events`: **solo inserciones**. El rol `asclepio_app` tiene `INSERT` y `SELECT`, sin `UPDATE` ni `DELETE` (los grants van en una migración SQL).
- `vital_signs`, `symptom_findings`, `triage_suggestions` y `triage_decisions`: solo inserciones desde la aplicación. Una nueva medición es una nueva fila.
- `encounters`: es la única tabla clínica que se actualiza (estado, `final_level`, `triaged_at`, `triaged_by`), siempre junto con un `encounter_event` en la misma transacción.

### Claves foráneas

- **Todas las FK del esquema son `ON DELETE RESTRICT ON UPDATE RESTRICT`** (migraciones `f01_audit_log_fk_restrict` y `f02_fk_on_update_restrict`). Una FK con `CASCADE` o `SET NULL` permitiría modificar atenciones o tablas append-only sin evento ni auditoría. Toda migración nueva debe declarar `onDelete: Restrict, onUpdate: Restrict` en Prisma y revisarse con `--create-only`.

### Tiempo

- Todas las horas son `timestamptz` en UTC y se asignan **en el servidor** (`now()` o el reloj de la API), nunca desde el cliente (RNF-10).
- La UI las muestra en `America/Bogota`. Los reportes interpretan los rangos de fechas en `America/Bogota`.

### Máquina de estados de `encounters`

```
REGISTERED → WAITING_TRIAGE → TRIAGED → IN_CARE → CLOSED
     └──────────────┴────────────┴─────────┴──→ CANCELLED
```

Pasar a `TRIAGED` exige una fila en `triage_decisions` (RNF-03).

### Privacidad

- `triage_suggestions.input_snapshot` y el payload al LLM no contienen `full_name` ni `document_number` (RNF-04).
- `encounter_events.payload` y `audit_log.metadata` no contienen datos personales (RNF-05).

### F-01-api (cerrado; migraciones `f01_auth_tenancy` y `f01_app_role_grants`)

- `tenants`: `name` único y `active` (una IPS inactiva no aparece en `GET /public/tenants`, no admite altas y su personal y pacientes no pueden iniciar sesión).
- `users`: email único global guardado en minúsculas; `failed_attempts` y `locked_until` para el bloqueo (5 fallos → 15 min).
- `patients`: `sex` es el enum `patient_sex` (`M`, `F`, `X`); `document_type` es `text` (F-02 admitirá `TI`/`RC`); columnas nullables para NN; único `(tenant_id, document_type, document_number)` y único `(id, tenant_id)`.
- `patient_accounts` (dueño: `auth`): `id`, `tenant_id`, `patient_id` (único; FK compuesta `(patient_id, tenant_id)` → `patients(id, tenant_id)`), `password_hash` (scrypt), `consent_at` (servidor), `consent_version`, `identity_verified` (false hasta que recepción verifique en F-02), `active`, `failed_attempts`, `locked_until`, `created_at`, `updated_at`. Una cuenta por documento y tenant. Es un principal separado de `users`; no se admiten menores.
- `audit_log`: `actor_type` (`STAFF`, `PATIENT`, `SYSTEM`, nullable) y `actor_id` sin FK; `id` es `BIGSERIAL`. `asclepio_app` solo tiene `SELECT` e `INSERT` (más `USAGE` de `audit_log_id_seq`). La FK `audit_log.tenant_id` es `ON DELETE RESTRICT ON UPDATE RESTRICT` (migración `f01_audit_log_fk_restrict`): una acción referencial `SET NULL`/`CASCADE` se ejecutaría como dueño de la tabla y saltaría los grants. Toda FK futura desde una tabla append-only debe ser `RESTRICT`.
- El rol `asclepio_app` se crea `NOLOGIN` en la migración; su contraseña y `LOGIN` se fijan fuera de banda (en Docker, `scripts/test-int.sh`).

### F-02-api (cerrado; migraciones `f02_patients_encounters` y `f02_app_role_grants`)

- `patients`: añade `estimated_age_years smallint` (solo NN sin fecha de nacimiento, 0–120), `identity_verified_at timestamptz` (hora del servidor en que recepción verificó la identidad o creó el paciente con documento; no NULL → el perfil ya no es editable desde la app) y `updated_at`. CHECK: tipo y número de documento juntos o ninguno (NN); CHECK de la edad estimada. `document_type` admite `CC`, `TI`, `CE`, `PA`, `RC` (validado en la API).
- `sites`: único `(id, tenant_id)`, destino de las FKs compuestas.
- `encounters` (dueño `encounters`): `id`, `tenant_id`, `site_id`, `patient_id`, `status` (`encounter_status`), `origin` (`PRE_REGISTRATION`, `DIRECT`), `arrival_at` (servidor, sin default), `chief_complaint_text`, `complaint_source` (`TYPED`, `VOICE_ON_DEVICE`), `registered_by` → `users`, `cancellation_reason`, `created_at`, `updated_at`. FKs compuestas `(patient_id, tenant_id)` y `(site_id, tenant_id)`. Índice único parcial `encounters_one_active_per_patient` (una atención no `CLOSED`/`CANCELLED` por paciente). Se crea directamente en `WAITING_TRIAGE` con dos eventos (`ENCOUNTER_CREATED` → `REGISTERED` y `STATUS_CHANGED` → `WAITING_TRIAGE`). `final_level`, `triaged_at` y `triaged_by` llegan con F-05.
- `pre_registrations` (dueño `encounters`): `id`, `tenant_id`, `patient_id`, `site_id`, `chief_complaint_text`, `complaint_source`, `status` (`PENDING`, `CONFIRMED`, `EXPIRED`, `REJECTED`), `pre_registered_at` y `expires_at` (= +6 h, servidor), `resolved_at`, `resolved_by` → `users`, `encounter_id` (único; FK compuesta a `encounters`, RESTRICT), `rejection_reason`, `updated_at`. Índice único parcial `pre_registrations_one_pending_per_patient`. CHECK `expires_at > pre_registered_at`.
- **Expiración perezosa y estado efectivo:** no hay job. Un `PENDING` con `expires_at` ≤ hora del servidor se presenta como `EXPIRED`; solo al crear un pre-registro nuevo se materializan los vencidos del paciente (`resolved_at = expires_at`, auditoría `PRE_REGISTRATION_EXPIRED` del sistema). Los vencidos de pacientes que no vuelven siguen `PENDING` en la base: **F-07 debe usar el estado efectivo**.
- Al confirmar se crea `encounters` con `arrival_at` = hora del servidor de la confirmación (hora legal); `pre_registered_at` se conserva solo como referencia.
- `encounter_events` (append-only): `id bigserial`, `tenant_id`, `encounter_id`, `type text`, `from_status`, `to_status`, `payload jsonb` (sin datos personales), `actor_type` (`actor_type`), `actor_id` **sin FK** (CHECK: NULL si y solo si `SYSTEM`), `occurred_at`. FKs `(encounter_id, tenant_id)` y `tenant_id` **`ON DELETE RESTRICT ON UPDATE RESTRICT`**. `asclepio_app`: solo `SELECT`, `INSERT` y `USAGE` de la secuencia.
- Permisos: `encounters` y `pre_registrations` con `SELECT, INSERT, UPDATE` (sin `DELETE`).
- Los índices únicos parciales se declaran en el schema (`previewFeatures = ["partialIndexes"]`); el predicado de `encounters_one_active_per_patient` se escribe en la forma canónica de PostgreSQL (`status <> ALL (ARRAY[...])`) para que `migrate diff` no detecte drift.

### F-03-api (cerrado; migraciones `f03_clinical_capture` y `f03_app_role_grants`; PA-F03-1..4 resueltas el 2026-10-27)

- **Dueño:** `encounters` (la captura se escribe en la misma transacción que su `encounter_event` y se valida contra el estado de la atención). `triage` no tiene tablas de captura.
- `vital_signs`: **columnas tipadas**, una fila por toma: `tenant_id`, `encounter_id`, `respiratory_rate`, `oxygen_saturation`, `systolic_bp`, `heart_rate`, `diastolic_bp`, `glucose_mg_dl` (`smallint`), `supplemental_oxygen boolean`, `consciousness` (enum `consciousness_level`: `A`, `C`, `V`, `P`, `U`), `temperature_c numeric(4,1)`, `recorded_at` y `recorded_by`. Las columnas de signos son NULL en la base: la obligatoriedad (siete obligatorios en cada toma, diastólica y glucometría opcionales; PA-F03-1, NEWS2 RCP 2017) y los rangos (PA-F03-2) viven en la API (`VITAL_SIGN_DEFINITIONS`), no en CHECK de la base; ambos son **PROVISIONALES — no validados clínicamente, revisar con asesor clínico**. CHECK técnico de al menos un signo. Se descarta `jsonb` (admite claves no previstas y obliga a leer JSON en F-04 y F-07).
- `symptom_findings`: **texto libre estructurado** (PA-F03-3): `kind` (`SYMPTOM`, `FINDING`, `COMPLAINT_NOTE`) y `description` (1–500), máximo 20 por captura. Sin catálogo ni `code`.
- Motivo de consulta (PA-F03-4): `encounters.chief_complaint_text` no se modifica; las precisiones de enfermería son filas `COMPLAINT_NOTE`.
- Ambas tablas: solo `SELECT` e `INSERT` para `asclepio_app`; FKs `(encounter_id, tenant_id) → encounters`, `tenant_id → tenants` y `recorded_by → users`, todas `ON DELETE RESTRICT ON UPDATE RESTRICT`. Eventos `VITAL_SIGNS_RECORDED` y `SYMPTOM_FINDINGS_RECORDED` sin valores clínicos en `payload` ni en `metadata`.
- CHECK técnicos (bloque manual de `f03_clinical_capture`): `vital_signs_at_least_one_sign` (`num_nonnulls(<signos>) >= 1`) y `symptom_findings_description_length` (`char_length(btrim(description))` entre 1 y 500; la API guarda la descripción sin espacios extremos). Índices `(encounter_id, recorded_at, id)` y `(tenant_id, recorded_at)` en ambas tablas. Ids `uuid` (sin secuencias).
- La captura bloquea la atención con un UPDATE de `encounters.updated_at` (hora del servidor) en la misma transacción que su `encounter_event`; el estado no cambia.

### F-04-api (migraciones `f04_triage_suggestions` y `f04_app_role_grants`; PA-F04-1..7 resueltas el 2026-11-09)

- **Dueño:** `ai`. **Una fila por solicitud** de sugerencia (D2 de specs/F-04-api/design.md): las llamadas a cada proveedor quedan en `attempts jsonb` (`[{ provider, model, outcome, latencyMs, httpStatus }]`, `outcome` ∈ `OK`, `INVALID_OUTPUT`, `TIMEOUT`, `NETWORK`, `HTTP`, `EMPTY`, `BUDGET_EXHAUSTED`).
- `triage_suggestions`: `tenant_id`, `encounter_id`, `requested_by` (→ `users`), `input_snapshot jsonb` (instantánea D7: edad, sexo, motivo y hallazgos **saneados**, `complaint_source` y la toma vigente; sin nombre, documento, ids, fecha de nacimiento ni horas), `status` (enum `triage_suggestion_status`), `llm_level` y `suggested_level` (`smallint`, 1–5), `explanation jsonb` (`{ summary, factors }`), `guard_applied`, `guard_reasons jsonb` (`[{ rule, maxLevel, trigger: { news2Total, field?, points? } }]`), `provider` (enum `llm_provider`: `GROQ`, `OPENROUTER`), `model`, `prompt_version`, `raw_response text`, `tokens_in`, `tokens_out`, `latency_ms`, `attempts jsonb` y `created_at` (hora del servidor, sin default).
- **Diferencias con el diagrama inicial:** se añaden `tenant_id`, `requested_by`, `llm_level` y `attempts`; `raw_response` pasa de `jsonb` a **`text`** (una salida `INVALID_OUTPUT` puede no ser JSON y se guarda tal cual); `provider` pasa a enum.
- CHECK (bloque manual de `f04_triage_suggestions`): `triage_suggestions_status_levels` (`status = 'OK'` ⇔ `llm_level`, `suggested_level` y `explanation` no nulos), rangos 1–5 de ambos niveles, **`triage_suggestions_guard_never_lowers` (`suggested_level <= llm_level`, ADR 0005)**, `triage_suggestions_guard_applied` (con `status = 'OK'`, `guard_applied = (suggested_level < llm_level)`) y `latency_ms >= 0`.
- FKs `(encounter_id, tenant_id) → encounters`, `tenant_id → tenants` y `requested_by → users`, todas `ON DELETE RESTRICT ON UPDATE RESTRICT`. Índice `(encounter_id, created_at DESC, id DESC)` (la vigente es la primera).
- Permisos: `asclepio_app` solo `SELECT` e `INSERT` (append-only). La sugerencia **nunca** modifica `encounters` ni crea `triage_decisions`; su auditoría (`TRIAGE_SUGGESTION_CREATED`, metadata `{ encounterId, status, guardApplied }`) va en la misma transacción. Sin `encounter_event` (D13).
- `raw_response` puede contener texto clínico ya saneado: nunca se expone por la API ni se registra en logs (igual que `input_snapshot` y `attempts`).

### F-05-api (migraciones `f05_triage_decisions` y `f05_app_role_grants`; PA-F05-1..3 resueltas el 2026-11-09)

- **Dueño:** `triage`. **Una decisión por atención** (PA-F05-1, sin re-triage en el MVP): `UNIQUE (encounter_id)`.
- `triage_decisions`: `tenant_id`, `encounter_id`, `suggestion_id` (NULL en `MANUAL`), `action` (enum `triage_decision_action`: `VALIDATE`, `CORRECT`, `MANUAL`), `level smallint` (1–5), `reason text` (motivo de corrección, solo en `CORRECT`, guardado sin espacios extremos), `decided_by` (→ `users`) y `decided_at` (hora del servidor, sin default).
- FKs, todas `ON DELETE RESTRICT ON UPDATE RESTRICT`: `tenant_id → tenants`, `(encounter_id, tenant_id) → encounters(id, tenant_id)`, `decided_by → users` y la compuesta **`(suggestion_id, encounter_id) → triage_suggestions(id, encounter_id)`** (MATCH SIMPLE: no se comprueba en `MANUAL`), que impide en la base decidir con la sugerencia de otra atención. Su destino es el **`UNIQUE (id, encounter_id)` nuevo de `triage_suggestions`** (`triage_suggestions_id_encounter_id_key`; no cambia sus datos).
- CHECK (bloque manual de `f05_triage_decisions`): `triage_decisions_manual_without_suggestion` (`(action = 'MANUAL') = (suggestion_id IS NULL)`), `triage_decisions_reason_only_in_correct` (`(action = 'CORRECT') = (reason IS NOT NULL)`), `triage_decisions_reason_length` (`char_length(btrim(reason))` entre 1 y 500) y `triage_decisions_level_range` (1–5). Que `VALIDATE` tome el nivel sugerido y que `CORRECT` sea distinto se garantiza en código (`triage-decision.rules.ts`).
- `encounters` (dueño `encounters`): columnas `final_level smallint`, `triaged_at timestamptz` y `triaged_by uuid` (→ `users`, RESTRICT), todas NULL hasta la decisión. CHECK `encounters_final_level_range` (1–5), `encounters_triage_all_or_none` (las tres nulas o las tres no nulas) y `encounters_triage_required` (no nulas en `TRIAGED`, `IN_CARE` y `CLOSED`; una atención `CANCELLED` puede tenerlas o no). Solo las fija `EncountersService.recordTriage`, en la misma transacción que la decisión, el evento `TRIAGE_DECIDED` (`payload { decisionId, action }`) y la auditoría `TRIAGE_DECIDED` (`metadata { encounterId, action }`): ni el nivel ni el motivo van en eventos, auditoría ni logs (R21).
- Permisos: `asclepio_app` solo `SELECT` e `INSERT` sobre `triage_decisions` (append-only). `encounters` ya tenía `UPDATE` a nivel de tabla (f02).
- Antes de aplicar la migración en una base con datos hay que comprobar que no hay atenciones en `TRIAGED`/`IN_CARE`/`CLOSED` (el CHECK `encounters_triage_required` fallaría). Las pruebas de integración que fuerzan esos estados como dueño de la base fijan también las tres columnas.

### Pendiente (preguntas abiertas)

- Validación clínica de la lista de signos y de los rangos provisionales de F-03 por un asesor clínico.
- Validación clínica de la tabla NEWS2 y de las reglas G1–G3 de F-04 (PROVISIONALES) y revisión de las 20 viñetas en borrador.
- `complaint_source`: el prompt fija `VOICE_ON_DEVICE`; `TYPED` es el valor propuesto para el texto escrito.
