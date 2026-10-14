import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class PerfilFiscalEmisor1792006780176 implements MigrationInterface {
  name = 'PerfilFiscalEmisor1792006780176';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "dte_cafs" ("caf_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "razon_social_id" uuid NOT NULL, "tipo" smallint NOT NULL, "rut_emisor" character varying(12) NOT NULL, "ambiente" text NOT NULL, "desde" integer NOT NULL, "hasta" integer NOT NULL, "siguiente_folio" integer NOT NULL, "idk" integer NOT NULL, "fecha_autorizacion" date NOT NULL, "xml_cifrado" text NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_dte_cafs_siguiente" CHECK ("siguiente_folio" >= "desde" AND "siguiente_folio" <= "hasta" + 1), CONSTRAINT "chk_dte_cafs_rango" CHECK ("desde" >= 1 AND "desde" <= "hasta"), CONSTRAINT "chk_dte_cafs_ambiente" CHECK ("ambiente" IN ('certificacion','produccion')), CONSTRAINT "chk_dte_cafs_tipo" CHECK ("tipo" IN (39, 41)), CONSTRAINT "PK_13881efdb73edebc1b8cfa222e3" PRIMARY KEY ("caf_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_dte_cafs_desde" ON "dte_cafs"  ("razon_social_id", "tipo", "ambiente", "desde") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_dte_cafs_razon_social" ON "dte_cafs"  ("razon_social_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "dte_certificados" ("certificado_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "razon_social_id" uuid NOT NULL, "credencial_cifrada" text, "rut_firmante" character varying(12) NOT NULL, "nombre_firmante" text NOT NULL, "vence_el" TIMESTAMP WITH TIME ZONE NOT NULL, "reemplazado_el" TIMESTAMP WITH TIME ZONE, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_d9ee76b878722392352491bcfe4" PRIMARY KEY ("certificado_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_dte_certificados_vigente" ON "dte_certificados"  ("razon_social_id") WHERE "reemplazado_el" IS NULL AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_dte_certificados_razon_social" ON "dte_certificados"  ("razon_social_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "razones_sociales" ADD "giro" character varying(80)`,
    );
    await queryRunner.query(
      `ALTER TABLE "razones_sociales" ADD "comuna" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "razones_sociales" ADD "ambiente_sii" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "razones_sociales" ADD "fecha_resolucion" date`,
    );
    await queryRunner.query(
      `ALTER TABLE "razones_sociales" ADD "numero_resolucion" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "razones_sociales" ADD CONSTRAINT "chk_razones_sociales_numero_resolucion" CHECK ("numero_resolucion" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "razones_sociales" ADD CONSTRAINT "chk_razones_sociales_ambiente_sii" CHECK ("ambiente_sii" IN ('certificacion','produccion'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "razones_sociales" DROP CONSTRAINT "chk_razones_sociales_ambiente_sii"`,
    );
    await queryRunner.query(
      `ALTER TABLE "razones_sociales" DROP CONSTRAINT "chk_razones_sociales_numero_resolucion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "razones_sociales" DROP COLUMN "numero_resolucion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "razones_sociales" DROP COLUMN "fecha_resolucion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "razones_sociales" DROP COLUMN "ambiente_sii"`,
    );
    await queryRunner.query(
      `ALTER TABLE "razones_sociales" DROP COLUMN "comuna"`,
    );
    await queryRunner.query(
      `ALTER TABLE "razones_sociales" DROP COLUMN "giro"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_dte_certificados_razon_social"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_dte_certificados_vigente"`,
    );
    await queryRunner.query(`DROP TABLE "dte_certificados"`);
    await queryRunner.query(`DROP INDEX "public"."idx_dte_cafs_razon_social"`);
    await queryRunner.query(`DROP INDEX "public"."uq_dte_cafs_desde"`);
    await queryRunner.query(`DROP TABLE "dte_cafs"`);
  }
}
