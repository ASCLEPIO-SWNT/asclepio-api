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
    text name
    timestamptz created_at
  }
  sites {
    uuid id PK
    uuid tenant_id FK
    text name
  }
  users {
    uuid id PK
    uuid tenant_id FK
    text email
    text password_hash
    text full_name
    enum role "RECEPTION|NURSE|PHYSICIAN|ADMIN"
    bool active
  }
  patients {
    uuid id PK
    uuid tenant_id FK
    text document_type
    text document_number "único por tenant; NULL si NN"
    text full_name
    date birth_date
    text sex
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
    uuid actor_id FK
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
| encounters | `encounters`, `encounter_events`, `vital_signs`, `symptom_findings` (por confirmar en la spec de F-03) |
| triage | `triage_decisions` |
| ai | `triage_suggestions` |
| audit | `audit_log` |
| queue, reports | Ninguna; leen mediante services. |

### Inmutabilidad
- `audit_log` y `encounter_events`: **solo inserciones**. El rol `asclepio_app` tiene `INSERT` y `SELECT`, sin `UPDATE` ni `DELETE` (los grants van en una migración SQL).
- `vital_signs`, `symptom_findings`, `triage_suggestions` y `triage_decisions`: solo inserciones desde la aplicación. Una nueva medición es una nueva fila.
- `encounters`: es la única tabla clínica que se actualiza (estado, `final_level`, `triaged_at`, `triaged_by`), siempre junto con un `encounter_event` en la misma transacción.

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

### App del paciente (ADR 0008) — propuesta, se cierra en las specs de F-01-api y F-02-api
- `patient_accounts`: credenciales del paciente (`patient_id`, `login`, `password_hash`, `consent_at`, `active`). Es un principal separado de `users`.
- `pre_registrations`: `patient_id`, `site_id`, `chief_complaint_text`, `complaint_source`, `pre_registered_at` (servidor), `status` (`PENDING`, `CONFIRMED`, `EXPIRED`, `REJECTED`), `encounter_id` (al confirmar), `confirmed_by`.
- Al confirmar se crea `encounters` con `arrival_at = now()` del servidor (hora legal) y `status = REGISTERED`.

### Pendiente (preguntas abiertas)
- `vital_signs`: ¿columnas tipadas o `jsonb`? Depende de PA-F03-1.
- `symptom_findings`: ¿catálogo o texto? Depende de PA-F03-3.
- `complaint_source`: el prompt fija `VOICE_ON_DEVICE`; `TYPED` es el valor propuesto para el texto escrito.
