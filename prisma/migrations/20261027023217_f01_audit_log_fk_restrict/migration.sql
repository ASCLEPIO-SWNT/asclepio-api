-- DropForeignKey
ALTER TABLE "asclepio"."audit_log" DROP CONSTRAINT "audit_log_tenant_id_fkey";

-- AddForeignKey
ALTER TABLE "asclepio"."audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "asclepio"."tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
