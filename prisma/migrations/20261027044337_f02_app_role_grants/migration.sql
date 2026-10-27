-- F-02-api · Migración 2: permisos de asclepio_app sobre las tablas de F-02 (R40, D13, RNF-02, ADR 0003).
-- Sin contraseñas, sin LOGIN y sin ALTER DEFAULT PRIVILEGES (igual que f01_app_role_grants).
-- patients y sites ya tienen sus permisos desde F-01; no cambian.

-- Ninguna funcionalidad borra atenciones ni pre-registros: sin DELETE.
GRANT SELECT, INSERT, UPDATE ON
  "asclepio"."encounters",
  "asclepio"."pre_registrations"
TO asclepio_app;

-- encounter_events es append-only: solo SELECT e INSERT (sin UPDATE, DELETE ni TRUNCATE).
GRANT SELECT, INSERT ON "asclepio"."encounter_events" TO asclepio_app;
GRANT USAGE ON SEQUENCE "asclepio"."encounter_events_id_seq" TO asclepio_app;
