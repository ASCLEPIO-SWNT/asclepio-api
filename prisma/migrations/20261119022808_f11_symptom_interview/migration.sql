-- F-11-api · Migración única: entrevista de síntomas y señales de alarma en pre_registrations y encounters. Dueño:
-- encounters (D1, D2 de specs/F-11-api/design.md). Solo añade columnas: las filas existentes quedan con
-- symptom_interview = NULL y red_flags = '{}' (R3). Sin índices nuevos: el orden se hace en memoria sobre las activas.
-- Grants: asclepio_app ya tiene SELECT, INSERT y UPDATE a nivel de tabla sobre ambas (f02_app_role_grants); las
-- columnas nuevas no necesitan grant. No toca audit_log ni encounter_events.

-- AlterTable
ALTER TABLE "asclepio"."encounters" ADD COLUMN     "red_flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "symptom_interview" JSONB;

-- AlterTable
ALTER TABLE "asclepio"."pre_registrations" ADD COLUMN     "red_flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "symptom_interview" JSONB;

-- ---------------------------------------------------------------- Bloque manual (CHECK de D2)
-- Valores de RedFlag (PA-F11-1, PROVISIONAL): misma lista que RED_FLAGS en src/modules/interview/interview.rules.ts.
ALTER TABLE "asclepio"."pre_registrations" ADD CONSTRAINT "pre_registrations_red_flags_allowed" CHECK (
  "red_flags" <@ ARRAY['CHEST_PAIN', 'BREATHING_DIFFICULTY', 'LOSS_OF_CONSCIOUSNESS', 'SEIZURE', 'SEVERE_BLEEDING', 'STROKE_SIGNS', 'SUICIDAL_IDEATION']::TEXT[]
);

ALTER TABLE "asclepio"."encounters" ADD CONSTRAINT "encounters_red_flags_allowed" CHECK (
  "red_flags" <@ ARRAY['CHEST_PAIN', 'BREATHING_DIFFICULTY', 'LOSS_OF_CONSCIOUSNESS', 'SEIZURE', 'SEVERE_BLEEDING', 'STROKE_SIGNS', 'SUICIDAL_IDEATION']::TEXT[]
);

-- La entrevista, si existe, es un objeto JSON (la forma completa la valida la API, R2).
ALTER TABLE "asclepio"."pre_registrations" ADD CONSTRAINT "pre_registrations_symptom_interview_object" CHECK (
  "symptom_interview" IS NULL OR jsonb_typeof("symptom_interview") = 'object'
);

ALTER TABLE "asclepio"."encounters" ADD CONSTRAINT "encounters_symptom_interview_object" CHECK (
  "symptom_interview" IS NULL OR jsonb_typeof("symptom_interview") = 'object'
);
