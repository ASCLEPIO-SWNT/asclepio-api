-- F-05-api · Migración 1: decisión de triage (triage_decisions) y nivel final en encounters. Dueño: triage (tabla) y
-- encounters (columnas). Todas las FK son ON DELETE RESTRICT ON UPDATE RESTRICT (R19). Sin DROP de objetos de F-01 a F-04.
-- Antes de aplicarla en Supabase: SELECT count(*) FROM asclepio.encounters WHERE status IN ('TRIAGED','IN_CARE','CLOSED')
-- debe ser 0; si no, el CHECK encounters_triage_required falla (riesgo 3 de design.md).

-- CreateEnum
CREATE TYPE "asclepio"."triage_decision_action" AS ENUM ('VALIDATE', 'CORRECT', 'MANUAL');

-- AlterTable
ALTER TABLE "asclepio"."encounters" ADD COLUMN     "final_level" SMALLINT,
ADD COLUMN     "triaged_at" TIMESTAMPTZ(6),
ADD COLUMN     "triaged_by" UUID;

-- CreateTable
CREATE TABLE "asclepio"."triage_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "suggestion_id" UUID,
    "action" "asclepio"."triage_decision_action" NOT NULL,
    "level" SMALLINT NOT NULL,
    "reason" TEXT,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "triage_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "triage_decisions_encounter_id_key" ON "asclepio"."triage_decisions"("encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "triage_suggestions_id_encounter_id_key" ON "asclepio"."triage_suggestions"("id", "encounter_id");

-- AddForeignKey
ALTER TABLE "asclepio"."encounters" ADD CONSTRAINT "encounters_triaged_by_fkey" FOREIGN KEY ("triaged_by") REFERENCES "asclepio"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."triage_decisions" ADD CONSTRAINT "triage_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."triage_decisions" ADD CONSTRAINT "triage_decisions_encounter_id_tenant_id_fkey" FOREIGN KEY ("encounter_id", "tenant_id") REFERENCES "asclepio"."encounters"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."triage_decisions" ADD CONSTRAINT "triage_decisions_suggestion_id_encounter_id_fkey" FOREIGN KEY ("suggestion_id", "encounter_id") REFERENCES "asclepio"."triage_suggestions"("id", "encounter_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."triage_decisions" ADD CONSTRAINT "triage_decisions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "asclepio"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------- Bloque manual (CHECK de D7, R19)
-- MANUAL ⇔ sin sugerencia; VALIDATE y CORRECT siempre con sugerencia.
ALTER TABLE "asclepio"."triage_decisions" ADD CONSTRAINT "triage_decisions_manual_without_suggestion" CHECK (
  ("action" = 'MANUAL') = ("suggestion_id" IS NULL)
);

-- CORRECT ⇔ con motivo; sin motivo en VALIDATE ni MANUAL (PA-F05-2).
ALTER TABLE "asclepio"."triage_decisions" ADD CONSTRAINT "triage_decisions_reason_only_in_correct" CHECK (
  ("action" = 'CORRECT') = ("reason" IS NOT NULL)
);

-- Motivo de 1 a 500 caracteres sin contar los espacios iniciales y finales (PA-F05-2).
ALTER TABLE "asclepio"."triage_decisions" ADD CONSTRAINT "triage_decisions_reason_length" CHECK (
  char_length(btrim("reason")) BETWEEN 1 AND 500
);

-- Niveles de triage I–V (Res. 5596 de 2015).
ALTER TABLE "asclepio"."triage_decisions" ADD CONSTRAINT "triage_decisions_level_range" CHECK (
  "level" BETWEEN 1 AND 5
);

-- ---------------------------------------------------------------- Bloque manual (CHECK de D8, R11, RNF-03)
ALTER TABLE "asclepio"."encounters" ADD CONSTRAINT "encounters_final_level_range" CHECK (
  "final_level" BETWEEN 1 AND 5
);

-- final_level, triaged_at y triaged_by: los tres nulos o los tres no nulos.
ALTER TABLE "asclepio"."encounters" ADD CONSTRAINT "encounters_triage_all_or_none" CHECK (
  ("final_level" IS NULL) = ("triaged_at" IS NULL) AND ("final_level" IS NULL) = ("triaged_by" IS NULL)
);

-- Ninguna atención en TRIAGED, IN_CARE o CLOSED sin nivel final (CANCELLED puede tenerlo o no).
ALTER TABLE "asclepio"."encounters" ADD CONSTRAINT "encounters_triage_required" CHECK (
  "status" NOT IN ('TRIAGED', 'IN_CARE', 'CLOSED') OR "final_level" IS NOT NULL
);
