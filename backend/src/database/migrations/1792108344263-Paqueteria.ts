import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class Paqueteria1792108344263 implements MigrationInterface {
  name = 'Paqueteria1792108344263';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "paquete_configuracion" ("paquete_configuracion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "precio_envio_defecto" numeric(18,4) NOT NULL, "pago_repartidor_defecto" numeric(18,4) NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_564fc8cf6462993576b90b9ea3d" PRIMARY KEY ("paquete_configuracion_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_paquete_config_tenant" ON "paquete_configuracion"  ("tenant_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "repartidores" ("repartidor_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" character varying(150) NOT NULL, "telefono" character varying(30), "activo" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_d359bb81482f17127a926f90f04" PRIMARY KEY ("repartidor_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_repartidores_tenant" ON "repartidores"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "paquetes" ("paquete_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "codigo" character varying(100) NOT NULL, "destinatario_nombre" character varying(150), "destinatario_telefono" character varying(30), "direccion" character varying(255), "comuna" character varying(100), "nota" text, "remitente_tercero_id" uuid, "cobro_en_destino" boolean NOT NULL DEFAULT false, "precio_envio" numeric(18,4) NOT NULL, "pago_repartidor" numeric(18,4) NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_77e803a2ae1753a942f3e556613" PRIMARY KEY ("paquete_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_paquetes_remitente" ON "paquetes"  ("remitente_tercero_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_paquetes_tenant_codigo" ON "paquetes"  ("tenant_id", "codigo") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "hojas_ruta" ("hoja_ruta_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "repartidor_id" uuid NOT NULL, "fecha" date NOT NULL, "estado" character varying(20) NOT NULL DEFAULT 'abierta', "rendida_por" uuid, "rendida_el" TIMESTAMP WITH TIME ZONE, "total_asignados" integer, "total_entregados" integer, "total_cobro_destino" integer, "monto_cobrado_destino" numeric(18,4), "monto_pago_repartidor" numeric(18,4), "monto_total_general" numeric(18,4), "neto_a_rendir" numeric(18,4), "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_e1b62829132ffc1672d923bf54b" PRIMARY KEY ("hoja_ruta_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_hojas_ruta_tenant_fecha" ON "hojas_ruta"  ("tenant_id", "fecha") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_hojas_ruta_repartidor_fecha" ON "hojas_ruta"  ("tenant_id", "repartidor_id", "fecha") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "hoja_ruta_paquetes" ("hoja_ruta_paquete_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "hoja_ruta_id" uuid NOT NULL, "paquete_id" uuid NOT NULL, "estado" character varying(20) NOT NULL DEFAULT 'en_ruta', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_156264e067c3f06f5a07eb2a496" PRIMARY KEY ("hoja_ruta_paquete_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_hoja_ruta_paquetes_paquete" ON "hoja_ruta_paquetes"  ("paquete_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_hoja_ruta_paquetes_hoja" ON "hoja_ruta_paquetes"  ("hoja_ruta_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_hoja_ruta_paquetes_en_ruta" ON "hoja_ruta_paquetes"  ("paquete_id") WHERE "estado" = 'en_ruta' AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "paquetes" ADD CONSTRAINT "FK_e858250ee8a0a83ffded3357ca8" FOREIGN KEY ("remitente_tercero_id") REFERENCES "terceros"("tercero_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "hojas_ruta" ADD CONSTRAINT "FK_ffc1d68607b8f8b2270d2fc0c99" FOREIGN KEY ("repartidor_id") REFERENCES "repartidores"("repartidor_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" ADD CONSTRAINT "FK_ccbb5ddd3ff2f66480f0a3f4ed5" FOREIGN KEY ("hoja_ruta_id") REFERENCES "hojas_ruta"("hoja_ruta_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" ADD CONSTRAINT "FK_2b1b1a3767e3b9d42924d963789" FOREIGN KEY ("paquete_id") REFERENCES "paquetes"("paquete_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" DROP CONSTRAINT "FK_2b1b1a3767e3b9d42924d963789"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hoja_ruta_paquetes" DROP CONSTRAINT "FK_ccbb5ddd3ff2f66480f0a3f4ed5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hojas_ruta" DROP CONSTRAINT "FK_ffc1d68607b8f8b2270d2fc0c99"`,
    );
    await queryRunner.query(
      `ALTER TABLE "paquetes" DROP CONSTRAINT "FK_e858250ee8a0a83ffded3357ca8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_hoja_ruta_paquetes_en_ruta"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_hoja_ruta_paquetes_hoja"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_hoja_ruta_paquetes_paquete"`,
    );
    await queryRunner.query(`DROP TABLE "hoja_ruta_paquetes"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_hojas_ruta_repartidor_fecha"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_hojas_ruta_tenant_fecha"`,
    );
    await queryRunner.query(`DROP TABLE "hojas_ruta"`);
    await queryRunner.query(`DROP INDEX "public"."uq_paquetes_tenant_codigo"`);
    await queryRunner.query(`DROP INDEX "public"."idx_paquetes_remitente"`);
    await queryRunner.query(`DROP TABLE "paquetes"`);
    await queryRunner.query(`DROP INDEX "public"."idx_repartidores_tenant"`);
    await queryRunner.query(`DROP TABLE "repartidores"`);
    await queryRunner.query(`DROP INDEX "public"."uq_paquete_config_tenant"`);
    await queryRunner.query(`DROP TABLE "paquete_configuracion"`);
  }
}
