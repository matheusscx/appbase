import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class BoletaDesdeLaVenta1792067592439 implements MigrationInterface {
  name = 'BoletaDesdeLaVenta1792067592439';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenants" ADD "emite_boleta_electronica" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "metodos_pago" ADD "medio_pago_sii" smallint`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_documentos" ADD "dte_documento_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_documentos" ADD "emision_error_codigo" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_documentos" ADD "emision_error" text`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_venta_documentos_sin_emitir" ON "venta_documentos"  ("tenant_id", "creado_el") WHERE "estado_envio" = 'sin_emitir' AND "descarte" IS NULL AND "eliminado_el" IS NULL`,
    );
    // A mano (migration:generate no ve el cambio de un CHECK): `enviado` nunca tuvo escritor
    // (ADR-028 lo reservaba) y se reemplaza por `sin_emitir` y `emitido`. Solo un e2e que lo
    // escribía por SQL pudo dejar una fila así en una base de desarrollo (o en su volcado hacia
    // el demo): sin boleta detrás no vale como emitida, vuelve a `armado` en vez de trabar el CHECK.
    await queryRunner.query(
      `UPDATE "venta_documentos" SET "estado_envio" = 'armado' WHERE "estado_envio" = 'enviado'`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_documentos" DROP CONSTRAINT "chk_venta_documentos_estado_envio"`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_documentos" ADD CONSTRAINT "chk_venta_documentos_estado_envio" CHECK ("estado_envio" IN ('armado','sin_emitir','emitido'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_documentos" ADD CONSTRAINT "chk_venta_documentos_emitido" CHECK (("estado_envio" IS NOT DISTINCT FROM 'emitido') = ("dte_documento_id" IS NOT NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "venta_documentos" DROP CONSTRAINT "chk_venta_documentos_emitido"`,
    );
    // Una boleta ya emitida no se des-emite: si hay filas `emitido`, el ADD de abajo falla y la
    // reversa se detiene a propósito. Lo pendiente de emitir vuelve a ser un documento armado.
    await queryRunner.query(
      `UPDATE "venta_documentos" SET "estado_envio" = 'armado' WHERE "estado_envio" = 'sin_emitir'`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_documentos" DROP CONSTRAINT "chk_venta_documentos_estado_envio"`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_documentos" ADD CONSTRAINT "chk_venta_documentos_estado_envio" CHECK ("estado_envio" IN ('armado','enviado'))`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_venta_documentos_sin_emitir"`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_documentos" DROP COLUMN "emision_error"`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_documentos" DROP COLUMN "emision_error_codigo"`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_documentos" DROP COLUMN "dte_documento_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "metodos_pago" DROP COLUMN "medio_pago_sii"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenants" DROP COLUMN "emite_boleta_electronica"`,
    );
  }
}
