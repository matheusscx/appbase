import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class TarifasPago1792183098410 implements MigrationInterface {
  name = 'TarifasPago1792183098410';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "tarifas_pago" ("tarifa_pago_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" character varying(100) NOT NULL, "monto" numeric(18,4) NOT NULL, "es_defecto" boolean NOT NULL DEFAULT false, "activa" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_789dc835b1e43e09b73f4b497f6" PRIMARY KEY ("tarifa_pago_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_tarifas_pago_defecto" ON "tarifas_pago"  ("tenant_id") WHERE "es_defecto" AND "eliminado_el" IS NULL`,
    );
    // Sobre una expresión: `migration:generate` no la ve (ver la entity).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_tarifas_pago_tenant_nombre" ON "tarifas_pago" (tenant_id, lower(nombre)) WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "repartidores" ADD "tarifa_pago_id" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "paquetes" ADD "tarifa_pago_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "repartidores" ADD CONSTRAINT "FK_d984803383d70eb4b48efa7f5ed" FOREIGN KEY ("tarifa_pago_id") REFERENCES "tarifas_pago"("tarifa_pago_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "paquetes" ADD CONSTRAINT "FK_8aa5433a30bf7561345b453900b" FOREIGN KEY ("tarifa_pago_id") REFERENCES "tarifas_pago"("tarifa_pago_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "paquetes" DROP CONSTRAINT "FK_8aa5433a30bf7561345b453900b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "repartidores" DROP CONSTRAINT "FK_d984803383d70eb4b48efa7f5ed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "paquetes" DROP COLUMN "tarifa_pago_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "repartidores" DROP COLUMN "tarifa_pago_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_tarifas_pago_tenant_nombre"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_tarifas_pago_defecto"`);
    await queryRunner.query(`DROP TABLE "tarifas_pago"`);
  }
}
