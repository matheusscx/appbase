import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class BoletasConProblemas1792098507237 implements MigrationInterface {
  name = 'BoletasConProblemas1792098507237';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_dte_documentos_problemas" ON "dte_documentos"  ("tenant_id", "emitido_el") WHERE "estado" IN ('pendiente','enviado','rechazado') AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_venta_documentos_dte" ON "venta_documentos"  ("dte_documento_id") WHERE "dte_documento_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_venta_documentos_dte"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_dte_documentos_problemas"`,
    );
  }
}
