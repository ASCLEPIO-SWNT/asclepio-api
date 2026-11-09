-- F-04-api · Migración 2: permisos de asclepio_app sobre triage_suggestions (R24, RNF-03, ADR 0003).
-- triage_suggestions es append-only: solo SELECT e INSERT (sin UPDATE, DELETE ni TRUNCATE).
-- Ids uuid: no hay secuencias. Sin contraseñas, sin LOGIN y sin ALTER DEFAULT PRIVILEGES.
GRANT SELECT, INSERT ON "asclepio"."triage_suggestions" TO asclepio_app;
