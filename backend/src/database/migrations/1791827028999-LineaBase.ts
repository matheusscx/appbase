import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class LineaBase1791827028999 implements MigrationInterface {
  name = 'LineaBase1791827028999';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Lo crea también el driver de TypeORM al conectar (hay columnas `uuid_generate_v4()`),
    // pero el esquema no depende de eso.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE "usuarios" ("usuario_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nombre_usuario" character varying, "contrasena" character varying, "nombre" character varying NOT NULL, "apellido" character varying, "telefono" character varying, "correo" character varying NOT NULL, "es_superadmin" boolean NOT NULL DEFAULT false, "preferencias" jsonb NOT NULL DEFAULT '{}', "google_id" character varying, "correo_verificado_el" TIMESTAMP WITH TIME ZONE, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_1a7a36f3dffef210b4c0ba5c6c0" UNIQUE ("nombre_usuario"), CONSTRAINT "UQ_63665765c1a778a770c9bd585d3" UNIQUE ("correo"), CONSTRAINT "PK_14bb5fbbada99a453c18106d039" PRIMARY KEY ("usuario_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "token" character varying NOT NULL, "user_id" uuid NOT NULL, "active_tenant_id" uuid, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "usado_el" TIMESTAMP WITH TIME ZONE, "reemplazado_por" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_4542dd2f38a61354a040ba9fd57" UNIQUE ("token"), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "tokens_acceso" ("token_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "token_hash" text NOT NULL, "tipo" text NOT NULL, "usuario_id" uuid NOT NULL, "expira_el" TIMESTAMP WITH TIME ZONE NOT NULL, "usado_el" TIMESTAMP WITH TIME ZONE, "datos" jsonb, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_bb7ffb7da7a4cb191899f1ccff2" UNIQUE ("token_hash"), CONSTRAINT "PK_185af317ed93373d4f745d25595" PRIMARY KEY ("token_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "pais" ("pais_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nombre" character varying NOT NULL, "codigo_iso" character(2) NOT NULL, "zona_horaria_principal" character varying NOT NULL, "moneda_oficial_id" uuid, "modo_redondeo_sugerido" character varying, "modo_redondeo_es_ley" boolean NOT NULL DEFAULT false, "modo_redondeo_norma" text, "nivel_redondeo_sugerido" text, "nivel_redondeo_es_ley" boolean NOT NULL DEFAULT false, "nivel_redondeo_norma" text, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_e4892f1a88c1cf71eea4503f3a7" UNIQUE ("codigo_iso"), CONSTRAINT "chk_pais_nivel_redondeo_dominio" CHECK ("nivel_redondeo_sugerido" IS NULL OR "nivel_redondeo_sugerido" IN ('linea','documento')), CONSTRAINT "chk_pais_modo_redondeo_dominio" CHECK ("modo_redondeo_sugerido" IS NULL OR "modo_redondeo_sugerido" IN ('HALF_UP','HALF_EVEN','FLOOR','CEIL')), CONSTRAINT "chk_pais_nivel_redondeo_ley" CHECK ((NOT "nivel_redondeo_es_ley") OR ("nivel_redondeo_sugerido" IS NOT NULL)), CONSTRAINT "chk_pais_modo_redondeo_ley" CHECK ((NOT "modo_redondeo_es_ley") OR ("modo_redondeo_sugerido" IS NOT NULL)), CONSTRAINT "PK_0b38e1e195502aae6834a199e0f" PRIMARY KEY ("pais_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "provincia" ("provincia_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "pais_id" uuid NOT NULL, "nombre" character varying NOT NULL, "zona_horaria" character varying NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_104fcf56aaba936ce8e089f6731" PRIMARY KEY ("provincia_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "moneda" ("moneda_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nombre" character varying NOT NULL, "codigo_iso" character(3) NOT NULL, "codigo_numero" character(3) NOT NULL, "simbolo" character varying, "decimales" smallint NOT NULL DEFAULT '0', "separador_decimal" character(1) NOT NULL DEFAULT ',', "separador_miles" character(1) NOT NULL DEFAULT '.', "locale" character varying(10) NOT NULL DEFAULT 'es-CL', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_5d5c781aeb05060eb4fa5695852" UNIQUE ("codigo_iso"), CONSTRAINT "UQ_a995cd6a6fec707bc6e04d3a48c" UNIQUE ("codigo_numero"), CONSTRAINT "chk_moneda_decimales" CHECK ("decimales" BETWEEN 0 AND 4), CONSTRAINT "PK_d0591bea3dd3be77d9594ca80d7" PRIMARY KEY ("moneda_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "unidades_medida" ("unidad_medida_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "codigo" text NOT NULL, "nombre" text NOT NULL, "magnitud" text NOT NULL, "factor_base" numeric(18,6) NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_d97cb04b559197c7009e0f8903c" UNIQUE ("codigo"), CONSTRAINT "PK_69b38b322ff40792597e7be2e45" PRIMARY KEY ("unidad_medida_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "modulos_app" ("modulo_app_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nombre" character varying NOT NULL, "descripcion" character varying, "url" character varying, "icono" character varying, "tiene_configuracion" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_f7a1c08dae6b5bb900ca64c44ff" PRIMARY KEY ("modulo_app_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "permisos" ("permiso_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nombre" character varying NOT NULL, "descripcion" character varying, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_803c761377ec2c03dff9ff01283" PRIMARY KEY ("permiso_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "modulo_app_permisos" ("modulo_app_permiso_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "modulo_app_id" uuid NOT NULL, "permiso_id" uuid NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_99af111fd3edcaaa8be98b64921" PRIMARY KEY ("modulo_app_permiso_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "tenants" ("tenant_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "provincia_id" uuid NOT NULL, "nombre" character varying NOT NULL, "correo" character varying NOT NULL, "telefono" character varying, "direccion" character varying, "calculo_descuentos" character varying NOT NULL DEFAULT 'base', "calculo_recargos" character varying NOT NULL DEFAULT 'base', "escala_calculo" smallint NOT NULL DEFAULT '6', "modo_redondeo" character varying NOT NULL DEFAULT 'HALF_UP', "nivel_redondeo" text NOT NULL DEFAULT 'linea', "monto_tolerancia" numeric(18,6) NOT NULL DEFAULT '0', "facturador" text NOT NULL DEFAULT 'sistema', "arqueo_ciego" boolean NOT NULL DEFAULT false, "promos_acumulan_descuentos" boolean NOT NULL DEFAULT false, "umbral_descuadre_aviso" numeric(18,4) NOT NULL DEFAULT '0', "umbral_descuadre_alto" numeric(18,4) NOT NULL DEFAULT '0', "hora_corte" smallint NOT NULL DEFAULT '0', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_8fd61335a6478f3737d2afa2ac3" UNIQUE ("correo"), CONSTRAINT "chk_tenants_hora_corte" CHECK ("hora_corte" BETWEEN 0 AND 6), CONSTRAINT "chk_tenants_facturador" CHECK ("facturador" IN ('sistema','externo')), CONSTRAINT "chk_tenants_nivel_redondeo" CHECK ("nivel_redondeo" IN ('linea','documento')), CONSTRAINT "PK_2bc5fb666b382723700bb4c1e76" PRIMARY KEY ("tenant_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "usuarios_tenants" ("usuario_id" uuid NOT NULL, "tenant_id" uuid NOT NULL, "es_totem" boolean NOT NULL DEFAULT false, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ca413e0fc517cadd7389bc8e0c5" PRIMARY KEY ("usuario_id", "tenant_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "tenant_modulos" ("modulo_tenant_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "modulo_app_id" uuid NOT NULL, "estado" character varying NOT NULL DEFAULT 'activo', "contratado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "expira_en" TIMESTAMP WITH TIME ZONE, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_3b439d567651bcc02416be8d027" PRIMARY KEY ("modulo_tenant_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "tenant_formula_precio" ("tenant_id" uuid NOT NULL, "paso" smallint NOT NULL, "tipo" character varying NOT NULL, CONSTRAINT "PK_1af54ac9255e79a2e6d3d9f1f93" PRIMARY KEY ("tenant_id", "paso"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "cajas" ("caja_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "usuario_id" uuid, "cajon_id" uuid, "moneda_id" uuid, "tipo" character varying NOT NULL DEFAULT 'virtual', "fecha_apertura" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "fecha_cierre" TIMESTAMP WITH TIME ZONE, "saldo_inicial" numeric(18,4) NOT NULL DEFAULT '0', "saldo_final" numeric(18,4), "monto_contado" numeric(18,4), "diferencia" numeric(18,4), "estado" character varying NOT NULL DEFAULT 'abierta', "comentario" character varying, "comentario_cierre" character varying, "cerrada_por" uuid, "testigos_disponibles" smallint, "nivel_descuadre" character varying NOT NULL DEFAULT 'ninguno', "explicacion_descuadre" text, "revisado_por" uuid, "revisado_el" TIMESTAMP WITH TIME ZONE, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_93c529b461cc0309de634a458c7" PRIMARY KEY ("caja_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_cajas_pendientes_revision" ON "cajas"  ("tenant_id") WHERE nivel_descuadre = 'alto' AND "revisado_el" IS NULL AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_cajas_activa_por_usuario" ON "cajas"  ("tenant_id", "usuario_id") WHERE tipo = 'fisica' AND estado IN ('abierta', 'en_conciliacion') AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_cajas_cajon_abierta" ON "cajas"  ("cajon_id") WHERE estado = 'abierta' AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "caja_testigo" ("caja_testigo_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "caja_id" uuid NOT NULL, "garzon_id" uuid NOT NULL, "sesion_garzon_id" uuid NOT NULL, "solicitada_por" uuid NOT NULL, "estado" text NOT NULL DEFAULT 'pendiente', "comentario_garzon" text, "solicitada_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "resuelta_el" TIMESTAMP WITH TIME ZONE, "resuelta_por_usuario_id" uuid, "via_firma" text, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_caja_testigo_via_firma" CHECK ("via_firma" IN ('cuenta','pin')), CONSTRAINT "chk_caja_testigo_estado" CHECK ("estado" IN ('pendiente','firmada','rechazada','cancelada','caducada')), CONSTRAINT "PK_78150608e1d19818e495fb92218" PRIMARY KEY ("caja_testigo_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_caja_testigo_pendiente" ON "caja_testigo"  ("tenant_id", "garzon_id") WHERE "estado" = 'pendiente' AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_caja_testigo_caja" ON "caja_testigo"  ("caja_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_caja_testigo_caja_garzon" ON "caja_testigo"  ("caja_id", "garzon_id") WHERE "estado" IN ('pendiente','firmada') AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "movimientos_caja" ("movimiento_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "caja_id" uuid NOT NULL, "tipo" character varying NOT NULL, "concepto" character varying NOT NULL, "monto" numeric(18,4) NOT NULL, "referencia" character varying, "fecha" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "venta_id" uuid, "pago_id" uuid, "metodo_pago_id" uuid, "pago_proveedor_id" uuid, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_movimientos_caja_monto_no_negativo" CHECK ("monto" >= 0), CONSTRAINT "PK_2d69f25b03ea075842df40bdac6" PRIMARY KEY ("movimiento_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_movimientos_caja_venta" ON "movimientos_caja"  ("venta_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "caja_arqueo_medio" ("arqueo_medio_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "caja_id" uuid NOT NULL, "tenant_id" uuid NOT NULL, "metodo_pago_id" uuid, "es_efectivo" boolean NOT NULL, "esperado" numeric(18,4) NOT NULL, "contado" numeric(18,4), "diferencia" numeric(18,4), "motivo_diferencia_id" uuid, "comentario_diferencia" text, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_790a106eaf1d9cfd609ba9331dd" PRIMARY KEY ("arqueo_medio_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_caja_arqueo_medio" ON "caja_arqueo_medio"  ("caja_id", "metodo_pago_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "caja_intentos_rechazados" ("intento_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "caja_id" uuid NOT NULL, "usuario_id" uuid NOT NULL, "tipo" character varying NOT NULL, "motivo" character varying NOT NULL, "monto_solicitado" numeric(18,4) NOT NULL, "venta_id" uuid, "fecha" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_152d3728bc3e43fca2ed4e78271" PRIMARY KEY ("intento_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "razones_sociales" ("razon_social_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" character varying(100) NOT NULL, "rut" character varying(50) NOT NULL, "direccion" character varying(255), "telefono" character varying(50), "habilitado" boolean NOT NULL DEFAULT false, "preferida" boolean NOT NULL DEFAULT false, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_91ff2cd8813212489a37fff621b" PRIMARY KEY ("razon_social_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "roles" ("rol_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid, "nombre" character varying NOT NULL, "descripcion" character varying, "es_fijo" boolean NOT NULL DEFAULT false, "es_sistema" boolean NOT NULL DEFAULT false, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_3c527fdab46502238021eab2e22" PRIMARY KEY ("rol_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_roles_sistema_tenant_nombre" ON "roles"  ("tenant_id", "nombre") WHERE es_sistema = true AND eliminado_el IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "roles_usuarios" ("usuario_id" uuid NOT NULL, "tenant_id" uuid NOT NULL, "rol_id" uuid NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_7752318c6ac5bb2c097b3b794e8" PRIMARY KEY ("usuario_id", "tenant_id", "rol_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "modulos_roles" ("rol_id" uuid NOT NULL, "modulo_tenant_id" uuid NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_f6b6a0a9c3c91cf3595ba594ee0" PRIMARY KEY ("rol_id", "modulo_tenant_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "roles_permisos_modulos" ("rol_id" uuid NOT NULL, "modulo_tenant_id" uuid NOT NULL, "modulo_app_permiso_id" uuid NOT NULL, CONSTRAINT "PK_bbc649ed7daec99f45c50571b2e" PRIMARY KEY ("rol_id", "modulo_tenant_id", "modulo_app_permiso_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "tenant_moneda" ("tenant_id" uuid NOT NULL, "moneda_id" uuid NOT NULL, "habilitada" boolean NOT NULL DEFAULT false, "valor_del_dia" numeric(18,6), "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_514c2bde93e67f668f4083b7350" PRIMARY KEY ("tenant_id", "moneda_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "pais_moneda" ("pais_id" uuid NOT NULL, "moneda_id" uuid NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_5c5426df00dc8c79d7231394e60" PRIMARY KEY ("pais_id", "moneda_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "categorias" ("categoria_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" text NOT NULL, "aplica_a" text NOT NULL DEFAULT 'ambos', "impresora_id" uuid, "activo" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "PK_8e798a20548bfd9ef0a92e9bfd9" PRIMARY KEY ("categoria_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "impuestos" ("impuesto_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid, "pais_id" uuid, "tipo" text NOT NULL DEFAULT 'otro', "nombre" text NOT NULL, "porcentaje" numeric(7,4) NOT NULL, "activo" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "CHK_impuestos_scope" CHECK (("tenant_id" IS NULL) <> ("pais_id" IS NULL)), CONSTRAINT "PK_f220c856e41cce294c76ee7df51" PRIMARY KEY ("impuesto_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "tipos_regla" ("tipo_regla_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "clase" text NOT NULL, "codigo" text NOT NULL, "nombre" text NOT NULL, "descripcion" text, "activo" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_cebf9cdc9b3ff93e32625088daf" UNIQUE ("codigo"), CONSTRAINT "PK_947dbadf11cbe9047fc39882e2d" PRIMARY KEY ("tipo_regla_id"))`,
    );
    // Los tres enums de acá los comparten `descuentos` y `recargos` (mismo `enumName`).
    // `migration:generate` los emite una vez por tabla y el segundo `CREATE TYPE`
    // falla: se dejó uno solo de cada uno (y en `down`, el `DROP` que va después de
    // la última tabla que los usa).
    await queryRunner.query(
      `CREATE TYPE "public"."modo_regla" AS ENUM('porcentaje', 'monto_fijo')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."nivel_regla" AS ENUM('linea', 'venta')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."condicion_tipo" AS ENUM('ninguna', 'customer', 'producto', 'categoria', 'fecha', 'metodo_pago', 'vencimiento', 'monto_minimo', 'cantidad_minima')`,
    );
    await queryRunner.query(`CREATE TABLE "descuentos" ("descuento_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" text NOT NULL, "modo" "public"."modo_regla" NOT NULL, "nivel" "public"."nivel_regla" NOT NULL DEFAULT 'linea', "valor_monto" numeric(18,4), "valor_porcentaje" numeric(7,4), "tipo_regla_id" uuid NOT NULL, "condicion_tipo" "public"."condicion_tipo" NOT NULL DEFAULT 'ninguna', "condicion_valor" text, "fecha_inicio" date, "fecha_fin" date, "activo" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "chk_descuentos_valor_segun_modo" CHECK (("modo" = 'monto_fijo' AND "valor_porcentaje" IS NULL)
   OR ("modo" = 'porcentaje' AND "valor_monto" IS NULL)), CONSTRAINT "PK_7be37fd6387e325e6ed58c5b78d" PRIMARY KEY ("descuento_id"))`);
    await queryRunner.query(
      `CREATE TABLE "descuento_tramos" ("descuento_tramo_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "descuento_id" uuid NOT NULL, "minimo_cantidad" numeric(18,4), "minimo_monto" numeric(18,4), "valor_monto" numeric(18,4), "valor_porcentaje" numeric(7,4), "orden" integer NOT NULL DEFAULT '0', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_descuento_tramos_un_minimo" CHECK (("minimo_cantidad" IS NULL) <> ("minimo_monto" IS NULL)), CONSTRAINT "chk_descuento_tramos_una_unidad" CHECK (("valor_monto" IS NULL) <> ("valor_porcentaje" IS NULL)), CONSTRAINT "PK_e2fd46d95e0650b03901c5ba383" PRIMARY KEY ("descuento_tramo_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "descuento_metodo_pago" ("descuento_id" uuid NOT NULL, "metodo_pago_id" uuid NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_5cc2e9c7a64eae278852c933720" PRIMARY KEY ("descuento_id", "metodo_pago_id"))`,
    );
    await queryRunner.query(`CREATE TABLE "recargos" ("recargo_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" text NOT NULL, "modo" "public"."modo_regla" NOT NULL, "nivel" "public"."nivel_regla" NOT NULL DEFAULT 'linea', "valor_monto" numeric(18,4), "valor_porcentaje" numeric(7,4), "tipo_regla_id" uuid NOT NULL, "condicion_tipo" "public"."condicion_tipo" NOT NULL DEFAULT 'ninguna', "condicion_valor" text, "fecha_inicio" date, "fecha_fin" date, "activo" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "chk_recargos_valor_segun_modo" CHECK (("modo" = 'monto_fijo' AND "valor_porcentaje" IS NULL)
   OR ("modo" = 'porcentaje' AND "valor_monto" IS NULL)), CONSTRAINT "PK_3fc0506ee26f6b2315777265d86" PRIMARY KEY ("recargo_id"))`);
    await queryRunner.query(
      `CREATE TABLE "recargo_tramos" ("recargo_tramo_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "recargo_id" uuid NOT NULL, "minimo_cantidad" numeric(18,4), "minimo_monto" numeric(18,4), "valor_monto" numeric(18,4), "valor_porcentaje" numeric(7,4), "orden" integer NOT NULL DEFAULT '0', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_recargo_tramos_un_minimo" CHECK (("minimo_cantidad" IS NULL) <> ("minimo_monto" IS NULL)), CONSTRAINT "chk_recargo_tramos_una_unidad" CHECK (("valor_monto" IS NULL) <> ("valor_porcentaje" IS NULL)), CONSTRAINT "PK_9b0e2f6bfafab269f498f5d8664" PRIMARY KEY ("recargo_tramo_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "recargo_metodo_pago" ("recargo_id" uuid NOT NULL, "metodo_pago_id" uuid NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_1b87626c8aec42eb3a6bf35840c" PRIMARY KEY ("recargo_id", "metodo_pago_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "metodos_pago" ("metodo_pago_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nombre" text NOT NULL, "abreviatura" character varying(5), "es_efectivo" boolean NOT NULL DEFAULT false, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_f1ef3a32ee1ee1ebb6fe182ef59" PRIMARY KEY ("metodo_pago_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "metodo_pago_pais" ("pais_id" uuid NOT NULL, "metodo_pago_id" uuid NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_bb5f5808ced3d5c8f803919b45b" PRIMARY KEY ("pais_id", "metodo_pago_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "tenant_metodo_pago" ("tenant_id" uuid NOT NULL, "metodo_pago_id" uuid NOT NULL, "permite_vuelto" boolean NOT NULL DEFAULT false, "habilitada" boolean NOT NULL DEFAULT false, "requiere_conteo" boolean NOT NULL DEFAULT false, "emisor" text NOT NULL DEFAULT 'sistema', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_tenant_metodo_pago_emisor" CHECK ("emisor" IN ('sistema','maquina','nadie')), CONSTRAINT "PK_8ad26c3e8d5cadce9daa5afa158" PRIMARY KEY ("tenant_id", "metodo_pago_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "items" ("item_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "moneda_id" uuid NOT NULL, "categoria_id" uuid, "nombre" text NOT NULL, "descripcion" text, "precio_base" numeric(18,4) NOT NULL, "precio_incluye_impuesto" boolean NOT NULL DEFAULT false, "activo" boolean NOT NULL DEFAULT true, "tipo" text NOT NULL, "clasificacion_tributaria" text DEFAULT 'afecto', "es_ajuste_nota_credito" boolean NOT NULL DEFAULT false, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "PK_d0249fbc104e3bd71b5a0ecf3b1" PRIMARY KEY ("item_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_items_tenant_tipo_vivo" ON "items"  ("tenant_id", "tipo") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_item_ajuste_nc_tenant" ON "items"  ("tenant_id") WHERE "es_ajuste_nota_credito" = true AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "item_producto" ("item_id" uuid NOT NULL, "costo_actual" numeric(18,4), "unidad_medida" text NOT NULL, "fecha_elaboracion" TIMESTAMP WITH TIME ZONE, "fecha_vencimiento" TIMESTAMP WITH TIME ZONE, "modo_inventario" text NOT NULL DEFAULT 'cantidad', CONSTRAINT "PK_038acb985586abd42da020402c8" PRIMARY KEY ("item_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "item_servicio" ("item_id" uuid NOT NULL, "duracion_estimada" integer, "requiere_cita" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_d5932316046b398af1f7fe83ff1" PRIMARY KEY ("item_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "item_suscripcion" ("item_id" uuid NOT NULL, "frecuencia" text NOT NULL, CONSTRAINT "PK_9d7174e62feba1674330cd90610" PRIMARY KEY ("item_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "item_receta" ("item_id" uuid NOT NULL, "costo_actual" numeric(18,4), "costo_propuesto_omitido" numeric(18,4), CONSTRAINT "PK_e943d9fa13a9e1eeef36d1c76fc" PRIMARY KEY ("item_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "receta_ingredientes" ("receta_ingrediente_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "receta_item_id" uuid NOT NULL, "ingrediente_item_id" uuid NOT NULL, "cantidad" numeric(18,4) NOT NULL, "unidad_codigo" text NOT NULL, "bloqueante" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_c66d445c010cd9866e2b2ab22a1" PRIMARY KEY ("receta_ingrediente_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_receta_ingrediente_vivo" ON "receta_ingredientes"  ("receta_item_id", "ingrediente_item_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "receta_extras_permitidos" ("receta_extra_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "receta_item_id" uuid NOT NULL, "ingrediente_item_id" uuid NOT NULL, "cantidad" numeric(18,4) NOT NULL, "unidad_codigo" text NOT NULL, "precio_extra" numeric(18,4) NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ebedb5ac553cf73c60037a28aad" PRIMARY KEY ("receta_extra_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_receta_extra_vivo" ON "receta_extras_permitidos"  ("receta_item_id", "ingrediente_item_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "item_impuestos" ("item_id" uuid NOT NULL, "impuesto_id" uuid NOT NULL, CONSTRAINT "PK_f9bd4325bd79f557f3d2c633619" PRIMARY KEY ("item_id", "impuesto_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "item_recargos" ("item_id" uuid NOT NULL, "recargo_id" uuid NOT NULL, CONSTRAINT "PK_db4462d6bbe039f1b30fe9a2109" PRIMARY KEY ("item_id", "recargo_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "item_descuentos" ("item_id" uuid NOT NULL, "descuento_id" uuid NOT NULL, CONSTRAINT "PK_90293a78c8b874bceea5bf8fd88" PRIMARY KEY ("item_id", "descuento_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "item_lote" ("lote_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "item_id" uuid NOT NULL, "codigo_lote" text NOT NULL, "fecha_elaboracion" TIMESTAMP WITH TIME ZONE, "fecha_vencimiento" TIMESTAMP WITH TIME ZONE, "cantidad_inicial" numeric(18,4) NOT NULL DEFAULT '0', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ba7889bae30e4692814229a3482" PRIMARY KEY ("lote_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_lote_item_codigo" ON "item_lote"  ("item_id", "codigo_lote") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "item_unidad" ("unidad_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "item_id" uuid NOT NULL, "lote_id" uuid, "serie" text NOT NULL, "estado" text NOT NULL DEFAULT 'disponible', "condicion" text NOT NULL DEFAULT 'nuevo', "garantia_hasta" TIMESTAMP WITH TIME ZONE, "venta_id" uuid, "ubicacion_id" uuid NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_71bc157bee608861432ea30731f" PRIMARY KEY ("unidad_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "item_combo" ("item_id" uuid NOT NULL, "costo_actual" numeric(18,4), "costo_propuesto_omitido" numeric(18,4), CONSTRAINT "PK_ba2bf9963951c9355720b46384c" PRIMARY KEY ("item_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "combo_componentes" ("combo_componente_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "combo_item_id" uuid NOT NULL, "componente_item_id" uuid NOT NULL, "cantidad" numeric(18,4) NOT NULL, "bloqueante" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "actualizado_el" TIMESTAMP WITH TIME ZONE, "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_8ca8754f9b8485c268040f0537b" PRIMARY KEY ("combo_componente_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_combo_componente_vivo" ON "combo_componentes"  ("combo_item_id", "componente_item_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "item_grupos_modificadores" ("item_grupo_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "item_id" uuid NOT NULL, "grupo_modificador_id" uuid NOT NULL, "min" integer NOT NULL DEFAULT '1', "max" integer NOT NULL, "orden" integer NOT NULL DEFAULT '0', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "actualizado_el" TIMESTAMP WITH TIME ZONE, "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_0994f05453166507fb12dc47071" PRIMARY KEY ("item_grupo_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_item_grupo_vivo" ON "item_grupos_modificadores"  ("item_id", "grupo_modificador_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "item_grupo_modificador_opciones" ("item_grupo_opcion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "item_grupo_id" uuid NOT NULL, "grupo_opcion_id" uuid NOT NULL, "cantidad" numeric(18,4), "unidad_codigo" text, "precio_extra" numeric(18,4), "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "actualizado_el" TIMESTAMP WITH TIME ZONE, "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_8fe74fab024a0b55771d9ed86c0" PRIMARY KEY ("item_grupo_opcion_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_item_grupo_opcion_vivo" ON "item_grupo_modificador_opciones"  ("item_grupo_id", "grupo_opcion_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "movimientos_inventario" ("movimiento_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "item_id" uuid NOT NULL, "ubicacion_id" uuid NOT NULL, "tipo" text NOT NULL, "motivo" text NOT NULL, "cantidad" numeric(18,4) NOT NULL, "stock_anterior" numeric(18,4) NOT NULL, "stock_resultante" numeric(18,4) NOT NULL, "venta_id" uuid, "venta_detalle_id" uuid, "usuario_id" uuid, "comentario" text, "costo_unitario" numeric(18,4), "costo_anterior" numeric(18,4), "costo_informado" boolean NOT NULL DEFAULT false, "motivo_baja_id" uuid, "cuenta_linea_anulacion_id" uuid, "motivo_diferencia_id" uuid, "traslado_id" uuid, "compra_linea_id" uuid, "secuencia" BIGSERIAL NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_cda1bfd9c75e5a92010a33bfd55" PRIMARY KEY ("movimiento_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_movimientos_inventario_item_ubicacion_secuencia" ON "movimientos_inventario"  ("item_id", "ubicacion_id", "secuencia") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_movimientos_inventario_item_secuencia" ON "movimientos_inventario"  ("item_id", "secuencia") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_movimientos_inventario_compra_linea" ON "movimientos_inventario"  ("compra_linea_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_movimientos_inventario_traslado" ON "movimientos_inventario"  ("traslado_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_movimientos_inventario_venta" ON "movimientos_inventario"  ("venta_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "movimiento_inventario_detalle" ("detalle_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "movimiento_id" uuid NOT NULL, "unidad_id" uuid, "lote_id" uuid, "cantidad" numeric(18,4) NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_03c7f7914cae786f3f28954787a" PRIMARY KEY ("detalle_id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tipo_motivo_baja" AS ENUM('merma', 'cortesia', 'no_elaborado', 'consumo_personal')`,
    );
    await queryRunner.query(
      `CREATE TABLE "motivo_baja" ("motivo_baja_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" text NOT NULL, "activo" boolean NOT NULL DEFAULT true, "es_fijo" boolean NOT NULL DEFAULT false, "tipo" "public"."tipo_motivo_baja" NOT NULL, "es_devolucion" boolean NOT NULL DEFAULT false, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "PK_765712985bf97cc8a2272bca75b" PRIMARY KEY ("motivo_baja_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_motivo_baja_devolucion_tenant" ON "motivo_baja"  ("tenant_id") WHERE es_devolucion AND eliminado_el IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "motivo_diferencia_caja" ("motivo_diferencia_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" text NOT NULL, "activo" boolean NOT NULL DEFAULT true, "requiere_comentario" boolean NOT NULL DEFAULT false, "es_fijo" boolean NOT NULL DEFAULT false, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "PK_470a5a857c70b467c138e895310" PRIMARY KEY ("motivo_diferencia_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "cajones" ("cajon_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" text NOT NULL, "activo" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "PK_b0a108d64cd5c7d8e6e9b35e7f4" PRIMARY KEY ("cajon_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "cajon_usuario" ("cajon_usuario_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "cajon_id" uuid NOT NULL, "usuario_id" uuid NOT NULL, "tenant_id" uuid NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_3b7753f70589434c5c66465f5fd" PRIMARY KEY ("cajon_usuario_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_cajon_usuario_cajon_usuario" ON "cajon_usuario"  ("cajon_id", "usuario_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ventas_estado_enum" AS ENUM('pendiente', 'pagada_parcial', 'pagada', 'cancelada')`,
    );
    await queryRunner.query(
      `CREATE TABLE "ventas" ("venta_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "caja_id" uuid, "moneda_id" uuid NOT NULL, "tipo_documento_id" uuid, "canal" text NOT NULL DEFAULT 'fisico', "fecha" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "estado" "public"."ventas_estado_enum" NOT NULL DEFAULT 'pendiente', "total_bruto" numeric(18,4) NOT NULL DEFAULT '0', "total_descuentos" numeric(18,4) NOT NULL DEFAULT '0', "total_recargos" numeric(18,4) NOT NULL DEFAULT '0', "total_impuestos" numeric(18,4) NOT NULL DEFAULT '0', "total_final" numeric(18,4) NOT NULL DEFAULT '0', "base_ventas_total_final" numeric(18,4) NOT NULL DEFAULT '0', "base_ventas_sin_impuestos" numeric(18,4) NOT NULL DEFAULT '0', "venta_referencia_id" uuid, "devolucion_via" text, "devolucion_pago_id" uuid, "receptor_es_emisor" boolean NOT NULL DEFAULT false, "comentario" text, "config_calculo" jsonb, "devoluciones" jsonb, "cancelada_el" TIMESTAMP WITH TIME ZONE, "cancelada_por_usuario_id" uuid, "motivo_cancelacion" text, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_ventas_receptor_es_emisor" CHECK (NOT "receptor_es_emisor" OR "venta_referencia_id" IS NOT NULL), CONSTRAINT "chk_ventas_devolucion_via" CHECK ("devolucion_via" IN ('pago','sin_plata','pasarela')), CONSTRAINT "PK_f72d6bcf936480f53792d2d8a0f" PRIMARY KEY ("venta_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ventas_venta_referencia" ON "ventas"  ("venta_referencia_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "venta_detalles" ("detalle_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "venta_id" uuid NOT NULL, "item_id" uuid NOT NULL, "moneda_id_origen" uuid NOT NULL, "precio_unitario_origen" numeric(18,4), "tasa_cambio" numeric(18,6), "precio_unitario" numeric(18,4) NOT NULL, "descripcion" text, "clasificacion_tributaria" text NOT NULL DEFAULT 'afecto', "cantidad" numeric(18,4) NOT NULL, "cantidad_presentacion" numeric(18,4), "unidad_codigo_presentacion" text, "unidad_codigo_base" text NOT NULL, "subtotal" numeric(18,4) NOT NULL DEFAULT '0', "descuento_aplicado" numeric(18,4) NOT NULL DEFAULT '0', "recargo_aplicado" numeric(18,4) NOT NULL DEFAULT '0', "ajuste_venta" numeric(18,4) NOT NULL DEFAULT '0', "impuesto_aplicado" numeric(18,4) NOT NULL DEFAULT '0', "total_linea" numeric(18,4) NOT NULL DEFAULT '0', "personalizacion" jsonb, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_d7f4a92303329fcc5171796c2f8" PRIMARY KEY ("detalle_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_venta_detalles_venta" ON "venta_detalles"  ("venta_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ventas_descuentos" ("venta_descuento_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "venta_id" uuid NOT NULL, "descuento_id" uuid NOT NULL, "detalle_id" uuid, "nombre_regla" text NOT NULL, "modo" text NOT NULL, "valor_aplicado" numeric(18,4) NOT NULL, "valor_solicitado" numeric(18,4) NOT NULL, "porcentaje_aplicado" numeric(7,4), "aplicado_en" text NOT NULL DEFAULT 'venta', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_b6412adaac36043b352318719d4" PRIMARY KEY ("venta_descuento_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ventas_descuentos_venta" ON "ventas_descuentos"  ("venta_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ventas_recargos" ("venta_recargo_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "venta_id" uuid NOT NULL, "recargo_id" uuid NOT NULL, "detalle_id" uuid, "nombre_regla" text NOT NULL, "modo" text NOT NULL, "valor_aplicado" numeric(18,4) NOT NULL, "porcentaje_aplicado" numeric(7,4), "aplicado_en" text NOT NULL DEFAULT 'venta', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_2d2b41cda034f397a6804a5752a" PRIMARY KEY ("venta_recargo_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ventas_recargos_venta" ON "ventas_recargos"  ("venta_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ventas_impuestos" ("venta_impuesto_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "venta_id" uuid NOT NULL, "impuesto_id" uuid NOT NULL, "detalle_id" uuid, "nombre_regla" text NOT NULL, "valor_aplicado" numeric(18,4) NOT NULL, "porcentaje_aplicado" numeric(7,4), "aplicado_en" text NOT NULL DEFAULT 'venta', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_236b20e4fc355a33fe2ededa09b" PRIMARY KEY ("venta_impuesto_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ventas_impuestos_venta" ON "ventas_impuestos"  ("venta_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "venta_customer" ("customer_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "venta_id" uuid NOT NULL, "tercero_id" uuid, "nombre" text NOT NULL, "rut" text, "direccion" text, "giro" character varying(40), "comuna" character varying(20), "telefono" text, "email" text, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_6e4ef9abe0e68a2a6d55f001bb5" PRIMARY KEY ("customer_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_venta_customer_venta" ON "venta_customer"  ("venta_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "venta_documentos" ("documento_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "venta_id" uuid NOT NULL, "emisor" text NOT NULL, "tipo_documento_id" uuid, "clase_maquina" text, "numero" text, "estado_envio" text, "monto" numeric(18,4) NOT NULL, "monto_afecto" numeric(18,4), "monto_exento" numeric(18,4), "monto_impuestos" numeric(18,4), "pago_id" uuid, "documento_corregido_id" uuid, "es_duplicado" boolean NOT NULL DEFAULT false, "descarte" text, "descartado_el" TIMESTAMP WITH TIME ZONE, "descartado_por_usuario_id" uuid, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_venta_documentos_descarte" CHECK ("descarte" IN ('armado_sin_enviar','afirmado_no_hecho')), CONSTRAINT "chk_venta_documentos_estado_envio" CHECK ("estado_envio" IN ('armado','enviado')), CONSTRAINT "chk_venta_documentos_clase_maquina" CHECK ("clase_maquina" IN ('voucher','boleta')), CONSTRAINT "chk_venta_documentos_emisor" CHECK ("emisor" IN ('sistema','maquina','nadie','externo')), CONSTRAINT "PK_911b23b65194e1e0c1f19f8d748" PRIMARY KEY ("documento_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_venta_documentos_corregido" ON "venta_documentos"  ("documento_corregido_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_venta_documentos_venta" ON "venta_documentos"  ("venta_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "venta_documento_numero_borrados" ("numero_borrado_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "documento_id" uuid NOT NULL, "numero_anterior" text NOT NULL, "usuario_id" uuid NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_6ab6b4be1ea4706c28f35861fd3" PRIMARY KEY ("numero_borrado_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_venta_documento_numero_borrados_documento" ON "venta_documento_numero_borrados"  ("tenant_id", "documento_id", "creado_el") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pagos" ("pago_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "venta_id" uuid NOT NULL, "metodo_pago_id" uuid NOT NULL, "documento_id" uuid, "moneda_oficial_id" uuid NOT NULL, "caja_id" uuid, "monto" numeric(18,4) NOT NULL, "vuelto" numeric(18,4) NOT NULL DEFAULT '0', "fecha" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "referencia" text, "numero_cuotas" integer, "tipo_pago" character varying, "tarjeta_ultimos4" character varying(4), "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_0bd46d1b7c0f951e47b39600dd2" PRIMARY KEY ("pago_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pagos_documento" ON "pagos"  ("documento_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pagos_venta" ON "pagos"  ("venta_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pago_aplicaciones" ("pago_aplicacion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "pago_id" uuid NOT NULL, "tipo" text NOT NULL, "referencia_id" uuid, "monto" numeric(18,4) NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_cba8460727470e31e11edda78d1" PRIMARY KEY ("pago_aplicacion_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pago_aplicaciones_ref" ON "pago_aplicaciones"  ("tenant_id", "tipo", "referencia_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pago_aplicaciones_pago" ON "pago_aplicaciones"  ("pago_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "venta_propina" ("venta_propina_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "venta_id" uuid NOT NULL, "garzon_id" uuid NOT NULL, "porcentaje_sugerido" numeric(10,6) NOT NULL, "monto_sugerido" numeric(18,4) NOT NULL, "monto_pagado" numeric(18,4) NOT NULL, "tipo" text NOT NULL, "estado" text NOT NULL, "sesion_garzon_id" uuid, "turno_id" uuid, "tipo_garzon" text, "liquidacion_id" uuid, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_6b441bffb7854711f43869bc99f" PRIMARY KEY ("venta_propina_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_venta_propina_garzon" ON "venta_propina"  ("tenant_id", "garzon_id", "creado_el") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_venta_propina_venta" ON "venta_propina"  ("venta_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "propina_configuracion" ("propina_configuracion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "version" integer NOT NULL DEFAULT '1', "porcentaje_sugerido" numeric(10,6) NOT NULL DEFAULT 0.10, "habilitado_pos" boolean NOT NULL DEFAULT true, "habilitado_salones" boolean NOT NULL DEFAULT true, "actualizado_por" uuid, "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_9d86120000cd9c8b59c9f5de367" PRIMARY KEY ("propina_configuracion_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_propina_config_tenant" ON "propina_configuracion"  ("tenant_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "propina_grupo_distribucion" ("propina_grupo_distribucion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "configuracion_id" uuid NOT NULL, "tipo_garzon" text NOT NULL, "nombre" text NOT NULL, "porcentaje" numeric(10,6) NOT NULL, "criterio" text NOT NULL, "base_ventas" text NOT NULL DEFAULT 'TOTAL_FINAL', "manual_modo" text, "activo" boolean NOT NULL DEFAULT true, "orden" integer NOT NULL DEFAULT '0', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_2f912cbbda236bf643a6797b3ba" PRIMARY KEY ("propina_grupo_distribucion_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_propina_grupo_tipo_activo" ON "propina_grupo_distribucion"  ("tenant_id", "tipo_garzon") WHERE "activo" = true AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "propina_grupo_peso_manual" ("propina_grupo_peso_manual_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "grupo_id" uuid NOT NULL, "garzon_id" uuid NOT NULL, "peso" numeric(18,4) NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_0cf1ab6c5230a938d1e7c6dadf8" PRIMARY KEY ("propina_grupo_peso_manual_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_propina_peso_grupo_garzon" ON "propina_grupo_peso_manual"  ("grupo_id", "garzon_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "liquidacion_propinas" ("liquidacion_propinas_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "fecha_desde" TIMESTAMP WITH TIME ZONE NOT NULL, "fecha_hasta" TIMESTAMP WITH TIME ZONE NOT NULL, "turno_ids" uuid array NOT NULL DEFAULT '{}', "estado" text NOT NULL DEFAULT 'borrador', "pool_total" numeric(18,4) NOT NULL DEFAULT '0', "configuracion_version" integer NOT NULL, "moneda_id" uuid NOT NULL, "decimales_moneda" smallint NOT NULL, "creado_por" uuid NOT NULL, "confirmado_por" uuid, "confirmado_el" TIMESTAMP WITH TIME ZONE, "anulado_por" uuid, "anulado_el" TIMESTAMP WITH TIME ZONE, "motivo_anulacion" text, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a74b28022308967a1ebbef1ba80" PRIMARY KEY ("liquidacion_propinas_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_liquidacion_propinas_tenant_estado" ON "liquidacion_propinas"  ("tenant_id", "estado", "creado_el") `,
    );
    await queryRunner.query(
      `CREATE TABLE "liquidacion_propinas_grupo" ("liquidacion_propinas_grupo_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "liquidacion_id" uuid NOT NULL, "tipo_garzon" text NOT NULL, "nombre" text NOT NULL, "porcentaje" numeric(10,6) NOT NULL, "criterio" text NOT NULL, "base_ventas" text NOT NULL DEFAULT 'TOTAL_FINAL', "manual_modo" text, "monto_grupo" numeric(18,4) NOT NULL DEFAULT '0', "orden" integer NOT NULL DEFAULT '0', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_44c2e6c8e21f7fd6b63f8eabb1e" PRIMARY KEY ("liquidacion_propinas_grupo_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_liquidacion_propinas_grupo_liquidacion" ON "liquidacion_propinas_grupo"  ("liquidacion_id", "orden") `,
    );
    await queryRunner.query(
      `CREATE TABLE "liquidacion_propinas_participante" ("liquidacion_propinas_participante_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "liquidacion_id" uuid NOT NULL, "grupo_id" uuid NOT NULL, "garzon_id" uuid NOT NULL, "tipo_garzon" text NOT NULL, "incluido" boolean NOT NULL DEFAULT true, "origen" text NOT NULL, "motivo_ajuste" text, "horas" numeric(18,4) NOT NULL DEFAULT '0', "ventas_base" numeric(18,4) NOT NULL DEFAULT '0', "cuentas" numeric(18,4) NOT NULL DEFAULT '0', "peso_manual" numeric(18,4), "monto" numeric(18,4) NOT NULL DEFAULT '0', "ajuste_motivo_monto" text, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_238a0aefc79b0589273f5248a6f" PRIMARY KEY ("liquidacion_propinas_participante_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_liquidacion_propinas_participante_garzon" ON "liquidacion_propinas_participante"  ("liquidacion_id", "garzon_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_liquidacion_propinas_participante_liquidacion" ON "liquidacion_propinas_participante"  ("liquidacion_id", "grupo_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "liquidacion_propinas_fuente" ("liquidacion_propinas_fuente_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "liquidacion_id" uuid NOT NULL, "venta_propina_id" uuid NOT NULL, "monto_pagado" numeric(18,4) NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_287f7adb22608b39f92d2853b33" PRIMARY KEY ("liquidacion_propinas_fuente_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_liquidacion_propinas_fuente_propina" ON "liquidacion_propinas_fuente"  ("liquidacion_id", "venta_propina_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "liquidacion_propinas_evento" ("liquidacion_propinas_evento_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "liquidacion_id" uuid NOT NULL, "tipo" text NOT NULL, "payload" jsonb NOT NULL DEFAULT '{}', "usuario_id" uuid NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_328424588cbd4e385e1ac43fe38" PRIMARY KEY ("liquidacion_propinas_evento_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_liquidacion_propinas_evento_liquidacion" ON "liquidacion_propinas_evento"  ("liquidacion_id", "creado_el") `,
    );
    await queryRunner.query(
      `CREATE TABLE "tipos_documento_tributario" ("tipo_documento_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "pais_id" uuid NOT NULL, "nombre" character varying(100) NOT NULL, "codigo" character varying(20), "descripcion" text, "activo" boolean NOT NULL DEFAULT true, "customer_requerido" boolean NOT NULL DEFAULT false, "es_nota_credito" boolean NOT NULL DEFAULT false, "es_boleta" boolean NOT NULL DEFAULT false, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_e6db0fbaf0bd80cb78108a0619d" PRIMARY KEY ("tipo_documento_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_tipo_documento_boleta_pais" ON "tipos_documento_tributario"  ("pais_id") WHERE "es_boleta" = true AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_tipo_documento_nota_credito_pais" ON "tipos_documento_tributario"  ("pais_id") WHERE "es_nota_credito" = true AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "umbral_identidad_pagador" ("umbral_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "pais_id" uuid NOT NULL, "anio" integer NOT NULL, "monto" numeric(18,2) NOT NULL, "fuente" text NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_umbral_identidad_pagador_monto" CHECK ("monto" > 0), CONSTRAINT "PK_df208bc94b3486ca95bfb47bde2" PRIMARY KEY ("umbral_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_umbral_identidad_pagador_pais_anio" ON "umbral_identidad_pagador"  ("pais_id", "anio") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "terceros" ("tercero_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "tipo" text NOT NULL, "nombre" character varying(100) NOT NULL, "rut" character varying(50), "nombre_legal" character varying(100), "rut_fiscal" character varying(50), "correo" character varying(100), "telefono" character varying(50), "direccion" text, "giro" character varying(40), "comuna" character varying(20), "activo" boolean NOT NULL DEFAULT true, "plazo_pago_dias" integer, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "chk_terceros_plazo_pago_positivo" CHECK ("plazo_pago_dias" IS NULL OR "plazo_pago_dias" > 0), CONSTRAINT "PK_c3ce99d72ff588d5395e9c8c773" PRIMARY KEY ("tercero_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "suscripciones" ("suscripcion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "usuario_id" uuid NOT NULL, "item_id" uuid NOT NULL, "frecuencia" text NOT NULL, "dia_mes" smallint, "dia_semana" smallint, "estado" text NOT NULL DEFAULT 'activa', "proximo_cobro" date NOT NULL, "activa_hasta" date, "inscripcion_id" uuid, "tarjeta_marca" text, "tarjeta_last4" text, "venta_inicial_id" uuid, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_2c3371b2d98abb63a859b8678b8" PRIMARY KEY ("suscripcion_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "pasarelas" ("pasarela_id" uuid NOT NULL, "codigo" character varying NOT NULL, "nombre" character varying NOT NULL, "soporta_tokenizacion" boolean NOT NULL DEFAULT false, "soporta_cobro_recurrente" boolean NOT NULL DEFAULT false, "soporta_mall" boolean NOT NULL DEFAULT false, "url_produccion" character varying NOT NULL, "url_pruebas" character varying NOT NULL, "configuracion_produccion" text, "configuracion_pruebas" text, "activo" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_e15758f1238fb68bf5eabd2041a" UNIQUE ("codigo"), CONSTRAINT "PK_e3a4dd1d47961f90384d9eb70f6" PRIMARY KEY ("pasarela_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "tenant_pasarela" ("tenant_pasarela_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "pasarela_id" uuid NOT NULL, "ambiente" character varying NOT NULL, "modo_integracion" character varying NOT NULL, "configuracion" text, "activo" boolean NOT NULL DEFAULT true, "prioridad" integer NOT NULL DEFAULT '1', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_27544994e87714a095a49caf907" PRIMARY KEY ("tenant_pasarela_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "pasarela_api_keys" ("api_key_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" character varying NOT NULL, "prefijo" character varying NOT NULL, "key_hash" character varying NOT NULL, "ultimo_uso_el" TIMESTAMP WITH TIME ZONE, "revocada_el" TIMESTAMP WITH TIME ZONE, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_39a93d83871ea61cc9b67a8406f" PRIMARY KEY ("api_key_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7111d1c304afd52b3d359a1e82" ON "pasarela_api_keys"  ("key_hash") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pasarela_inscripciones" ("inscripcion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "tenant_pasarela_id" uuid NOT NULL, "pagador_ref" character varying(100) NOT NULL, "identificador_externo" text, "identificador_usuario_externo" character varying NOT NULL, "estado" character varying NOT NULL DEFAULT 'pendiente', "preferida" boolean NOT NULL DEFAULT false, "token_proveedor" character varying, "url_retorno_app" character varying NOT NULL, "metadata" jsonb NOT NULL DEFAULT '{}', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_0681b1642fcc519fe0849e878f5" PRIMARY KEY ("inscripcion_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_308c146cdf4b17c7a9ec224cfb" ON "pasarela_inscripciones"  ("token_proveedor") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2344f48809ebb3cba67ee19d26" ON "pasarela_inscripciones"  ("tenant_id", "pagador_ref") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pasarela_medios_pago" ("medio_pago_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "inscripcion_id" uuid NOT NULL, "tipo" character varying NOT NULL, "marca" character varying, "ultimos_4" character varying(4) NOT NULL, "fecha_expiracion" character varying, "token_externo" text, "estado" character varying NOT NULL DEFAULT 'activo', "metadata" jsonb NOT NULL DEFAULT '{}', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_1bb04adea381573952fb53fdf85" PRIMARY KEY ("medio_pago_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "pasarela_ordenes" ("orden_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "pagador_ref" character varying(100), "referencia_externa" character varying, "venta_id" uuid, "codigo_orden" character varying NOT NULL, "descripcion" character varying NOT NULL, "monto" numeric(18,6) NOT NULL, "moneda" character varying(3) NOT NULL, "estado" character varying NOT NULL DEFAULT 'creada', "fecha_expiracion" TIMESTAMP WITH TIME ZONE, "token_proveedor" character varying, "origen" character varying NOT NULL, "api_key_id" uuid, "solicitud_idempotente_id" uuid, "motivo_sin_venta" text, "metadata" jsonb NOT NULL DEFAULT '{}', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_984bd8ba4080196f3b4525fac91" PRIMARY KEY ("orden_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e0ac38e16251ce754e09d8d3b4" ON "pasarela_ordenes"  ("venta_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_33e1cef74a3641a41657fc497d" ON "pasarela_ordenes"  ("codigo_orden") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7a2e100191443c59f6bb2c18ad" ON "pasarela_ordenes"  ("token_proveedor") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_196850352badd2e06061fde136" ON "pasarela_ordenes"  ("solicitud_idempotente_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pasarela_transacciones" ("transaccion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "orden_id" uuid, "tenant_pasarela_id" uuid NOT NULL, "inscripcion_id" uuid, "medio_pago_id" uuid, "transaccion_padre_id" uuid, "correccion_venta_id" uuid, "solicitud_idempotente_id" uuid, "usuario_id" uuid, "api_key_id" uuid, "resolucion" character varying, "resuelta_por" uuid, "resuelta_el" TIMESTAMP WITH TIME ZONE, "tipo" character varying NOT NULL, "estado" character varying NOT NULL, "monto" numeric(18,6), "moneda" character varying(3), "codigo_orden" character varying, "codigo_autorizacion" character varying, "identificador_transaccion_externo" character varying, "codigo_respuesta" character varying, "tipo_pago" character varying, "numero_cuotas" integer, "monto_cuota" numeric(18,6), "request" jsonb NOT NULL DEFAULT '{}', "response" jsonb NOT NULL DEFAULT '{}', "metadata" jsonb NOT NULL DEFAULT '{}', "fecha_transaccion" TIMESTAMP WITH TIME ZONE NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_pasarela_transacciones_quien_pidio" CHECK ("solicitud_idempotente_id" IS NULL OR (("usuario_id" IS NULL) <> ("api_key_id" IS NULL))), CONSTRAINT "PK_bf5756b14684fac36df1a3eaa59" PRIMARY KEY ("transaccion_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_705b8606312fd125e2a9a544c9" ON "pasarela_transacciones"  ("orden_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a0d54be996a40e9bc6743a87f8" ON "pasarela_transacciones"  ("tenant_pasarela_id", "identificador_transaccion_externo") WHERE "identificador_transaccion_externo" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "cron_ejecuciones" ("ejecucion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "job" character varying NOT NULL, "iniciado_el" TIMESTAMP WITH TIME ZONE NOT NULL, "finalizado_el" TIMESTAMP WITH TIME ZONE, "estado" character varying NOT NULL DEFAULT 'en_curso', "detalle" text, "error" text, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_35d5e19e2cfcda28ad13610b6fc" PRIMARY KEY ("ejecucion_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db67a62a358c2c8ee97ab954a6" ON "cron_ejecuciones"  ("job") `,
    );
    await queryRunner.query(
      `CREATE TABLE "salones" ("salon_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" text NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "PK_504d084d2077b7f6b7283fa91f5" PRIMARY KEY ("salon_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "mesas" ("mesa_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "salon_id" uuid NOT NULL, "nombre" text NOT NULL, "pos_x" numeric(6,5) NOT NULL DEFAULT '0', "pos_y" numeric(6,5) NOT NULL DEFAULT '0', "forma" text NOT NULL DEFAULT 'cuadrada', "tamano" text NOT NULL DEFAULT 'mediano', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "PK_7b556f1f2ffd9a64061fe39ae6a" PRIMARY KEY ("mesa_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "cuentas" ("cuenta_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "mesa_id" uuid NOT NULL, "numero" integer NOT NULL, "nombre" text, "estado" text NOT NULL DEFAULT 'abierta', "venta_id" uuid, "garzon_apertura_id" uuid, "garzon_responsable_id" uuid, "garzon_cierre_id" uuid, "abierta_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "cerrada_el" TIMESTAMP WITH TIME ZONE, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_57e16790555a1394280c087d491" PRIMARY KEY ("cuenta_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cuentas_cerrada" ON "cuentas"  ("tenant_id", "cerrada_el") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cuentas_estado" ON "cuentas"  ("tenant_id", "estado") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cuentas_responsable" ON "cuentas"  ("tenant_id", "garzon_responsable_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cuentas_venta" ON "cuentas"  ("tenant_id", "venta_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "cuenta_lineas" ("cuenta_linea_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "cuenta_id" uuid NOT NULL, "item_id" uuid NOT NULL, "cantidad" numeric(18,4) NOT NULL, "cantidad_presentacion" numeric(18,4), "unidad_codigo_presentacion" text, "cantidad_enviada" numeric(18,4) NOT NULL DEFAULT '0', "personalizacion" jsonb, "unidad_ids" uuid array NOT NULL DEFAULT '{}', "precio_unitario" numeric(18,4) NOT NULL, "precio_unitario_origen" numeric(18,4) NOT NULL, "tasa_cambio" numeric(18,6) NOT NULL, "reglas_congeladas" jsonb NOT NULL, "consumo_congelado" jsonb, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_8e1bd4d974694cebc0d6d563b32" PRIMARY KEY ("cuenta_linea_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cuenta_lineas_cuenta" ON "cuenta_lineas"  ("tenant_id", "cuenta_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cuenta_lineas_item" ON "cuenta_lineas"  ("item_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cuenta_lineas_personalizacion" ON "cuenta_lineas" USING gin ("personalizacion") `,
    );
    await queryRunner.query(
      `CREATE TABLE "cuenta_linea_anulaciones" ("cuenta_linea_anulacion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "cuenta_id" uuid NOT NULL, "cuenta_linea_id" uuid NOT NULL, "item_id" uuid NOT NULL, "item_nombre" text NOT NULL, "precio_unitario" numeric(18,4) NOT NULL, "cantidad" numeric(18,4) NOT NULL, "motivo_baja_id" uuid NOT NULL, "autorizado_por" uuid NOT NULL, "garzon_id" uuid, "monto_afecto" numeric(18,4), "monto_exento" numeric(18,4), "monto_impuestos" numeric(18,4), "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_cuenta_linea_anulaciones_baldes_juntos" CHECK (("monto_afecto" IS NULL) = ("monto_exento" IS NULL) AND ("monto_afecto" IS NULL) = ("monto_impuestos" IS NULL)), CONSTRAINT "PK_76fc45a15aedccd46db22bf86e4" PRIMARY KEY ("cuenta_linea_anulacion_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cuenta_linea_anulaciones_cuenta" ON "cuenta_linea_anulaciones"  ("tenant_id", "cuenta_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "cuenta_linea_reparto" ("cuenta_linea_reparto_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "cuenta_linea_id" uuid NOT NULL, "garzon_id" uuid, "cantidad" numeric(18,4) NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_d4861e6ae9032784656471ef4c4" PRIMARY KEY ("cuenta_linea_reparto_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_cuenta_linea_reparto_garzon" ON "cuenta_linea_reparto"  ("cuenta_linea_id", "garzon_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "cuenta_asignaciones" ("cuenta_asignacion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "cuenta_id" uuid NOT NULL, "garzon_id" uuid NOT NULL, "desde_el" TIMESTAMP WITH TIME ZONE NOT NULL, "hasta_el" TIMESTAMP WITH TIME ZONE, "motivo" text NOT NULL, "origen_garzon_id" uuid, "actor_usuario_id" uuid, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_3ccf2366a1d2502452642b23536" PRIMARY KEY ("cuenta_asignacion_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cuenta_asignaciones_timeline" ON "cuenta_asignaciones"  ("tenant_id", "cuenta_id", "desde_el") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_cuenta_asignacion_vigente" ON "cuenta_asignaciones"  ("cuenta_id") WHERE "hasta_el" IS NULL AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "garzones" ("garzon_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" character varying(100) NOT NULL, "pin_hash" text NOT NULL, "activo" boolean NOT NULL DEFAULT true, "tipo" text NOT NULL DEFAULT 'garzon', "es_placeholder" boolean NOT NULL DEFAULT false, "usuario_id" uuid, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "PK_2647bab146d02e63ef4187be364" PRIMARY KEY ("garzon_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_garzones_usuario_tenant" ON "garzones"  ("tenant_id", "usuario_id") WHERE "usuario_id" IS NOT NULL AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_garzones_mostrador_tenant" ON "garzones"  ("tenant_id") WHERE "es_placeholder" = true AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "garzon_pin_evento" ("garzon_pin_evento_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "garzon_id" uuid NOT NULL, "tipo" text NOT NULL, "usuario_id" uuid NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_garzon_pin_evento_tipo" CHECK ("tipo" IN ('emitido_en_alta','regenerado_por_encargado','regenerado_por_baja_de_cuenta','invalidado_por_encargado','invalidado_por_vinculo','fijado_por_garzon')), CONSTRAINT "PK_38fe0cf1115f3b7b1f70381c545" PRIMARY KEY ("garzon_pin_evento_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_garzon_pin_evento_garzon" ON "garzon_pin_evento"  ("tenant_id", "garzon_id", "creado_el") `,
    );
    await queryRunner.query(
      `CREATE TABLE "turnos" ("turno_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" character varying(100) NOT NULL, "hora_inicio" character varying(5) NOT NULL, "hora_fin" character varying(5) NOT NULL, "activo" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "PK_a0ae567579333f5088033b8c782" PRIMARY KEY ("turno_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "sesiones_garzon" ("sesion_garzon_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "garzon_id" uuid NOT NULL, "turno_id" uuid NOT NULL, "tipo_garzon" text NOT NULL DEFAULT 'garzon', "inicio_el" TIMESTAMP WITH TIME ZONE NOT NULL, "fin_el" TIMESTAMP WITH TIME ZONE, "estado" text NOT NULL DEFAULT 'abierta', "origen_cierre" text, "cerrada_por_usuario_id" uuid, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a4195880c4b048bc597a6037ebf" PRIMARY KEY ("sesion_garzon_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_sesion_garzon_abierta" ON "sesiones_garzon"  ("tenant_id", "garzon_id") WHERE "estado" = 'abierta' AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "motivo_diferencia_inventario" ("motivo_diferencia_inventario_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" text NOT NULL, "activo" boolean NOT NULL DEFAULT true, "es_fijo" boolean NOT NULL DEFAULT false, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "PK_3a65bc3f77e6454e82ab83d68e9" PRIMARY KEY ("motivo_diferencia_inventario_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "motivo_traslado" ("motivo_traslado_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" text NOT NULL, "activo" boolean NOT NULL DEFAULT true, "es_fijo" boolean NOT NULL DEFAULT false, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "PK_f28f947c45978e444315a2bae1a" PRIMARY KEY ("motivo_traslado_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "solicitudes_idempotentes" ("solicitud_idempotente_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "usuario_id" uuid, "api_key_id" uuid, "clave" uuid NOT NULL, "operacion" character varying NOT NULL, "huella" character varying(64) NOT NULL, "respuesta" jsonb, "venta_id" uuid, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_solicitudes_idempotentes_un_actor" CHECK (("usuario_id" IS NULL) <> ("api_key_id" IS NULL)), CONSTRAINT "PK_44500f35529b96bae21fa533720" PRIMARY KEY ("solicitud_idempotente_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_solicitudes_idempotentes_clave_api_key" ON "solicitudes_idempotentes"  ("tenant_id", "api_key_id", "clave") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_solicitudes_idempotentes_clave" ON "solicitudes_idempotentes"  ("tenant_id", "usuario_id", "clave") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "impresoras" ("impresora_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" character varying(100) NOT NULL, "rol" text NOT NULL, "tipo_conexion" text NOT NULL, "host" character varying(255), "puerto" integer, "nombre_cola" character varying(100), "activo" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "PK_b3456262e148f4d0ea25885aecf" PRIMARY KEY ("impresora_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "grupos_modificadores" ("grupo_modificador_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" text NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "actualizado_el" TIMESTAMP WITH TIME ZONE, "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "PK_f6ab4b50307d20cc218cd5b3dfc" PRIMARY KEY ("grupo_modificador_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "grupo_modificador_opciones" ("grupo_opcion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "grupo_modificador_id" uuid NOT NULL, "item_id" uuid NOT NULL, "cantidad" numeric(18,4), "unidad_codigo" text, "precio_extra" numeric(18,4) NOT NULL DEFAULT '0', "orden" integer NOT NULL DEFAULT '0', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "actualizado_el" TIMESTAMP WITH TIME ZONE, "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_e8af689fdcf8814dd3bb15221d0" PRIMARY KEY ("grupo_opcion_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_grupo_opcion_item_vivo" ON "grupo_modificador_opciones"  ("grupo_modificador_id", "item_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "recuento_inventario" ("recuento_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "ubicacion_id" uuid NOT NULL, "estado" text NOT NULL DEFAULT 'borrador', "motivo_diferencia_default_id" uuid, "comentario" text, "usuario_creador_id" uuid NOT NULL, "usuario_aplicador_id" uuid, "aplicado_el" TIMESTAMP WITH TIME ZONE, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_0bf3afaaccc11b0b0d5089e5585" PRIMARY KEY ("recuento_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "recuento_inventario_linea" ("linea_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "recuento_id" uuid NOT NULL, "item_id" uuid NOT NULL, "stock_sistema" numeric(18,4) NOT NULL, "cantidad_contada" numeric(18,4), "motivo_diferencia_id" uuid, "movimiento_id" uuid, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_afebadf5d8526fb9b53c08af590" PRIMARY KEY ("linea_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_recuento_linea_item_vivo" ON "recuento_inventario_linea"  ("recuento_id", "item_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(`CREATE TABLE "promociones" ("promocion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" text NOT NULL, "descripcion" text, "activo" boolean NOT NULL DEFAULT true, "fecha_inicio" date NOT NULL, "fecha_fin" date NOT NULL, "hora_inicio" TIME, "hora_fin" TIME, "dias_semana" smallint array, "canal" text, "tipo" text NOT NULL, "valor_porcentaje" numeric(7,4), "cada_n" smallint, "valor_monto" numeric(18,4), "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_promociones_canal" CHECK ("canal" IS NULL OR "canal" IN ('fisico','online')), CONSTRAINT "chk_promociones_dias_semana" CHECK ("dias_semana" IS NULL OR "dias_semana" <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]), CONSTRAINT "chk_promociones_valor_segun_tipo" CHECK (("tipo" = 'porcentaje' AND "valor_porcentaje" IS NOT NULL AND "cada_n" IS NULL AND "valor_monto" IS NULL)
   OR ("tipo" = 'nxm' AND "valor_porcentaje" IS NOT NULL AND "cada_n" IS NOT NULL AND "valor_monto" IS NULL)
   OR ("tipo" = 'precio_fijo' AND "valor_monto" IS NOT NULL AND "valor_porcentaje" IS NULL AND "cada_n" IS NULL)), CONSTRAINT "chk_promociones_horario_paridad" CHECK (("hora_inicio" IS NULL) = ("hora_fin" IS NULL)), CONSTRAINT "PK_4ce7d9db4876b92b27c81543490" PRIMARY KEY ("promocion_id"))`);
    await queryRunner.query(
      `CREATE TABLE "promocion_scopes" ("scope_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "promocion_id" uuid NOT NULL, "slot" smallint NOT NULL, "tipo_scope" text NOT NULL, "categoria_id" uuid, "cantidad" smallint NOT NULL DEFAULT '1', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_promocion_scopes_categoria" CHECK (("tipo_scope" = 'categoria') = ("categoria_id" IS NOT NULL)), CONSTRAINT "PK_d36331408f9b09f278a7802cf85" PRIMARY KEY ("scope_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "promocion_scope_items" ("scope_id" uuid NOT NULL, "item_id" uuid NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_480628441ef5d74429b3be74939" PRIMARY KEY ("scope_id", "item_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "ventas_promociones" ("venta_promocion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "venta_id" uuid NOT NULL, "detalle_id" uuid NOT NULL, "aplicacion" integer NOT NULL, "promocion_id" uuid NOT NULL, "nombre_promocion" text NOT NULL, "tipo" text NOT NULL, "valor_efectivo" numeric(18,4) NOT NULL, "monto" numeric(18,4) NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a568ae10e0e4a0fea5af63d2813" PRIMARY KEY ("venta_promocion_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ventas_promociones_venta" ON "ventas_promociones"  ("venta_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ubicaciones" ("ubicacion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "nombre" text NOT NULL, "tipo" text NOT NULL, "activo" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, "eliminado_por" uuid, CONSTRAINT "PK_207609a6dd92d86426b763d7973" PRIMARY KEY ("ubicacion_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ubicaciones_tenant" ON "ubicaciones"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "traslados" ("traslado_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "ubicacion_origen_id" uuid NOT NULL, "ubicacion_destino_id" uuid NOT NULL, "motivo_traslado_id" uuid NOT NULL, "comentario" text, "usuario_id" uuid, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_e8bbaf44f467910864fd6274303" PRIMARY KEY ("traslado_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_traslados_tenant" ON "traslados"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_ubicacion" ("item_id" uuid NOT NULL, "ubicacion_id" uuid NOT NULL, "stock" numeric(18,4) NOT NULL DEFAULT '0', CONSTRAINT "PK_7cbf3d46272568bc500799eb96d" PRIMARY KEY ("item_id", "ubicacion_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_stock_ubicacion_ubicacion" ON "stock_ubicacion"  ("ubicacion_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_minimo" ("item_id" uuid NOT NULL, "ubicacion_id" uuid NOT NULL, "minimo" numeric(18,4) NOT NULL, "origen" text NOT NULL DEFAULT 'manual', "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_stock_minimo_no_negativo" CHECK ("minimo" >= 0), CONSTRAINT "chk_stock_minimo_origen" CHECK ("origen" IN ('manual', 'sistema')), CONSTRAINT "PK_12f5e103a782687c773f68bef29" PRIMARY KEY ("item_id", "ubicacion_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "lote_ubicacion" ("lote_id" uuid NOT NULL, "ubicacion_id" uuid NOT NULL, "cantidad" numeric(18,4) NOT NULL DEFAULT '0', CONSTRAINT "PK_3b0a5969ac94524de029f2c634e" PRIMARY KEY ("lote_id", "ubicacion_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lote_ubicacion_con_saldo" ON "lote_ubicacion"  ("ubicacion_id", "lote_id") WHERE "cantidad" > 0`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lote_ubicacion_ubicacion" ON "lote_ubicacion"  ("ubicacion_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "compras" ("compra_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "proveedor_id" uuid NOT NULL, "tipo_documento_compra_id" uuid NOT NULL, "folio" character varying(40), "fecha_documento" date NOT NULL, "ubicacion_id" uuid NOT NULL, "estado" text NOT NULL DEFAULT 'borrador', "descuento_total" numeric(18,4), "observacion" text, "total_documento" numeric(18,4), "fecha_vencimiento" date, "creado_por" uuid NOT NULL, "confirmado_por" uuid, "confirmado_el" TIMESTAMP WITH TIME ZONE, "anulado_por" uuid, "anulado_el" TIMESTAMP WITH TIME ZONE, "motivo_anulacion" text, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_compras_total_documento_positivo" CHECK ("total_documento" IS NULL OR "total_documento" > 0), CONSTRAINT "PK_7ed3086490ed7367046a9198dc6" PRIMARY KEY ("compra_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_compra_folio" ON "compras"  ("tenant_id", "proveedor_id", "tipo_documento_compra_id", "folio") WHERE "folio" IS NOT NULL AND "estado" <> 'anulada' AND "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "compra_lineas" ("compra_linea_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "compra_id" uuid NOT NULL, "tenant_id" uuid NOT NULL, "item_id" uuid NOT NULL, "orden" integer NOT NULL, "cantidad" numeric(18,4) NOT NULL, "unidad_codigo" text, "presentacion_compra_id" uuid, "precio_unitario" numeric(18,4), "series" jsonb, "lote" jsonb, "cantidad_base" numeric(18,4), "costo_unitario_base" numeric(18,4), "presentacion_nombre" character varying(40), "contenido_base" numeric(18,4), "movimiento_id" uuid, "stock_total_anterior" numeric(18,4), "costo_producto_anterior" numeric(18,4), "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_compra_lineas_unidad_o_presentacion" CHECK (("unidad_codigo" IS NULL) <> ("presentacion_compra_id" IS NULL)), CONSTRAINT "PK_df9ff34c3879fd1b77c5dce06e4" PRIMARY KEY ("compra_linea_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_compra_lineas_compra" ON "compra_lineas"  ("compra_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "compra_linea_cambios" ("compra_linea_cambio_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "compra_linea_id" uuid NOT NULL, "tenant_id" uuid NOT NULL, "campo" text NOT NULL, "valor_anterior" text, "valor_nuevo" text, "usuario_id" uuid NOT NULL, "movimiento_id" uuid, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_61623b6abc7dc2417b4e37dd0ac" PRIMARY KEY ("compra_linea_cambio_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_compra_linea_cambios_linea" ON "compra_linea_cambios"  ("compra_linea_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "tipos_documento_compra" ("tipo_documento_compra_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "pais_id" uuid NOT NULL, "nombre" character varying(100) NOT NULL, "codigo" character varying(20), "requiere_folio" boolean NOT NULL DEFAULT true, "total_documento" text NOT NULL, "activo" boolean NOT NULL DEFAULT true, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_tipos_documento_compra_total_documento" CHECK ("total_documento" IN ('suma_lineas', 'obligatorio', 'opcional')), CONSTRAINT "PK_1f0c57a9d1c17b744237c888cd8" PRIMARY KEY ("tipo_documento_compra_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "presentaciones_compra" ("presentacion_compra_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "proveedor_id" uuid NOT NULL, "item_id" uuid NOT NULL, "nombre" character varying(40) NOT NULL, "contenido" numeric(18,4) NOT NULL, "unidad_codigo" text NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_c2c3a60ed6248ce18f899248cc2" PRIMARY KEY ("presentacion_compra_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_presentaciones_compra_proveedor" ON "presentaciones_compra"  ("tenant_id", "proveedor_id") `,
    );
    await queryRunner.query(`CREATE TABLE "codigos_proveedor" ("codigo_proveedor_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "proveedor_id" uuid NOT NULL, "clave" character varying(160) NOT NULL, "descripcion" character varying(80) NOT NULL, "no_mercaderia" boolean NOT NULL DEFAULT false, "item_id" uuid, "presentacion_compra_id" uuid, "unidad_codigo" text, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_codigos_proveedor_destino" CHECK (("no_mercaderia" AND "item_id" IS NULL AND "presentacion_compra_id" IS NULL AND "unidad_codigo" IS NULL)
   OR (NOT "no_mercaderia" AND "item_id" IS NOT NULL
       AND ("presentacion_compra_id" IS NULL) <> ("unidad_codigo" IS NULL))), CONSTRAINT "PK_74fac65d5cd5601d1ab8d4e2b11" PRIMARY KEY ("codigo_proveedor_id"))`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_codigos_proveedor_clave" ON "codigos_proveedor"  ("tenant_id", "proveedor_id", "clave") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "pagos_proveedor" ("pago_proveedor_id" uuid NOT NULL, "tenant_id" uuid NOT NULL, "proveedor_id" uuid NOT NULL, "fecha" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "monto" numeric(18,4) NOT NULL, "metodo_pago_id" uuid NOT NULL, "referencia" text, "caja_id" uuid, "creado_por" uuid NOT NULL, "estado" text NOT NULL DEFAULT 'vigente', "anulado_por" uuid, "anulado_el" TIMESTAMP WITH TIME ZONE, "motivo_anulacion" text, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_pagos_proveedor_monto_positivo" CHECK ("monto" > 0), CONSTRAINT "PK_fd222a481c56f7f7a6be4737293" PRIMARY KEY ("pago_proveedor_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pagos_proveedor_proveedor" ON "pagos_proveedor"  ("tenant_id", "proveedor_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pago_proveedor_aplicaciones" ("pago_proveedor_aplicacion_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "pago_proveedor_id" uuid NOT NULL, "compra_id" uuid NOT NULL, "monto" numeric(18,4) NOT NULL, "creado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_el" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eliminado_el" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_pago_prov_aplic_monto_positivo" CHECK ("monto" > 0), CONSTRAINT "PK_8126a2ab180615f725fddf403b8" PRIMARY KEY ("pago_proveedor_aplicacion_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pago_prov_aplic_compra" ON "pago_proveedor_aplicaciones"  ("compra_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pago_prov_aplic_pago" ON "pago_proveedor_aplicaciones"  ("pago_proveedor_id") WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id") REFERENCES "usuarios"("usuario_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "modulo_app_permisos" ADD CONSTRAINT "FK_12b3ac0d603cb79705c2edc8269" FOREIGN KEY ("modulo_app_id") REFERENCES "modulos_app"("modulo_app_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "modulo_app_permisos" ADD CONSTRAINT "FK_b85be51e723321fde560ec527c8" FOREIGN KEY ("permiso_id") REFERENCES "permisos"("permiso_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    // ── Índices únicos sobre una expresión (`lower(nombre)`, la serie normalizada).
    // TypeORM no sabe declarar una función en `@Index`, así que no los genera: hasta
    // ADR-030 los creaba el seeder con SQL cruda —y solo fuera de producción, porque el
    // seeder no corre ahí—. Cada entity registra el NOMBRE con `synchronize: false`
    // para que `migration:generate` no los proponga borrar. El porqué de cada regla
    // está en el comentario de su entity.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_ubicaciones_tenant_nombre" ON "ubicaciones" (tenant_id, lower(nombre)) WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_motivo_baja_tenant_nombre" ON "motivo_baja" (tenant_id, lower(nombre)) WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_motivo_diferencia_caja_tenant_nombre" ON "motivo_diferencia_caja" (tenant_id, lower(nombre)) WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_motivo_dif_inv_tenant_nombre" ON "motivo_diferencia_inventario" (tenant_id, lower(nombre)) WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_motivo_traslado_tenant_nombre" ON "motivo_traslado" (tenant_id, lower(nombre)) WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_promociones_tenant_nombre_vivo" ON "promociones" (tenant_id, lower(nombre)) WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_cajones_tenant_nombre" ON "cajones" (tenant_id, lower(nombre)) WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_turnos_tenant_nombre_vivo" ON "turnos" (tenant_id, lower(nombre)) WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_impuestos_tenant_nombre_vivo" ON "impuestos" (tenant_id, lower(nombre)) WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_descuentos_tenant_nombre_vivo" ON "descuentos" (tenant_id, lower(nombre)) WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_recargos_tenant_nombre_vivo" ON "recargos" (tenant_id, lower(nombre)) WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_presentaciones_compra_nombre" ON "presentaciones_compra" (tenant_id, proveedor_id, item_id, lower(nombre)) WHERE "eliminado_el" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_grupo_modificador_nombre_vivo" ON "grupos_modificadores" (tenant_id, lower(nombre)) WHERE "eliminado_el" IS NULL`,
    );
    // La lista de blancos es la de `serieNormalizadaSql` (`item-unidad.entity.ts`),
    // copiada y no importada: una migración no cambia aunque cambie el código.
    await queryRunner.query(
      String.raw`CREATE UNIQUE INDEX "uq_unidad_item_serie" ON "item_unidad" (item_id, lower(btrim(serie, E' \t\n\r\f\x0b\u00a0'))) WHERE "eliminado_el" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uq_unidad_item_serie"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_grupo_modificador_nombre_vivo"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_presentaciones_compra_nombre"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_recargos_tenant_nombre_vivo"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_descuentos_tenant_nombre_vivo"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_impuestos_tenant_nombre_vivo"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_turnos_tenant_nombre_vivo"`,
    );
    await queryRunner.query(`DROP INDEX "public"."ux_cajones_tenant_nombre"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_promociones_tenant_nombre_vivo"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_motivo_traslado_tenant_nombre"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_motivo_dif_inv_tenant_nombre"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_motivo_diferencia_caja_tenant_nombre"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_motivo_baja_tenant_nombre"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_ubicaciones_tenant_nombre"`,
    );
    await queryRunner.query(
      `ALTER TABLE "modulo_app_permisos" DROP CONSTRAINT "FK_b85be51e723321fde560ec527c8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "modulo_app_permisos" DROP CONSTRAINT "FK_12b3ac0d603cb79705c2edc8269"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_pago_prov_aplic_pago"`);
    await queryRunner.query(`DROP INDEX "public"."idx_pago_prov_aplic_compra"`);
    await queryRunner.query(`DROP TABLE "pago_proveedor_aplicaciones"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_pagos_proveedor_proveedor"`,
    );
    await queryRunner.query(`DROP TABLE "pagos_proveedor"`);
    await queryRunner.query(`DROP INDEX "public"."uq_codigos_proveedor_clave"`);
    await queryRunner.query(`DROP TABLE "codigos_proveedor"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_presentaciones_compra_proveedor"`,
    );
    await queryRunner.query(`DROP TABLE "presentaciones_compra"`);
    await queryRunner.query(`DROP TABLE "tipos_documento_compra"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_compra_linea_cambios_linea"`,
    );
    await queryRunner.query(`DROP TABLE "compra_linea_cambios"`);
    await queryRunner.query(`DROP INDEX "public"."idx_compra_lineas_compra"`);
    await queryRunner.query(`DROP TABLE "compra_lineas"`);
    await queryRunner.query(`DROP INDEX "public"."uq_compra_folio"`);
    await queryRunner.query(`DROP TABLE "compras"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_lote_ubicacion_ubicacion"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_lote_ubicacion_con_saldo"`,
    );
    await queryRunner.query(`DROP TABLE "lote_ubicacion"`);
    await queryRunner.query(`DROP TABLE "stock_minimo"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_stock_ubicacion_ubicacion"`,
    );
    await queryRunner.query(`DROP TABLE "stock_ubicacion"`);
    await queryRunner.query(`DROP INDEX "public"."idx_traslados_tenant"`);
    await queryRunner.query(`DROP TABLE "traslados"`);
    await queryRunner.query(`DROP INDEX "public"."idx_ubicaciones_tenant"`);
    await queryRunner.query(`DROP TABLE "ubicaciones"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_ventas_promociones_venta"`,
    );
    await queryRunner.query(`DROP TABLE "ventas_promociones"`);
    await queryRunner.query(`DROP TABLE "promocion_scope_items"`);
    await queryRunner.query(`DROP TABLE "promocion_scopes"`);
    await queryRunner.query(`DROP TABLE "promociones"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_recuento_linea_item_vivo"`,
    );
    await queryRunner.query(`DROP TABLE "recuento_inventario_linea"`);
    await queryRunner.query(`DROP TABLE "recuento_inventario"`);
    await queryRunner.query(`DROP INDEX "public"."uq_grupo_opcion_item_vivo"`);
    await queryRunner.query(`DROP TABLE "grupo_modificador_opciones"`);
    await queryRunner.query(`DROP TABLE "grupos_modificadores"`);
    await queryRunner.query(`DROP TABLE "impresoras"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_solicitudes_idempotentes_clave"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_solicitudes_idempotentes_clave_api_key"`,
    );
    await queryRunner.query(`DROP TABLE "solicitudes_idempotentes"`);
    await queryRunner.query(`DROP TABLE "motivo_traslado"`);
    await queryRunner.query(`DROP TABLE "motivo_diferencia_inventario"`);
    await queryRunner.query(`DROP INDEX "public"."uq_sesion_garzon_abierta"`);
    await queryRunner.query(`DROP TABLE "sesiones_garzon"`);
    await queryRunner.query(`DROP TABLE "turnos"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_garzon_pin_evento_garzon"`,
    );
    await queryRunner.query(`DROP TABLE "garzon_pin_evento"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_garzones_mostrador_tenant"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_garzones_usuario_tenant"`);
    await queryRunner.query(`DROP TABLE "garzones"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_cuenta_asignacion_vigente"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_cuenta_asignaciones_timeline"`,
    );
    await queryRunner.query(`DROP TABLE "cuenta_asignaciones"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_cuenta_linea_reparto_garzon"`,
    );
    await queryRunner.query(`DROP TABLE "cuenta_linea_reparto"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_cuenta_linea_anulaciones_cuenta"`,
    );
    await queryRunner.query(`DROP TABLE "cuenta_linea_anulaciones"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_cuenta_lineas_personalizacion"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_cuenta_lineas_item"`);
    await queryRunner.query(`DROP INDEX "public"."idx_cuenta_lineas_cuenta"`);
    await queryRunner.query(`DROP TABLE "cuenta_lineas"`);
    await queryRunner.query(`DROP INDEX "public"."idx_cuentas_venta"`);
    await queryRunner.query(`DROP INDEX "public"."idx_cuentas_responsable"`);
    await queryRunner.query(`DROP INDEX "public"."idx_cuentas_estado"`);
    await queryRunner.query(`DROP INDEX "public"."idx_cuentas_cerrada"`);
    await queryRunner.query(`DROP TABLE "cuentas"`);
    await queryRunner.query(`DROP TABLE "mesas"`);
    await queryRunner.query(`DROP TABLE "salones"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db67a62a358c2c8ee97ab954a6"`,
    );
    await queryRunner.query(`DROP TABLE "cron_ejecuciones"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a0d54be996a40e9bc6743a87f8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_705b8606312fd125e2a9a544c9"`,
    );
    await queryRunner.query(`DROP TABLE "pasarela_transacciones"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_196850352badd2e06061fde136"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7a2e100191443c59f6bb2c18ad"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_33e1cef74a3641a41657fc497d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e0ac38e16251ce754e09d8d3b4"`,
    );
    await queryRunner.query(`DROP TABLE "pasarela_ordenes"`);
    await queryRunner.query(`DROP TABLE "pasarela_medios_pago"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2344f48809ebb3cba67ee19d26"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_308c146cdf4b17c7a9ec224cfb"`,
    );
    await queryRunner.query(`DROP TABLE "pasarela_inscripciones"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7111d1c304afd52b3d359a1e82"`,
    );
    await queryRunner.query(`DROP TABLE "pasarela_api_keys"`);
    await queryRunner.query(`DROP TABLE "tenant_pasarela"`);
    await queryRunner.query(`DROP TABLE "pasarelas"`);
    await queryRunner.query(`DROP TABLE "suscripciones"`);
    await queryRunner.query(`DROP TABLE "terceros"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_umbral_identidad_pagador_pais_anio"`,
    );
    await queryRunner.query(`DROP TABLE "umbral_identidad_pagador"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_tipo_documento_nota_credito_pais"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_tipo_documento_boleta_pais"`,
    );
    await queryRunner.query(`DROP TABLE "tipos_documento_tributario"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_liquidacion_propinas_evento_liquidacion"`,
    );
    await queryRunner.query(`DROP TABLE "liquidacion_propinas_evento"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_liquidacion_propinas_fuente_propina"`,
    );
    await queryRunner.query(`DROP TABLE "liquidacion_propinas_fuente"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_liquidacion_propinas_participante_liquidacion"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_liquidacion_propinas_participante_garzon"`,
    );
    await queryRunner.query(`DROP TABLE "liquidacion_propinas_participante"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_liquidacion_propinas_grupo_liquidacion"`,
    );
    await queryRunner.query(`DROP TABLE "liquidacion_propinas_grupo"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_liquidacion_propinas_tenant_estado"`,
    );
    await queryRunner.query(`DROP TABLE "liquidacion_propinas"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_propina_peso_grupo_garzon"`,
    );
    await queryRunner.query(`DROP TABLE "propina_grupo_peso_manual"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_propina_grupo_tipo_activo"`,
    );
    await queryRunner.query(`DROP TABLE "propina_grupo_distribucion"`);
    await queryRunner.query(`DROP INDEX "public"."uq_propina_config_tenant"`);
    await queryRunner.query(`DROP TABLE "propina_configuracion"`);
    await queryRunner.query(`DROP INDEX "public"."uq_venta_propina_venta"`);
    await queryRunner.query(`DROP INDEX "public"."idx_venta_propina_garzon"`);
    await queryRunner.query(`DROP TABLE "venta_propina"`);
    await queryRunner.query(`DROP INDEX "public"."idx_pago_aplicaciones_pago"`);
    await queryRunner.query(`DROP INDEX "public"."idx_pago_aplicaciones_ref"`);
    await queryRunner.query(`DROP TABLE "pago_aplicaciones"`);
    await queryRunner.query(`DROP INDEX "public"."idx_pagos_venta"`);
    await queryRunner.query(`DROP INDEX "public"."idx_pagos_documento"`);
    await queryRunner.query(`DROP TABLE "pagos"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_venta_documento_numero_borrados_documento"`,
    );
    await queryRunner.query(`DROP TABLE "venta_documento_numero_borrados"`);
    await queryRunner.query(`DROP INDEX "public"."idx_venta_documentos_venta"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_venta_documentos_corregido"`,
    );
    await queryRunner.query(`DROP TABLE "venta_documentos"`);
    await queryRunner.query(`DROP INDEX "public"."idx_venta_customer_venta"`);
    await queryRunner.query(`DROP TABLE "venta_customer"`);
    await queryRunner.query(`DROP INDEX "public"."idx_ventas_impuestos_venta"`);
    await queryRunner.query(`DROP TABLE "ventas_impuestos"`);
    await queryRunner.query(`DROP INDEX "public"."idx_ventas_recargos_venta"`);
    await queryRunner.query(`DROP TABLE "ventas_recargos"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_ventas_descuentos_venta"`,
    );
    await queryRunner.query(`DROP TABLE "ventas_descuentos"`);
    await queryRunner.query(`DROP INDEX "public"."idx_venta_detalles_venta"`);
    await queryRunner.query(`DROP TABLE "venta_detalles"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_ventas_venta_referencia"`,
    );
    await queryRunner.query(`DROP TABLE "ventas"`);
    await queryRunner.query(`DROP TYPE "public"."ventas_estado_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."ux_cajon_usuario_cajon_usuario"`,
    );
    await queryRunner.query(`DROP TABLE "cajon_usuario"`);
    await queryRunner.query(`DROP TABLE "cajones"`);
    await queryRunner.query(`DROP TABLE "motivo_diferencia_caja"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_motivo_baja_devolucion_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "motivo_baja"`);
    await queryRunner.query(`DROP TYPE "public"."tipo_motivo_baja"`);
    await queryRunner.query(`DROP TABLE "movimiento_inventario_detalle"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_movimientos_inventario_venta"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_movimientos_inventario_traslado"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_movimientos_inventario_compra_linea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_movimientos_inventario_item_secuencia"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_movimientos_inventario_item_ubicacion_secuencia"`,
    );
    await queryRunner.query(`DROP TABLE "movimientos_inventario"`);
    await queryRunner.query(`DROP INDEX "public"."uq_item_grupo_opcion_vivo"`);
    await queryRunner.query(`DROP TABLE "item_grupo_modificador_opciones"`);
    await queryRunner.query(`DROP INDEX "public"."uq_item_grupo_vivo"`);
    await queryRunner.query(`DROP TABLE "item_grupos_modificadores"`);
    await queryRunner.query(`DROP INDEX "public"."uq_combo_componente_vivo"`);
    await queryRunner.query(`DROP TABLE "combo_componentes"`);
    await queryRunner.query(`DROP TABLE "item_combo"`);
    await queryRunner.query(`DROP TABLE "item_unidad"`);
    await queryRunner.query(`DROP INDEX "public"."uq_lote_item_codigo"`);
    await queryRunner.query(`DROP TABLE "item_lote"`);
    await queryRunner.query(`DROP TABLE "item_descuentos"`);
    await queryRunner.query(`DROP TABLE "item_recargos"`);
    await queryRunner.query(`DROP TABLE "item_impuestos"`);
    await queryRunner.query(`DROP INDEX "public"."uq_receta_extra_vivo"`);
    await queryRunner.query(`DROP TABLE "receta_extras_permitidos"`);
    await queryRunner.query(`DROP INDEX "public"."uq_receta_ingrediente_vivo"`);
    await queryRunner.query(`DROP TABLE "receta_ingredientes"`);
    await queryRunner.query(`DROP TABLE "item_receta"`);
    await queryRunner.query(`DROP TABLE "item_suscripcion"`);
    await queryRunner.query(`DROP TABLE "item_servicio"`);
    await queryRunner.query(`DROP TABLE "item_producto"`);
    await queryRunner.query(`DROP INDEX "public"."uq_item_ajuste_nc_tenant"`);
    await queryRunner.query(`DROP INDEX "public"."idx_items_tenant_tipo_vivo"`);
    await queryRunner.query(`DROP TABLE "items"`);
    await queryRunner.query(`DROP TABLE "tenant_metodo_pago"`);
    await queryRunner.query(`DROP TABLE "metodo_pago_pais"`);
    await queryRunner.query(`DROP TABLE "metodos_pago"`);
    await queryRunner.query(`DROP TABLE "recargo_metodo_pago"`);
    await queryRunner.query(`DROP TABLE "recargo_tramos"`);
    await queryRunner.query(`DROP TABLE "recargos"`);
    await queryRunner.query(`DROP TABLE "descuento_metodo_pago"`);
    await queryRunner.query(`DROP TABLE "descuento_tramos"`);
    await queryRunner.query(`DROP TABLE "descuentos"`);
    await queryRunner.query(`DROP TYPE "public"."condicion_tipo"`);
    await queryRunner.query(`DROP TYPE "public"."nivel_regla"`);
    await queryRunner.query(`DROP TYPE "public"."modo_regla"`);
    await queryRunner.query(`DROP TABLE "tipos_regla"`);
    await queryRunner.query(`DROP TABLE "impuestos"`);
    await queryRunner.query(`DROP TABLE "categorias"`);
    await queryRunner.query(`DROP TABLE "pais_moneda"`);
    await queryRunner.query(`DROP TABLE "tenant_moneda"`);
    await queryRunner.query(`DROP TABLE "roles_permisos_modulos"`);
    await queryRunner.query(`DROP TABLE "modulos_roles"`);
    await queryRunner.query(`DROP TABLE "roles_usuarios"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_roles_sistema_tenant_nombre"`,
    );
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(`DROP TABLE "razones_sociales"`);
    await queryRunner.query(`DROP TABLE "caja_intentos_rechazados"`);
    await queryRunner.query(`DROP INDEX "public"."ux_caja_arqueo_medio"`);
    await queryRunner.query(`DROP TABLE "caja_arqueo_medio"`);
    await queryRunner.query(`DROP INDEX "public"."idx_movimientos_caja_venta"`);
    await queryRunner.query(`DROP TABLE "movimientos_caja"`);
    await queryRunner.query(
      `DROP INDEX "public"."ux_caja_testigo_caja_garzon"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_caja_testigo_caja"`);
    await queryRunner.query(`DROP INDEX "public"."idx_caja_testigo_pendiente"`);
    await queryRunner.query(`DROP TABLE "caja_testigo"`);
    await queryRunner.query(`DROP INDEX "public"."ux_cajas_cajon_abierta"`);
    await queryRunner.query(
      `DROP INDEX "public"."ux_cajas_activa_por_usuario"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."ix_cajas_pendientes_revision"`,
    );
    await queryRunner.query(`DROP TABLE "cajas"`);
    await queryRunner.query(`DROP TABLE "tenant_formula_precio"`);
    await queryRunner.query(`DROP TABLE "tenant_modulos"`);
    await queryRunner.query(`DROP TABLE "usuarios_tenants"`);
    await queryRunner.query(`DROP TABLE "tenants"`);
    await queryRunner.query(`DROP TABLE "modulo_app_permisos"`);
    await queryRunner.query(`DROP TABLE "permisos"`);
    await queryRunner.query(`DROP TABLE "modulos_app"`);
    await queryRunner.query(`DROP TABLE "unidades_medida"`);
    await queryRunner.query(`DROP TABLE "moneda"`);
    await queryRunner.query(`DROP TABLE "provincia"`);
    await queryRunner.query(`DROP TABLE "pais"`);
    await queryRunner.query(`DROP TABLE "tokens_acceso"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "usuarios"`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS "uuid-ossp"`);
  }
}
