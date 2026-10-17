import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CajonPrincipal1792300000002 implements MigrationInterface {
  name = 'CajonPrincipal1792300000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cajones" ADD "principal" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_cajones_principal_por_tenant" ON "cajones" ("tenant_id") WHERE "principal" = true AND "eliminado_el" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."ux_cajones_principal_por_tenant"`,
    );
    await queryRunner.query(`ALTER TABLE "cajones" DROP COLUMN "principal"`);
  }
}
