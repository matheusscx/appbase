import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class ConceptosMovimientoCaja1792300000000 implements MigrationInterface {
  name = 'ConceptosMovimientoCaja1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "concepto_movimiento_caja" ("concepto_movimiento_caja_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" text NOT NULL, "tipo" text NOT NULL DEFAULT 'ambos', "activo" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "chk_concepto_mov_caja_tipo" CHECK ("tipo" IN ('entrada', 'salida', 'ambos')), CONSTRAINT "PK_c4b04d0d24f7a27aac300336b73" PRIMARY KEY ("concepto_movimiento_caja_id"))`,
    );
    // Único por tenant sobre `lower(nombre)` y solo entre los vivos: TypeORM no
    // sabe expresarlo, por eso va con SQL cruda (la entity registra el nombre).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_concepto_mov_caja_tenant_nombre" ON "concepto_movimiento_caja" (tenant_id, lower(nombre)) WHERE "eliminado_el" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_concepto_mov_caja_tenant_nombre"`,
    );
    await queryRunner.query(`DROP TABLE "concepto_movimiento_caja"`);
  }
}
