import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class ColaEnvioSii1792019884107 implements MigrationInterface {
  name = 'ColaEnvioSii1792019884107';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "dte_documentos" ("documento_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "razon_social_id" uuid NOT NULL, "caf_id" uuid NOT NULL, "tipo" smallint NOT NULL, "folio" integer NOT NULL, "ambiente" text NOT NULL, "rut_emisor" character varying(12) NOT NULL, "xml" text NOT NULL, "estado" text NOT NULL, "envio_id" uuid, "detalle_sii" jsonb, "emitido_el" TIMESTAMP WITH TIME ZONE NOT NULL, "proximo_intento_el" TIMESTAMP WITH TIME ZONE NOT NULL, "intentos" integer NOT NULL DEFAULT '0', "ultimo_error" text, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_dte_documentos_ambiente" CHECK ("ambiente" IN ('certificacion','produccion')), CONSTRAINT "chk_dte_documentos_estado" CHECK ("estado" IN ('pendiente','enviado','aceptado','reparos','rechazado')), CONSTRAINT "chk_dte_documentos_tipo" CHECK ("tipo" IN (39, 41)), CONSTRAINT "PK_21a98b43645c8a091de2d871521" PRIMARY KEY ("documento_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_dte_documentos_envio" ON "dte_documentos"  ("envio_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_dte_documentos_cola" ON "dte_documentos"  ("razon_social_id", "emitido_el") WHERE "estado" = 'pendiente' AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_dte_documentos_folio" ON "dte_documentos"  ("razon_social_id", "tipo", "ambiente", "folio") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "dte_envios" ("envio_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "razon_social_id" uuid NOT NULL, "ambiente" text NOT NULL, "trackid" bigint, "estado_sii" character varying(3), "enviado_el" TIMESTAMP WITH TIME ZONE, "consultar_desde" TIMESTAMP WITH TIME ZONE, "reservado_hasta" TIMESTAMP WITH TIME ZONE, "intentos_consulta" integer NOT NULL DEFAULT '0', "ultimo_error" text, "respuesta_sii" jsonb, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_dte_envios_ambiente" CHECK ("ambiente" IN ('certificacion','produccion')), CONSTRAINT "PK_df7c0af52a1b802ea7e9fc44eb7" PRIMARY KEY ("envio_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_dte_envios_consulta" ON "dte_envios"  ("consultar_desde") WHERE "trackid" IS NOT NULL AND "eliminado_el" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_dte_envios_consulta"`);
    await queryRunner.query(`DROP TABLE "dte_envios"`);
    await queryRunner.query(`DROP INDEX "public"."uq_dte_documentos_folio"`);
    await queryRunner.query(`DROP INDEX "public"."idx_dte_documentos_cola"`);
    await queryRunner.query(`DROP INDEX "public"."idx_dte_documentos_envio"`);
    await queryRunner.query(`DROP TABLE "dte_documentos"`);
  }
}
