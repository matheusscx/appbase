import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class Rendiciones1792186125543 implements MigrationInterface {
  name = 'Rendiciones1792186125543';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "rendiciones" ("rendicion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "repartidor_id" uuid NOT NULL, "rendida_por" uuid, "rendida_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "total_entregados" integer NOT NULL, "monto_cobrado_destino" numeric(18,4) NOT NULL, "monto_cobrado_efectivo" numeric(18,4) NOT NULL, "monto_cobrado_transferencia" numeric(18,4) NOT NULL, "monto_pago_repartidor" numeric(18,4) NOT NULL, "monto_entregado_a_cuenta" numeric(18,4) NOT NULL, "saldo" numeric(18,4) NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_74c57d9b1f55dc11dabb5b9415c" PRIMARY KEY ("rendicion_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_rendiciones_repartidor" ON "rendiciones"  ("tenant_id", "repartidor_id", "rendida_el") `,
    );
    await queryRunner.query(
      `CREATE TABLE "entregas_repartidor" ("entrega_repartidor_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "repartidor_id" uuid NOT NULL, "fecha" date NOT NULL, "monto" numeric(18,4) NOT NULL, "medio" character varying(20) NOT NULL, "nota" character varying(500), "registrada_por" uuid NOT NULL, "rendicion_id" uuid, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_entregas_repartidor_medio" CHECK ("medio" IN ('efectivo', 'transferencia')), CONSTRAINT "chk_entregas_repartidor_monto" CHECK ("monto" > 0), CONSTRAINT "PK_53500f8cdefe6aabe69e989b087" PRIMARY KEY ("entrega_repartidor_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_entregas_repartidor_rendicion" ON "entregas_repartidor"  ("rendicion_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_entregas_repartidor_repartidor" ON "entregas_repartidor"  ("tenant_id", "repartidor_id") `,
    );
    await queryRunner.query(`ALTER TABLE "hojas_ruta" ADD "rendicion_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "idx_hojas_ruta_rendicion" ON "hojas_ruta"  ("rendicion_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "rendiciones" ADD CONSTRAINT "FK_9750ce83d9dcb8842fafcc3e9c7" FOREIGN KEY ("repartidor_id") REFERENCES "repartidores"("repartidor_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "hojas_ruta" ADD CONSTRAINT "FK_2d9a036f3b9d7fd4ce56f99fac4" FOREIGN KEY ("rendicion_id") REFERENCES "rendiciones"("rendicion_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "entregas_repartidor" ADD CONSTRAINT "FK_37aa5230c826b367c6a2be5d1c8" FOREIGN KEY ("repartidor_id") REFERENCES "repartidores"("repartidor_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "entregas_repartidor" ADD CONSTRAINT "FK_1727a5b7ec23b53e7ca82971aa3" FOREIGN KEY ("rendicion_id") REFERENCES "rendiciones"("rendicion_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "entregas_repartidor" DROP CONSTRAINT "FK_1727a5b7ec23b53e7ca82971aa3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "entregas_repartidor" DROP CONSTRAINT "FK_37aa5230c826b367c6a2be5d1c8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hojas_ruta" DROP CONSTRAINT "FK_2d9a036f3b9d7fd4ce56f99fac4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rendiciones" DROP CONSTRAINT "FK_9750ce83d9dcb8842fafcc3e9c7"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_hojas_ruta_rendicion"`);
    await queryRunner.query(
      `ALTER TABLE "hojas_ruta" DROP COLUMN "rendicion_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_entregas_repartidor_repartidor"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_entregas_repartidor_rendicion"`,
    );
    await queryRunner.query(`DROP TABLE "entregas_repartidor"`);
    await queryRunner.query(`DROP INDEX "public"."idx_rendiciones_repartidor"`);
    await queryRunner.query(`DROP TABLE "rendiciones"`);
  }
}
