-- F-04-api · Migración 1: sugerencias de triage (triage_suggestions). Dueño: ai. Una fila por solicitud (D2).
-- Todas las FK son ON DELETE RESTRICT ON UPDATE RESTRICT (R24). Sin DROP de objetos de F-01 a F-03.

-- ---------------------------------------------------------------- Limpieza previa (autorizada por el humano, 2026-11-09)
-- Un intento anterior de F-04 aplicó en Supabase las migraciones 20261029031815_f04_triage_suggestions y
-- 20261029031841_f04_app_role_grants, que nunca llegaron al repo: crearon triage_suggestions con el diseño viejo
-- (0 filas, sin referencias) y los enums triage_suggestion_status y llm_provider. Se eliminan antes de crearlos de nuevo.
-- IF EXISTS: en una base limpia no hacen nada. Sin CASCADE: si algo dependiera de ellos, la migración falla.
DROP TABLE IF EXISTS "asclepio"."triage_suggestions";
DROP TYPE IF EXISTS "asclepio"."triage_suggestion_status";
DROP TYPE IF EXISTS "asclepio"."llm_provider";

-- CreateEnum
CREATE TYPE "asclepio"."triage_suggestion_status" AS ENUM ('OK', 'INVALID_OUTPUT', 'TIMEOUT', 'FAILED');

-- CreateEnum
CREATE TYPE "asclepio"."llm_provider" AS ENUM ('GROQ', 'OPENROUTER');

-- CreateTable
CREATE TABLE "asclepio"."triage_suggestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "input_snapshot" JSONB NOT NULL,
    "status" "asclepio"."triage_suggestion_status" NOT NULL,
    "llm_level" SMALLINT,
    "suggested_level" SMALLINT,
    "explanation" JSONB,
    "guard_applied" BOOLEAN NOT NULL DEFAULT false,
    "guard_reasons" JSONB NOT NULL DEFAULT '[]',
    "provider" "asclepio"."llm_provider",
    "model" TEXT,
    "prompt_version" TEXT NOT NULL,
    "raw_response" TEXT,
    "tokens_in" INTEGER,
    "tokens_out" INTEGER,
    "latency_ms" INTEGER NOT NULL,
    "attempts" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "triage_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "triage_suggestions_encounter_id_created_at_id_idx" ON "asclepio"."triage_suggestions"("encounter_id", "created_at" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "asclepio"."triage_suggestions" ADD CONSTRAINT "triage_suggestions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."triage_suggestions" ADD CONSTRAINT "triage_suggestions_encounter_id_tenant_id_fkey" FOREIGN KEY ("encounter_id", "tenant_id") REFERENCES "asclepio"."encounters"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."triage_suggestions" ADD CONSTRAINT "triage_suggestions_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "asclepio"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------- Bloque manual (CHECK de coherencia, R19)
-- status = OK ⇔ hay nivel del LLM, nivel sugerido y explicación; en INVALID_OUTPUT, TIMEOUT y FAILED van NULL.
ALTER TABLE "asclepio"."triage_suggestions" ADD CONSTRAINT "triage_suggestions_status_levels" CHECK (
  ("status" = 'OK') = ("llm_level" IS NOT NULL AND "suggested_level" IS NOT NULL AND "explanation" IS NOT NULL)
);

-- Niveles de triage I–V (Res. 5596 de 2015).
ALTER TABLE "asclepio"."triage_suggestions" ADD CONSTRAINT "triage_suggestions_llm_level_range" CHECK (
  "llm_level" BETWEEN 1 AND 5
);
ALTER TABLE "asclepio"."triage_suggestions" ADD CONSTRAINT "triage_suggestions_suggested_level_range" CHECK (
  "suggested_level" BETWEEN 1 AND 5
);

-- Los SafetyGuards solo suben la gravedad (ADR 0005): el nivel sugerido nunca es menos grave que el del LLM (R19).
ALTER TABLE "asclepio"."triage_suggestions" ADD CONSTRAINT "triage_suggestions_guard_never_lowers" CHECK (
  "suggested_level" <= "llm_level"
);

-- guard_applied refleja si un guard subió la gravedad (solo en status = OK).
ALTER TABLE "asclepio"."triage_suggestions" ADD CONSTRAINT "triage_suggestions_guard_applied" CHECK (
  "status" <> 'OK' OR "guard_applied" = ("suggested_level" < "llm_level")
);

ALTER TABLE "asclepio"."triage_suggestions" ADD CONSTRAINT "triage_suggestions_latency_non_negative" CHECK (
  "latency_ms" >= 0
);
