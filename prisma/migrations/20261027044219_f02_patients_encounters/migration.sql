/*
  Warnings:

  - A unique constraint covering the columns `[id,tenant_id]` on the table `sites` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "asclepio"."complaint_source" AS ENUM ('TYPED', 'VOICE_ON_DEVICE');

-- CreateEnum
CREATE TYPE "asclepio"."encounter_status" AS ENUM ('REGISTERED', 'WAITING_TRIAGE', 'TRIAGED', 'IN_CARE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "asclepio"."encounter_origin" AS ENUM ('PRE_REGISTRATION', 'DIRECT');

-- CreateEnum
CREATE TYPE "asclepio"."pre_registration_status" AS ENUM ('PENDING', 'CONFIRMED', 'EXPIRED', 'REJECTED');

-- AlterTable
ALTER TABLE "asclepio"."patients" ADD COLUMN     "estimated_age_years" SMALLINT,
ADD COLUMN     "identity_verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "asclepio"."encounters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "status" "asclepio"."encounter_status" NOT NULL,
    "origin" "asclepio"."encounter_origin" NOT NULL,
    "arrival_at" TIMESTAMPTZ(6) NOT NULL,
    "chief_complaint_text" TEXT NOT NULL,
    "complaint_source" "asclepio"."complaint_source" NOT NULL,
    "registered_by" UUID NOT NULL,
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asclepio"."pre_registrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "chief_complaint_text" TEXT NOT NULL,
    "complaint_source" "asclepio"."complaint_source" NOT NULL,
    "status" "asclepio"."pre_registration_status" NOT NULL DEFAULT 'PENDING',
    "pre_registered_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "encounter_id" UUID,
    "rejection_reason" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pre_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asclepio"."encounter_events" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "from_status" "asclepio"."encounter_status",
    "to_status" "asclepio"."encounter_status",
    "payload" JSONB NOT NULL DEFAULT '{}',
    "actor_type" "asclepio"."actor_type" NOT NULL,
    "actor_id" UUID,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "encounter_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "encounters_tenant_id_arrival_at_idx" ON "asclepio"."encounters"("tenant_id", "arrival_at" DESC);

-- CreateIndex
CREATE INDEX "encounters_tenant_id_status_arrival_at_idx" ON "asclepio"."encounters"("tenant_id", "status", "arrival_at");

-- CreateIndex
CREATE INDEX "encounters_tenant_id_patient_id_idx" ON "asclepio"."encounters"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "encounters_id_tenant_id_key" ON "asclepio"."encounters"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "encounters_one_active_per_patient" ON "asclepio"."encounters"("patient_id") WHERE (status NOT IN ('CLOSED', 'CANCELLED'));

-- CreateIndex
CREATE UNIQUE INDEX "pre_registrations_encounter_id_key" ON "asclepio"."pre_registrations"("encounter_id");

-- CreateIndex
CREATE INDEX "pre_registrations_tenant_id_status_expires_at_idx" ON "asclepio"."pre_registrations"("tenant_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "pre_registrations_patient_id_pre_registered_at_idx" ON "asclepio"."pre_registrations"("patient_id", "pre_registered_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "pre_registrations_one_pending_per_patient" ON "asclepio"."pre_registrations"("patient_id") WHERE (status = 'PENDING');

-- CreateIndex
CREATE INDEX "encounter_events_encounter_id_occurred_at_id_idx" ON "asclepio"."encounter_events"("encounter_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "encounter_events_tenant_id_occurred_at_idx" ON "asclepio"."encounter_events"("tenant_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "sites_id_tenant_id_key" ON "asclepio"."sites"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "asclepio"."encounters" ADD CONSTRAINT "encounters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asclepio"."encounters" ADD CONSTRAINT "encounters_site_id_tenant_id_fkey" FOREIGN KEY ("site_id", "tenant_id") REFERENCES "asclepio"."sites"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asclepio"."encounters" ADD CONSTRAINT "encounters_patient_id_tenant_id_fkey" FOREIGN KEY ("patient_id", "tenant_id") REFERENCES "asclepio"."patients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asclepio"."encounters" ADD CONSTRAINT "encounters_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "asclepio"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asclepio"."pre_registrations" ADD CONSTRAINT "pre_registrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asclepio"."pre_registrations" ADD CONSTRAINT "pre_registrations_patient_id_tenant_id_fkey" FOREIGN KEY ("patient_id", "tenant_id") REFERENCES "asclepio"."patients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asclepio"."pre_registrations" ADD CONSTRAINT "pre_registrations_site_id_tenant_id_fkey" FOREIGN KEY ("site_id", "tenant_id") REFERENCES "asclepio"."sites"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asclepio"."pre_registrations" ADD CONSTRAINT "pre_registrations_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "asclepio"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."pre_registrations" ADD CONSTRAINT "pre_registrations_encounter_id_tenant_id_fkey" FOREIGN KEY ("encounter_id", "tenant_id") REFERENCES "asclepio"."encounters"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."encounter_events" ADD CONSTRAINT "encounter_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."encounter_events" ADD CONSTRAINT "encounter_events_encounter_id_tenant_id_fkey" FOREIGN KEY ("encounter_id", "tenant_id") REFERENCES "asclepio"."encounters"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------- Bloque manual (F-02-api, design.md "Impacto en datos")
-- Los índices únicos parciales (D7) los genera Prisma arriba desde el schema (preview "partialIndexes"):
--   encounters_one_active_per_patient y pre_registrations_one_pending_per_patient.
-- Prisma no modela CHECK: van aquí. Las filas de F-01 los cumplen (documento completo, sin edad estimada).

-- PA-F02-1: tipo y número de documento van juntos (los dos o ninguno: NN).
ALTER TABLE "asclepio"."patients" ADD CONSTRAINT "patients_document_complete_chk"
  CHECK (("document_type" IS NULL) = ("document_number" IS NULL));

-- PA-F02-1: la edad estimada solo existe en un NN sin fecha de nacimiento y está entre 0 y 120.
ALTER TABLE "asclepio"."patients" ADD CONSTRAINT "patients_estimated_age_chk"
  CHECK ("estimated_age_years" IS NULL OR ("document_number" IS NULL AND "birth_date" IS NULL AND "estimated_age_years" BETWEEN 0 AND 120));

-- D2: la expiración siempre es posterior al pre-registro.
ALTER TABLE "asclepio"."pre_registrations" ADD CONSTRAINT "pre_registrations_expires_after_chk"
  CHECK ("expires_at" > "pre_registered_at");

-- D10: actor_id es NULL si y solo si el actor es el sistema.
ALTER TABLE "asclepio"."encounter_events" ADD CONSTRAINT "encounter_events_actor_chk"
  CHECK (("actor_type" = 'SYSTEM') = ("actor_id" IS NULL));

-- Revisión manual (D12): ninguna FK de encounter_events es CASCADE ni SET NULL (ambas RESTRICT/RESTRICT, arriba),
-- y esta migración no contiene DROP de objetos de F-01.
