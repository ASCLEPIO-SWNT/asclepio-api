-- F-03-api · Migración 2: permisos de asclepio_app sobre las tablas de captura clínica (R19, RNF-02, ADR 0003).
-- vital_signs y symptom_findings son append-only: solo SELECT e INSERT (sin UPDATE, DELETE ni TRUNCATE).
-- Ids uuid (D14): no hay secuencias. Sin contraseñas, sin LOGIN y sin ALTER DEFAULT PRIVILEGES.
-- encounters ya tiene UPDATE desde f02_app_role_grants (el bloqueo de D5 actualiza updated_at); no cambia.
GRANT SELECT, INSERT ON
  "asclepio"."vital_signs",
  "asclepio"."symptom_findings"
TO asclepio_app;
