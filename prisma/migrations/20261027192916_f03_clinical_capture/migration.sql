-- F-03-api · Migración 1: captura clínica (vital_signs, symptom_findings). Dueño: encounters (D1).
-- Todas las FK son ON DELETE RESTRICT ON UPDATE RESTRICT (D13). Sin DROP de objetos de F-01/F-02.

-- CreateEnum
CREATE TYPE "asclepio"."consciousness_level" AS ENUM ('A', 'C', 'V', 'P', 'U');

-- CreateEnum
CREATE TYPE "asclepio"."symptom_finding_kind" AS ENUM ('SYMPTOM', 'FINDING', 'COMPLAINT_NOTE');

-- CreateTable
CREATE TABLE "asclepio"."vital_signs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "respiratory_rate" SMALLINT,
    "oxygen_saturation" SMALLINT,
    "supplemental_oxygen" BOOLEAN,
    "systolic_bp" SMALLINT,
    "heart_rate" SMALLINT,
    "consciousness" "asclepio"."consciousness_level",
    "temperature_c" DECIMAL(4,1),
    "diastolic_bp" SMALLINT,
    "glucose_mg_dl" SMALLINT,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_by" UUID NOT NULL,

    CONSTRAINT "vital_signs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asclepio"."symptom_findings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "kind" "asclepio"."symptom_finding_kind" NOT NULL,
    "description" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_by" UUID NOT NULL,

    CONSTRAINT "symptom_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vital_signs_encounter_id_recorded_at_id_idx" ON "asclepio"."vital_signs"("encounter_id", "recorded_at", "id");

-- CreateIndex
CREATE INDEX "vital_signs_tenant_id_recorded_at_idx" ON "asclepio"."vital_signs"("tenant_id", "recorded_at");

-- CreateIndex
CREATE INDEX "symptom_findings_encounter_id_recorded_at_id_idx" ON "asclepio"."symptom_findings"("encounter_id", "recorded_at", "id");

-- CreateIndex
CREATE INDEX "symptom_findings_tenant_id_recorded_at_idx" ON "asclepio"."symptom_findings"("tenant_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "asclepio"."vital_signs" ADD CONSTRAINT "vital_signs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."vital_signs" ADD CONSTRAINT "vital_signs_encounter_id_tenant_id_fkey" FOREIGN KEY ("encounter_id", "tenant_id") REFERENCES "asclepio"."encounters"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."vital_signs" ADD CONSTRAINT "vital_signs_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "asclepio"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."symptom_findings" ADD CONSTRAINT "symptom_findings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."symptom_findings" ADD CONSTRAINT "symptom_findings_encounter_id_tenant_id_fkey" FOREIGN KEY ("encounter_id", "tenant_id") REFERENCES "asclepio"."encounters"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."symptom_findings" ADD CONSTRAINT "symptom_findings_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "asclepio"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------- Bloque manual (CHECK técnicos, no clínicos)
-- Los rangos clínicos NO van en la base (D3): viven en VITAL_SIGN_DEFINITIONS (PROVISIONAL, revisar con asesor clínico).

-- Una toma tiene al menos un signo.
ALTER TABLE "asclepio"."vital_signs" ADD CONSTRAINT "vital_signs_at_least_one_sign" CHECK (
  num_nonnulls(
    "respiratory_rate", "oxygen_saturation", "supplemental_oxygen", "systolic_bp", "heart_rate",
    "consciousness", "temperature_c", "diastolic_bp", "glucose_mg_dl"
  ) >= 1
);

-- description de 1 a 500 caracteres sin contar espacios iniciales y finales (D15).
ALTER TABLE "asclepio"."symptom_findings" ADD CONSTRAINT "symptom_findings_description_length" CHECK (
  char_length(btrim("description")) BETWEEN 1 AND 500
);
