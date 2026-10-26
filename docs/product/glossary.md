# Glosario

| Término | Definición | En el sistema |
|---|---|---|
| **IPS** | Institución Prestadora de Servicios de Salud. | Corresponde a un `tenant`. |
| **Sede** | Lugar físico de una IPS con servicio de urgencias. | `sites` |
| **Tenant** | Cliente aislado del SaaS (una IPS). Sus datos no se mezclan con los de otro tenant. | `tenants`; casi todas las tablas llevan `tenant_id`. |
| **Paciente** | Persona atendida. Su documento es único por tenant y es nulo si es NN. | `patients` |
| **NN** | Paciente sin identificar (sin documento). | `patients.document_number = NULL` |
| **Atención** (*encounter*) | Una visita del paciente a urgencias, desde la llegada hasta el cierre. | `encounters` |
| **Hora de llegada** | Momento en que se registra la atención. Siempre es la hora del servidor. | `encounters.arrival_at` |
| **Motivo de consulta** | Texto libre con la razón de la visita. | `encounters.chief_complaint_text` |
| **Fuente del motivo** | Cómo se capturó el motivo: escrito o dictado en el dispositivo. | `complaint_source` (`TYPED`, `VOICE_ON_DEVICE`) |
| **Signos vitales** | Mediciones fisiológicas (FC, PA, SatO₂, FR, temperatura, etc.). Solo se insertan; una nueva medición no sobrescribe la anterior. | `vital_signs` |
| **Hallazgo / síntoma** | Síntoma o hallazgo estructurado registrado en la captura clínica. | `symptom_findings` |
| **Triage** | Clasificación de la urgencia según la gravedad. | — |
| **Nivel de triage** | Valor de 1 a 5 (I–V) de la Res. 5596. 1 es el más grave. | `suggested_level`, `final_level` |
| **Sugerencia** | Propuesta de nivel y explicación generada por el módulo `ai`. **Nunca es final.** | `triage_suggestions` |
| **Explicación** | Justificación clínica de la sugerencia. Sus factores deben referirse a campos de la entrada. | `triage_suggestions.explanation` |
| **SafetyGuard (guard)** | Regla determinista que puede **subir** (nunca bajar) la gravedad sugerida. Siempre queda registrada. | `guard_applied`, `guard_reasons` |
| **Fallback** | Cambio al proveedor de respaldo (OpenRouter) o, si todo falla, a triage manual. | `triage_suggestions.status` |
| **Decisión** | Acto humano que fija el nivel final: `VALIDATE` (acepta la sugerencia), `CORRECT` (otro nivel, con motivo obligatorio) o `MANUAL` (sin sugerencia válida). | `triage_decisions` |
| **Nivel final** | Nivel que resulta de la decisión humana. | `encounters.final_level` |
| **Cola** | Lista priorizada de atenciones por nivel y tiempo de espera. | módulo `queue` |
| **Evento de atención** | Registro inmutable de cada hecho de la atención (llegada, sugerencia, decisión, cambio de estado), con hora del servidor y responsable. Forma la línea de tiempo. | `encounter_events` |
| **Auditoría** | Registro inmutable de acciones sensibles (quién, qué, cuándo). | `audit_log` |
| **Concordancia** | Grado de acuerdo entre el nivel sugerido por la IA y el nivel final (p. ej., kappa). | módulo `reports` |
| **Subclasificación / sobreclasificación** | El nivel sugerido es menos grave / más grave que el final. | módulo `reports` |
| **Viñeta clínica** | Caso sintético con nivel esperado que se usa para evaluar el prompt y el modelo. | `ai/vignettes/` |
| **Versión de prompt** | Identificador inmutable del prompt usado en una sugerencia. | `triage_suggestions.prompt_version` |
| **Contrato** | Especificación OpenAPI de la API. Es la fuente de verdad para los clientes. | `openapi/asclepio-api.v1.json` |
| **Feature global** | Funcionalidad de producto `F-0X`, descrita en `docs/product/features/`. | — |
| **Slice** | Parte de una feature global que se implementa en un repo (`F-0X-api`, `F-0X-web`, `F-0X-mobile`). | `feature_list.json` |
| **Spec** | Los tres archivos SDD de un slice: `requirements.md`, `design.md` y `tasks.md`. | `specs/<id>/` |
| **EARS** | *Easy Approach to Requirements Syntax*: plantillas para escribir requisitos. | `docs/specs.md` |
| **Res. 5596 de 2015** | Resolución de MinSalud que define el triage I–V. | — |
| **Res. 373 de 2026** | Resolución de MinSalud sobre la medición de tiempos de urgencias y el reporte a SISPRO. | módulo `reports` |
| **SISPRO** | Sistema Integral de Información de la Protección Social. | — |
