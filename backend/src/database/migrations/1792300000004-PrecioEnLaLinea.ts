import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class PrecioEnLaLinea1792300000004 implements MigrationInterface {
  name = 'PrecioEnLaLinea1792300000004';

  // Mismo molde que `PagoEnLaLinea`: una base con líneas entregadas (el demo de Railway, un dev
  // con seed) tiene que pasar el CHECK, así que se agregan las columnas, se RELLENAN desde lo
  // viejo y recién ahí van el CHECK y el DROP de la columna del paquete. Las líneas viejas quedan
  // con `tarifa_envio_id` NULL (no había tarifa; ningún CHECK la exige) y su precio es el que
  // tenía el paquete: las hojas rendidas no se mueven. El UPDATE incluye líneas con soft delete
  // porque un CHECK aplica a todas, y no filtra el borrado del paquete por la misma razón.
  //
  // Además se conserva el "precio de envío por defecto" que se borra con `paquete_configuracion`:
  // pasa a ser la tarifa "Estándar" por defecto de cada tenant que la tenía, así un paquete nuevo
  // sigue pudiendo escanearse con el mismo monto que antes (sin ella el escaneo daría 400 hasta
  // que alguien cargara una tarifa). El precio propio de un paquete todavía no entregado se pierde:
  // pasa a cobrarse con la por defecto.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" ADD "tarifa_envio_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" ADD "precio_envio" numeric(18,4)`,
    );
    await queryRunner.query(
      `UPDATE "hoja_ruta_paquetes" l
          SET "precio_envio" = p."precio_envio"
         FROM "paquetes" p
        WHERE p."paquete_id" = l."paquete_id" AND p."tenant_id" = l."tenant_id"
          AND l."estado" = 'entregado'`,
    );
    await queryRunner.query(
      `INSERT INTO "tarifas_envio" ("tenant_id", "nombre", "monto", "es_defecto")
       SELECT c."tenant_id", 'Estándar', c."precio_envio_defecto", true
         FROM "paquete_configuracion" c
        WHERE c."eliminado_el" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "tarifas_envio" t
             WHERE t."tenant_id" = c."tenant_id" AND t."eliminado_el" IS NULL
          )`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" ADD CONSTRAINT "chk_hoja_ruta_paquetes_precio" CHECK (("estado" = 'entregado') = ("precio_envio" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" ADD CONSTRAINT "FK_86356f19eca8b95552e654a3a91" FOREIGN KEY ("tarifa_envio_id") REFERENCES "tarifas_envio"("tarifa_envio_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "paquetes" DROP COLUMN "precio_envio"`,
    );
    await queryRunner.query(`DROP TABLE "paquete_configuracion"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "paquete_configuracion" ("paquete_configuracion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "precio_envio_defecto" numeric(18,4) NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_564fc8cf6462993576b90b9ea3d" PRIMARY KEY ("paquete_configuracion_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_paquete_config_tenant" ON "paquete_configuracion"  ("tenant_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `INSERT INTO "paquete_configuracion" ("tenant_id", "precio_envio_defecto")
       SELECT t."tenant_id", t."monto" FROM "tarifas_envio" t
        WHERE t."es_defecto" AND t."eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "paquetes" ADD "precio_envio" numeric(18,4)`,
    );
    // El precio del paquete: el de su entrega si ya se entregó; si no, el de su tarifa o el defecto.
    await queryRunner.query(
      `UPDATE "paquetes" p
          SET "precio_envio" = COALESCE(
            (SELECT l."precio_envio" FROM "hoja_ruta_paquetes" l
              WHERE l."paquete_id" = p."paquete_id" AND l."estado" = 'entregado'
              ORDER BY l."eliminado_el" NULLS FIRST LIMIT 1),
            (SELECT t."monto" FROM "tarifas_envio" t WHERE t."tarifa_envio_id" = p."tarifa_envio_id"),
            (SELECT t."monto" FROM "tarifas_envio" t
              WHERE t."tenant_id" = p."tenant_id" AND t."es_defecto" AND t."eliminado_el" IS NULL),
            0
          )`,
    );
    await queryRunner.query(
      `ALTER TABLE "paquetes" ALTER COLUMN "precio_envio" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" DROP CONSTRAINT "FK_86356f19eca8b95552e654a3a91"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" DROP CONSTRAINT "chk_hoja_ruta_paquetes_precio"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" DROP COLUMN "precio_envio"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" DROP COLUMN "tarifa_envio_id"`,
    );
  }
}
