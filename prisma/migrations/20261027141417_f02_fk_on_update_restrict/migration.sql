-- F-02-api corrección 1: todas las FKs hacia tenants, sites, patients y users pasan a ON DELETE RESTRICT ON UPDATE RESTRICT.
-- ON UPDATE CASCADE (valor por defecto de Prisma) permitía reescribir encounters y pre_registrations sin evento ni auditoría
-- al cambiar el id referenciado: las acciones referenciales se ejecutan como dueño de la tabla y saltan los grants.
-- Revisado con --create-only: solo DROP/ADD CONSTRAINT, ningún DROP INDEX de los índices parciales (D7).

-- DropForeignKey
ALTER TABLE "asclepio"."encounters" DROP CONSTRAINT "encounters_patient_id_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "asclepio"."encounters" DROP CONSTRAINT "encounters_registered_by_fkey";

-- DropForeignKey
ALTER TABLE "asclepio"."encounters" DROP CONSTRAINT "encounters_site_id_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "asclepio"."encounters" DROP CONSTRAINT "encounters_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "asclepio"."patient_accounts" DROP CONSTRAINT "patient_accounts_patient_id_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "asclepio"."patient_accounts" DROP CONSTRAINT "patient_accounts_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "asclepio"."patients" DROP CONSTRAINT "patients_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "asclepio"."pre_registrations" DROP CONSTRAINT "pre_registrations_patient_id_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "asclepio"."pre_registrations" DROP CONSTRAINT "pre_registrations_site_id_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "asclepio"."pre_registrations" DROP CONSTRAINT "pre_registrations_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "asclepio"."sites" DROP CONSTRAINT "sites_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "asclepio"."users" DROP CONSTRAINT "users_tenant_id_fkey";

-- AddForeignKey
ALTER TABLE "asclepio"."sites" ADD CONSTRAINT "sites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."patients" ADD CONSTRAINT "patients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."patient_accounts" ADD CONSTRAINT "patient_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."patient_accounts" ADD CONSTRAINT "patient_accounts_patient_id_tenant_id_fkey" FOREIGN KEY ("patient_id", "tenant_id") REFERENCES "asclepio"."patients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."encounters" ADD CONSTRAINT "encounters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."encounters" ADD CONSTRAINT "encounters_site_id_tenant_id_fkey" FOREIGN KEY ("site_id", "tenant_id") REFERENCES "asclepio"."sites"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."encounters" ADD CONSTRAINT "encounters_patient_id_tenant_id_fkey" FOREIGN KEY ("patient_id", "tenant_id") REFERENCES "asclepio"."patients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."encounters" ADD CONSTRAINT "encounters_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "asclepio"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."pre_registrations" ADD CONSTRAINT "pre_registrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."pre_registrations" ADD CONSTRAINT "pre_registrations_patient_id_tenant_id_fkey" FOREIGN KEY ("patient_id", "tenant_id") REFERENCES "asclepio"."patients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asclepio"."pre_registrations" ADD CONSTRAINT "pre_registrations_site_id_tenant_id_fkey" FOREIGN KEY ("site_id", "tenant_id") REFERENCES "asclepio"."sites"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
