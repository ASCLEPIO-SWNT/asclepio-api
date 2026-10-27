-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "asclepio";

-- CreateEnum
CREATE TYPE "asclepio"."user_role" AS ENUM ('RECEPTION', 'NURSE', 'PHYSICIAN', 'ADMIN');

-- CreateEnum
CREATE TYPE "asclepio"."actor_type" AS ENUM ('STAFF', 'PATIENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "asclepio"."patient_sex" AS ENUM ('M', 'F', 'X');

-- CreateTable
CREATE TABLE "asclepio"."tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asclepio"."sites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asclepio"."users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "asclepio"."user_role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asclepio"."patients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "document_type" TEXT,
    "document_number" TEXT,
    "full_name" TEXT,
    "birth_date" DATE,
    "sex" "asclepio"."patient_sex",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asclepio"."patient_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "consent_at" TIMESTAMPTZ(6) NOT NULL,
    "consent_version" TEXT NOT NULL,
    "identity_verified" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asclepio"."audit_log" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" UUID,
    "actor_type" "asclepio"."actor_type",
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_name_key" ON "asclepio"."tenants"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sites_tenant_id_name_key" ON "asclepio"."sites"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "asclepio"."users"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "asclepio"."users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "patients_tenant_id_document_type_document_number_key" ON "asclepio"."patients"("tenant_id", "document_type", "document_number");

-- CreateIndex
CREATE UNIQUE INDEX "patients_id_tenant_id_key" ON "asclepio"."patients"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_accounts_patient_id_key" ON "asclepio"."patient_accounts"("patient_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_occurred_at_idx" ON "asclepio"."audit_log"("tenant_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "asclepio"."sites" ADD CONSTRAINT "sites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asclepio"."users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asclepio"."patients" ADD CONSTRAINT "patients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asclepio"."patient_accounts" ADD CONSTRAINT "patient_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asclepio"."patient_accounts" ADD CONSTRAINT "patient_accounts_patient_id_tenant_id_fkey" FOREIGN KEY ("patient_id", "tenant_id") REFERENCES "asclepio"."patients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asclepio"."audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
