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
    uuid encounter_id FK
    jsonb_or_columns values "FC, PA, SatO2, FR, T..."
    timestamptz recorded_at
    uuid recorded_by FK
  }
  symptom_findings {
    uuid id PK
    uuid encounter_id FK
    text code_or_text
    timestamptz recorded_at
    uuid recorded_by FK
  }
  triage_suggestions {
    uuid id PK
    uuid encounter_id FK
    jsonb input_snapshot "sin nombre ni documento"
    smallint suggested_level
    jsonb explanation
    text provider
    text model
    text prompt_version
    jsonb raw_response
    int tokens_in
    int tokens_out
    int latency_ms
    bool guard_applied
    jsonb guard_reasons
    enum status "OK|INVALID_OUTPUT|TIMEOUT|FAILED"
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
| Módulo | Tablas propias |
|---|---|
| tenancy | `tenants`, `sites` |
| users / auth | `users` |
| patients | `patients` |
| encounters | `encounters`, `encounter_events`, `pre_registrations` (F-02), `vital_signs`, `symptom_findings` (por confirmar en la spec de F-03) |
| triage | `triage_decisions` |
| ai | `triage_suggestions` |
| audit | `audit_log` |
| queue, reports | Ninguna; leen mediante services. |

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

### Pendiente (preguntas abiertas)
- `vital_signs`: ¿columnas tipadas o `jsonb`? Depende de PA-F03-1.
- `symptom_findings`: ¿catálogo o texto? Depende de PA-F03-3.
- `complaint_source`: el prompt fija `VOICE_ON_DEVICE`; `TYPED` es el valor propuesto para el texto escrito.
