import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class TarifasEnvio1792300000003 implements MigrationInterface {
  name = 'TarifasEnvio1792300000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "tarifas_envio" ("tarifa_envio_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" character varying(100) NOT NULL, "monto" numeric(18,4) NOT NULL, "es_defecto" boolean NOT NULL DEFAULT false, "activa" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_28db9729e4105484836eeb147f2" PRIMARY KEY ("tarifa_envio_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_tarifas_envio_defecto" ON "tarifas_envio"  ("tenant_id") WHERE "es_defecto" AND "eliminado_el" IS NULL`,
    );
    // Sobre una expresión: `migration:generate` no la ve (ver la entity).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_tarifas_envio_tenant_nombre" ON "tarifas_envio" (tenant_id, lower(nombre)) WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "paquetes" ADD "tarifa_envio_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "paquetes" ADD CONSTRAINT "FK_e86bb8657a202ce9398995cefaf" FOREIGN KEY ("tarifa_envio_id") REFERENCES "tarifas_envio"("tarifa_envio_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "paquetes" DROP CONSTRAINT "FK_e86bb8657a202ce9398995cefaf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "paquetes" DROP COLUMN "tarifa_envio_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_tarifas_envio_tenant_nombre"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_tarifas_envio_defecto"`);
    await queryRunner.query(`DROP TABLE "tarifas_envio"`);
  }
}
