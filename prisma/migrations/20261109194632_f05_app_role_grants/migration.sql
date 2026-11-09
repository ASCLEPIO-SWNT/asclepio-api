-- F-05-api · Migración 2: permisos de asclepio_app sobre triage_decisions (R19, RNF-02, RNF-03, ADR 0003).
-- triage_decisions es append-only: solo SELECT e INSERT (sin UPDATE, DELETE ni TRUNCATE).
-- encounters ya tiene UPDATE a nivel de tabla (f02_app_role_grants): las columnas nuevas no necesitan grant.
-- Ids uuid: no hay secuencias. Sin contraseñas, sin LOGIN y sin ALTER DEFAULT PRIVILEGES.
GRANT SELECT, INSERT ON "asclepio"."triage_decisions" TO asclepio_app;
