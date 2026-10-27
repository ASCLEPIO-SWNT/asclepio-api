-- F-01-api · Migración 2: rol de runtime asclepio_app y sus permisos (R34, RNF-02, ADR 0003).
-- Sin contraseñas ni LOGIN (RNF-18): en Supabase los fija el responsable de backend fuera de banda;
-- en el PostgreSQL local de Docker, el script de npm run test:int.
-- Sin ALTER DEFAULT PRIVILEGES: cada migración futura concede sus permisos explícitamente, para que una
-- tabla append-only nueva nunca herede UPDATE/DELETE.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asclepio_app') THEN
    CREATE ROLE asclepio_app NOLOGIN;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA "asclepio" FROM PUBLIC;
GRANT USAGE ON SCHEMA "asclepio" TO asclepio_app;

-- Tablas operativas de F-01: CRUD.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "asclepio"."tenants",
  "asclepio"."sites",
  "asclepio"."users",
  "asclepio"."patients",
  "asclepio"."patient_accounts"
TO asclepio_app;

-- audit_log es append-only: solo SELECT e INSERT (sin UPDATE, DELETE ni TRUNCATE).
GRANT SELECT, INSERT ON "asclepio"."audit_log" TO asclepio_app;
GRANT USAGE ON SEQUENCE "asclepio"."audit_log_id_seq" TO asclepio_app;
