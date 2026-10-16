import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class PagoEnLaLinea1792183824215 implements MigrationInterface {
  name = 'PagoEnLaLinea1792183824215';

  // Una base con líneas entregadas (el demo de Railway, un dev con seed) tiene que pasar los CHECK:
  // se agregan las columnas, se rellenan desde lo viejo y recién ahí se agregan los CHECK y se
  // borran las columnas viejas. Las líneas viejas quedan con `tarifa_pago_id` NULL (no había
  // tarifa; ningún CHECK la exige) y su pago es el del paquete. El UPDATE incluye filas con soft
  // delete porque un CHECK aplica a todas.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hojas_ruta" ADD "monto_cobrado_efectivo" numeric(18,4)`,
    );
    await queryRunner.query(
      `ALTER TABLE "hojas_ruta" ADD "monto_cobrado_transferencia" numeric(18,4)`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" ADD "tarifa_pago_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" ADD "pago_repartidor" numeric(18,4)`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" ADD "medio_cobro" character varying(20)`,
    );
    await queryRunner.query(
      `UPDATE "hoja_ruta_paquetes" l
          SET "pago_repartidor" = p."pago_repartidor",
              "medio_cobro" = CASE WHEN p."cobro_en_destino" THEN 'efectivo' END
         FROM "paquetes" p
        WHERE p."paquete_id" = l."paquete_id" AND p."tenant_id" = l."tenant_id"
          AND l."estado" = 'entregado'`,
    );
    await queryRunner.query(
      `UPDATE "hojas_ruta"
          SET "monto_cobrado_efectivo" = "monto_cobrado_destino",
              "monto_cobrado_transferencia" = 0
        WHERE "estado" = 'rendida'`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" ADD CONSTRAINT "chk_hoja_ruta_paquetes_medio_entregado" CHECK ("medio_cobro" IS NULL OR "estado" = 'entregado')`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" ADD CONSTRAINT "chk_hoja_ruta_paquetes_pago" CHECK (("estado" = 'entregado') = ("pago_repartidor" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" ADD CONSTRAINT "chk_hoja_ruta_paquetes_medio_cobro" CHECK ("medio_cobro" IN ('efectivo', 'transferencia'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" ADD CONSTRAINT "FK_e1ec65c28fe73c160f68e9ba0cf" FOREIGN KEY ("tarifa_pago_id") REFERENCES "tarifas_pago"("tarifa_pago_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "paquete_configuracion" DROP COLUMN "pago_repartidor_defecto"`,
    );
    await queryRunner.query(
      `ALTER TABLE "paquetes" DROP COLUMN "pago_repartidor"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" DROP CONSTRAINT "FK_e1ec65c28fe73c160f68e9ba0cf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" DROP CONSTRAINT "chk_hoja_ruta_paquetes_medio_cobro"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" DROP CONSTRAINT "chk_hoja_ruta_paquetes_pago"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" DROP CONSTRAINT "chk_hoja_ruta_paquetes_medio_entregado"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" DROP COLUMN "medio_cobro"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" DROP COLUMN "pago_repartidor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" DROP COLUMN "tarifa_pago_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hojas_ruta" DROP COLUMN "monto_cobrado_transferencia"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hojas_ruta" DROP COLUMN "monto_cobrado_efectivo"`,
    );
    await queryRunner.query(
      `ALTER TABLE "paquetes" ADD "pago_repartidor" numeric(18,4) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "paquetes" ALTER COLUMN "pago_repartidor" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "paquete_configuracion" ADD "pago_repartidor_defecto" numeric(18,4) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "paquete_configuracion" ALTER COLUMN "pago_repartidor_defecto" DROP DEFAULT`,
    );
  }
}
