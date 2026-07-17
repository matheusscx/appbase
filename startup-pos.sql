-- =============================================================
-- ESQUEMA BASE DE DATOS — SaaS POS Multi-tenant
-- Terminología nueva aplicada (ver CLAUDE.md para el mapeo completo)
-- =============================================================

-- -------------------------------------------------------------
-- ENUMs
-- -------------------------------------------------------------

CREATE TYPE "condicion_tipo" AS ENUM (
  'ninguna',
  'customer',         -- era 'cliente'
  'producto',
  'categoria',
  'fecha',
  'metodo_pago',
  'vencimiento',
  'monto_minimo',     -- monto mínimo de la venta
  'cantidad_minima'   -- cantidad mínima de unidades
);

CREATE TYPE "modo_regla" AS ENUM (
  'porcentaje',
  'monto_fijo'
);

CREATE TYPE "estado_venta" AS ENUM (
  'borrador',
  'pendiente',
  'pagada_parcial',
  'pagada',         -- era 'aprobada'
  'cancelada'
);

CREATE TYPE "tipo_movimiento" AS ENUM (
  'entrada',
  'salida'
);

-- =============================================================
-- 1. CATÁLOGOS BASE GLOBALES  (sembrados por seeder, sin tenant)
-- =============================================================

CREATE TABLE "pais" (
  "pais_id"                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "nombre"                 VARCHAR(100) NOT NULL,
  "codigo_iso"             CHAR(2)     UNIQUE NOT NULL,
  "zona_horaria_principal" VARCHAR(50) NOT NULL,
  "moneda_oficial_id"      UUID,       -- FK a moneda; se setea después de crear moneda
  "creado_el"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el"         TIMESTAMPTZ,
  "eliminado_el"           TIMESTAMPTZ
);

CREATE TABLE "provincia" (
  "provincia_id"   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "pais_id"        UUID        NOT NULL REFERENCES "pais" ("pais_id"),
  "nombre"         VARCHAR(100) NOT NULL,
  "zona_horaria"   VARCHAR(50) NOT NULL,
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);

CREATE TABLE "moneda" (
  "moneda_id"      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "nombre"         VARCHAR(50) NOT NULL,
  "codigo_iso"     CHAR(3)     UNIQUE NOT NULL,
  "codigo_numero"  CHAR(3)     UNIQUE NOT NULL,
  "simbolo"            VARCHAR(5),
  "decimales"          SMALLINT    DEFAULT 0,
  "separador_decimal"  CHAR(1)     NOT NULL DEFAULT ',',  -- Chile: ',' | México: '.'
  "separador_miles"    CHAR(1)     NOT NULL DEFAULT '.',  -- Chile: '.' | México: ','
  "locale"             VARCHAR(10) NOT NULL DEFAULT 'es-CL',  -- BCP 47 para Intl/maska
  "creado_el"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);

ALTER TABLE "pais" ADD FOREIGN KEY ("moneda_oficial_id") REFERENCES "moneda" ("moneda_id");

-- Catálogo global de unidades de medida (sin tenant_id: son hechos físicos).
-- Conversión dentro de una magnitud: cantidad × (factor_base_desde / factor_base_hacia)
CREATE TABLE "unidades_medida" (
  "unidad_medida_id" UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "codigo"           TEXT          UNIQUE NOT NULL,  -- guardado en item_producto.unidad_medida
  "nombre"           TEXT          NOT NULL,
  "magnitud"         TEXT          NOT NULL,  -- 'masa' | 'volumen' | 'conteo' | 'longitud'
  "factor_base"      NUMERIC(18,6) NOT NULL CHECK ("factor_base" > 0),  -- kg → 1000 (base: g); CHECK documentado (enforce también en CatalogService)
  "creado_el"        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"   TIMESTAMPTZ,
  "eliminado_el"     TIMESTAMPTZ
);

-- Monedas disponibles por país (puente). Define el subconjunto del catálogo
-- global que un tenant de ese país puede habilitar (la oficial sale de pais.moneda_oficial_id).
CREATE TABLE "pais_moneda" (
  "pais_id"        UUID        NOT NULL REFERENCES "pais" ("pais_id"),
  "moneda_id"      UUID        NOT NULL REFERENCES "moneda" ("moneda_id"),
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ,
  PRIMARY KEY ("pais_id", "moneda_id")
);

-- Documentos tributarios válidos por país (boleta, factura, nota de crédito, etc.)
-- Cada país define sus propios tipos; no es un enum fijo.
CREATE TABLE "tipos_documento_tributario" (
  "tipo_documento_id" UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "pais_id"           UUID        NOT NULL REFERENCES "pais" ("pais_id"),
  "nombre"            VARCHAR(100) NOT NULL,
  "codigo"            VARCHAR(20),   -- código tributario local (ej. '33' = Factura en Chile)
  "descripcion"       TEXT,
  "activo"            BOOLEAN     NOT NULL DEFAULT true,
  "customer_requerido" BOOLEAN     NOT NULL DEFAULT false,
  "creado_el"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el"    TIMESTAMPTZ,
  "eliminado_el"      TIMESTAMPTZ
);

CREATE TABLE "metodos_pago" (
  "metodo_pago_id" UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "nombre"         TEXT        NOT NULL,
  "abreviatura"    VARCHAR(5),
  "activo"         BOOLEAN     NOT NULL DEFAULT true,
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);

-- Disponibilidad de métodos de pago por país (espejo de pais_moneda).
-- El tenant solo puede habilitar los métodos disponibles en su país.
CREATE TABLE "metodo_pago_pais" (
  "pais_id"        UUID        NOT NULL REFERENCES "pais" ("pais_id"),
  "metodo_pago_id" UUID        NOT NULL REFERENCES "metodos_pago" ("metodo_pago_id"),
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ,
  PRIMARY KEY ("pais_id", "metodo_pago_id")
);

CREATE TABLE "modulos_app" (
  "modulo_app_id"       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "nombre"              VARCHAR(100) NOT NULL,
  "descripcion"         TEXT,
  "url"                 VARCHAR(255),
  "icono"               VARCHAR(50),
  "tiene_configuracion" BOOLEAN     DEFAULT true,
  "creado_el"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el"      TIMESTAMPTZ,
  "eliminado_el"        TIMESTAMPTZ
);

CREATE TABLE "permisos" (
  "permiso_id"     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "nombre"         VARCHAR(50) NOT NULL,
  "descripcion"    TEXT,
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);

CREATE TABLE "modulo_app_permisos" (
  "modulo_app_permiso_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "modulo_app_id"         UUID NOT NULL REFERENCES "modulos_app" ("modulo_app_id"),
  "permiso_id"            UUID NOT NULL REFERENCES "permisos" ("permiso_id"),
  "creado_el"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el"        TIMESTAMPTZ,
  "eliminado_el"          TIMESTAMPTZ
);

-- =============================================================
-- 2. TENANTS  (era "clientes")
-- =============================================================

CREATE TABLE "tenants" (
  "tenant_id"          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "provincia_id"       UUID        NOT NULL REFERENCES "provincia" ("provincia_id"),
  "nombre"             VARCHAR(100) NOT NULL,
  "correo"             VARCHAR(100) UNIQUE NOT NULL,
  "telefono"           VARCHAR(20),
  "direccion"          TEXT,
  "calculo_descuentos" TEXT        NOT NULL DEFAULT 'base',  -- 'base' | 'compuesto'
  "calculo_recargos"   TEXT        NOT NULL DEFAULT 'base',  -- 'base' | 'compuesto'
  "escala_calculo"     SMALLINT    NOT NULL DEFAULT 6,        -- decimales para cálculos intermedios (0-12)
  "modo_redondeo"      TEXT        NOT NULL DEFAULT 'HALF_UP', -- HALF_UP | HALF_EVEN | FLOOR | CEIL
  "monto_tolerancia"   NUMERIC(18,6) NOT NULL DEFAULT 0,      -- tolerancia en conciliaciones
  "creado_el"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el"     TIMESTAMPTZ,
  "eliminado_el"       TIMESTAMPTZ
);

CREATE TABLE "razones_sociales" (
  "razon_social_id" UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       UUID        REFERENCES "tenants" ("tenant_id"),
  "nombre"          VARCHAR(100) NOT NULL,
  "rut"             VARCHAR(50) NOT NULL,
  "direccion"       VARCHAR(255),
  "telefono"        VARCHAR(50),
  "habilitado"      BOOLEAN     DEFAULT false,
  "preferida"       BOOLEAN     NOT NULL DEFAULT false,
  "creado_el"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el"  TIMESTAMPTZ,
  "eliminado_el"    TIMESTAMPTZ
);

-- Directorio de entidades externas del tenant: proveedores, empresas, personas naturales
CREATE TABLE "terceros" (
  "tercero_id"     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID        NOT NULL REFERENCES "tenants" ("tenant_id"),
  "tipo"           TEXT        NOT NULL,  -- 'proveedor' | 'empresa' | 'persona_natural'
  "nombre"         VARCHAR(100) NOT NULL,
  "rut"            VARCHAR(50),
  "nombre_legal"   VARCHAR(100),          -- razón social para facturación
  "rut_fiscal"     VARCHAR(50),
  "correo"         VARCHAR(100),
  "telefono"       VARCHAR(50),
  "direccion"      TEXT,
  "activo"         BOOLEAN     NOT NULL DEFAULT true,
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);

-- Sub-tenants: funcionalidad futura (tabla reservada, no usar aún)
CREATE TABLE "sub_tenants" (
  "tenant_id"      UUID NOT NULL REFERENCES "tenants" ("tenant_id"),
  "sub_tenant_id"  UUID NOT NULL REFERENCES "tenants" ("tenant_id"),
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ,
  PRIMARY KEY ("tenant_id", "sub_tenant_id")
);

-- =============================================================
-- 3. USUARIOS Y ACCESO
-- =============================================================

CREATE TABLE "usuarios" (
  "usuario_id"     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "nombre_usuario" VARCHAR(50) UNIQUE NOT NULL,
  "contrasena"     VARCHAR(100) NOT NULL,
  "nombre"         VARCHAR(100) NOT NULL,
  "apellido"       VARCHAR(100) NOT NULL,
  "telefono"       VARCHAR(100) NOT NULL,
  "correo"         VARCHAR(100) UNIQUE NOT NULL,
  "es_superadmin"  BOOLEAN     NOT NULL DEFAULT false,
  "preferencias"   JSONB       NOT NULL DEFAULT '{}',
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);

-- Asociación usuario ↔ tenant  (era "usuarios_clientes")
CREATE TABLE "usuarios_tenants" (
  "usuario_id"     UUID NOT NULL REFERENCES "usuarios" ("usuario_id"),
  "tenant_id"      UUID NOT NULL REFERENCES "tenants" ("tenant_id"),
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ,
  PRIMARY KEY ("usuario_id", "tenant_id")
);

-- =============================================================
-- 4. RBAC
-- =============================================================

CREATE TABLE "roles" (
  "rol_id"         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID        REFERENCES "tenants" ("tenant_id"),
  "nombre"         VARCHAR(50) NOT NULL,
  "descripcion"    TEXT,
  "es_fijo"        BOOLEAN     NOT NULL DEFAULT false,  -- true para el rol 'admin' del sistema
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);

CREATE TABLE "roles_usuarios" (
  "usuario_id"     UUID NOT NULL REFERENCES "usuarios" ("usuario_id"),
  "tenant_id"      UUID NOT NULL REFERENCES "tenants" ("tenant_id"),
  "rol_id"         UUID NOT NULL REFERENCES "roles" ("rol_id"),
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ,
  PRIMARY KEY ("usuario_id", "tenant_id", "rol_id")
);

-- Módulos contratados por cada tenant  (era "modulos_clientes")
CREATE TABLE "tenant_modulos" (
  "modulo_tenant_id" UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        UUID        NOT NULL REFERENCES "tenants" ("tenant_id"),
  "modulo_app_id"    UUID        NOT NULL REFERENCES "modulos_app" ("modulo_app_id"),
  "estado"           VARCHAR(20) DEFAULT 'activo',
  "contratado_en"    TIMESTAMPTZ DEFAULT NOW(),
  "expira_en"        TIMESTAMPTZ,
  "creado_el"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el"   TIMESTAMPTZ,
  "eliminado_el"     TIMESTAMPTZ
);

CREATE TABLE "modulos_roles" (
  "rol_id"           UUID NOT NULL REFERENCES "roles" ("rol_id"),
  "modulo_tenant_id" UUID NOT NULL REFERENCES "tenant_modulos" ("modulo_tenant_id"),
  "creado_el"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el"   TIMESTAMPTZ,
  "eliminado_el"     TIMESTAMPTZ,
  PRIMARY KEY ("rol_id", "modulo_tenant_id")
);

CREATE TABLE "roles_permisos_modulos" (
  "rol_id"                UUID NOT NULL REFERENCES "roles" ("rol_id"),
  "modulo_tenant_id"      UUID NOT NULL REFERENCES "tenant_modulos" ("modulo_tenant_id"),
  "modulo_app_permiso_id" UUID NOT NULL REFERENCES "modulo_app_permisos" ("modulo_app_permiso_id"),
  PRIMARY KEY ("rol_id", "modulo_tenant_id", "modulo_app_permiso_id")
);

-- =============================================================
-- 5. MONEDAS Y MÉTODOS DE PAGO POR TENANT
-- =============================================================

-- Monedas habilitadas por tenant  (era "cliente_moneda")
-- La moneda oficial viene de pais.moneda_oficial_id; aquí no se elige.
CREATE TABLE "tenant_moneda" (
  "tenant_id"      UUID          NOT NULL REFERENCES "tenants" ("tenant_id"),
  "moneda_id"      UUID          NOT NULL REFERENCES "moneda" ("moneda_id"),
  "es_default"     BOOLEAN       DEFAULT false,   -- moneda preseleccionada en el UI
  "habilitada"     BOOLEAN       DEFAULT false,
  "valor_del_dia"  NUMERIC(18,6),                 -- tasa de cambio a la moneda oficial; actualizable en cualquier momento
  "creado_el"      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ,
  PRIMARY KEY ("tenant_id", "moneda_id")
);

-- Métodos de pago habilitados por tenant  (era "metodo_pago_cliente")
CREATE TABLE "tenant_metodo_pago" (
  "tenant_id"      UUID    NOT NULL REFERENCES "tenants" ("tenant_id"),
  "metodo_pago_id" UUID    NOT NULL REFERENCES "metodos_pago" ("metodo_pago_id"),
  "permite_vuelto" BOOLEAN NOT NULL DEFAULT false,
  "habilitada"     BOOLEAN DEFAULT false,
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ,
  PRIMARY KEY ("tenant_id", "metodo_pago_id")
);

-- Orden de aplicación de la fórmula de precio por tenant.
-- precioNeto siempre primero, totalFinal siempre último.
-- Los pasos intermedios (1,2,3) son configurables.
-- Default sembrado al crear tenant: 1=descuentos, 2=recargos, 3=impuestos
CREATE TABLE "tenant_formula_precio" (
  "tenant_id"  UUID     NOT NULL REFERENCES "tenants" ("tenant_id"),
  "paso"       SMALLINT NOT NULL,   -- 1, 2, 3
  "tipo"       TEXT     NOT NULL,   -- 'descuentos' | 'recargos' | 'impuestos'
  PRIMARY KEY ("tenant_id", "paso")
);

-- =============================================================
-- 6. CATÁLOGOS DE REGLAS DE PRECIO POR TENANT
-- =============================================================

CREATE TABLE "categorias" (
  "categoria_id"   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID    NOT NULL REFERENCES "tenants" ("tenant_id"),
  "nombre"         TEXT    NOT NULL,
  "aplica_a"       TEXT    NOT NULL DEFAULT 'ambos',  -- 'productos' | 'servicios' | 'ambos'
  "activo"         BOOLEAN NOT NULL DEFAULT true,
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);

CREATE TABLE "impuestos" (
  "impuesto_id"    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID         NOT NULL REFERENCES "tenants" ("tenant_id"),
  "nombre"         TEXT         NOT NULL,
  "porcentaje"     NUMERIC(7,4) NOT NULL,   -- decimal: 0.19 = 19%
  "activo"         BOOLEAN      NOT NULL DEFAULT true,
  "creado_el"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);

-- Catálogo GLOBAL de tipos de regla (sembrado por el sistema). Una sola tabla con
-- columna discriminadora `clase`. El `codigo` es estable para que el motor de precios
-- (fase 9) ramifique su cálculo. Descuentos/recargos referencian su tipo (FK NOT NULL).
CREATE TABLE "tipos_regla" (
  "tipo_regla_id"  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "clase"          TEXT        NOT NULL,   -- 'descuento' | 'recargo'
  "codigo"         TEXT        NOT NULL UNIQUE,
  "nombre"         TEXT        NOT NULL,
  "descripcion"    TEXT,
  "activo"         BOOLEAN     NOT NULL DEFAULT true,
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);

CREATE TABLE "descuentos" (
  "descuento_id"    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       UUID          NOT NULL REFERENCES "tenants" ("tenant_id"),
  "nombre"          TEXT          NOT NULL,
  "modo"            modo_regla    NOT NULL,
  "valor"           NUMERIC(18,4),            -- null cuando el tipo usa tramos; decimal si modo=porcentaje: 0.10 = 10%
  "tipo_regla_id"   UUID          NOT NULL REFERENCES "tipos_regla" ("tipo_regla_id"),
  "condicion_tipo"  condicion_tipo NOT NULL DEFAULT 'ninguna',
  "condicion_valor" TEXT,
  "fecha_inicio"    DATE,
  "fecha_fin"       DATE,
  "activo"          BOOLEAN       NOT NULL DEFAULT true,
  "creado_el"       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"  TIMESTAMPTZ,
  "eliminado_el"    TIMESTAMPTZ
);

CREATE TABLE "recargos" (
  "recargo_id"      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       UUID          NOT NULL REFERENCES "tenants" ("tenant_id"),
  "nombre"          TEXT          NOT NULL,
  "modo"            modo_regla    NOT NULL,
  "valor"           NUMERIC(18,4),            -- null cuando el tipo usa tramos; decimal si modo=porcentaje: 0.10 = 10%
  "tipo_regla_id"   UUID          NOT NULL REFERENCES "tipos_regla" ("tipo_regla_id"),
  "condicion_tipo"  condicion_tipo NOT NULL DEFAULT 'ninguna',
  "condicion_valor" TEXT,
  "fecha_inicio"    DATE,
  "fecha_fin"       DATE,
  "activo"          BOOLEAN       NOT NULL DEFAULT true,
  "creado_el"       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"  TIMESTAMPTZ,
  "eliminado_el"    TIMESTAMPTZ
);

-- Tramos de descuento (para tipos que usan escalonado por cantidad o monto)
CREATE TABLE "descuento_tramos" (
  "descuento_tramo_id" UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "descuento_id"       UUID          NOT NULL REFERENCES "descuentos" ("descuento_id") ON DELETE CASCADE,
  "minimo"             NUMERIC(18,4) NOT NULL,
  "valor"              NUMERIC(18,4) NOT NULL,
  "orden"              INTEGER       NOT NULL DEFAULT 0,
  "creado_el"          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"     TIMESTAMPTZ,
  "eliminado_el"       TIMESTAMPTZ
);

-- Tramos de recargo (para tipos que usan escalonado por cantidad o monto)
CREATE TABLE "recargo_tramos" (
  "recargo_tramo_id" UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "recargo_id"       UUID          NOT NULL REFERENCES "recargos" ("recargo_id") ON DELETE CASCADE,
  "minimo"           NUMERIC(18,4) NOT NULL,
  "valor"            NUMERIC(18,4) NOT NULL,
  "orden"            INTEGER       NOT NULL DEFAULT 0,
  "creado_el"        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"   TIMESTAMPTZ,
  "eliminado_el"     TIMESTAMPTZ
);

-- Métodos de pago asociados a descuentos (para tipo metodo_pago)
CREATE TABLE "descuento_metodo_pago" (
  "descuento_id"   UUID        NOT NULL REFERENCES "descuentos" ("descuento_id") ON DELETE CASCADE,
  "metodo_pago_id" UUID        NOT NULL REFERENCES "metodos_pago" ("metodo_pago_id") ON DELETE CASCADE,
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ,
  PRIMARY KEY ("descuento_id", "metodo_pago_id")
);

-- Métodos de pago asociados a recargos (para tipo recargo_metodo_pago)
CREATE TABLE "recargo_metodo_pago" (
  "recargo_id"     UUID        NOT NULL REFERENCES "recargos" ("recargo_id") ON DELETE CASCADE,
  "metodo_pago_id" UUID        NOT NULL REFERENCES "metodos_pago" ("metodo_pago_id") ON DELETE CASCADE,
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ,
  PRIMARY KEY ("recargo_id", "metodo_pago_id")
);

-- =============================================================
-- 7. ITEMS (productos y servicios)
-- Modelo: tabla base + extensiones por tipo (escalable a combos, suscripciones, etc.)
-- =============================================================

CREATE TABLE "items" (
  "item_id"                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"               UUID          NOT NULL REFERENCES "tenants" ("tenant_id"),
  "moneda_id"               UUID          NOT NULL REFERENCES "moneda" ("moneda_id"),
  "categoria_id"            UUID          REFERENCES "categorias" ("categoria_id"),
  "nombre"                  TEXT          NOT NULL,
  "descripcion"             TEXT,
  "precio_base"             NUMERIC(18,4) NOT NULL,
  "precio_incluye_impuesto" BOOLEAN       NOT NULL DEFAULT false,
  "activo"                  BOOLEAN       NOT NULL DEFAULT true,
  "tipo"                    TEXT          NOT NULL,   -- 'producto' | 'servicio' | 'suscripcion' | 'receta' | 'ingrediente'
  "creado_el"               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"          TIMESTAMPTZ,
  "eliminado_el"            TIMESTAMPTZ
);

-- Extensión 1:1 para tipo 'producto'
CREATE TABLE "item_producto" (
  "item_id"           UUID          PRIMARY KEY REFERENCES "items" ("item_id"),
  "stock"             NUMERIC(18,4) NOT NULL DEFAULT 0,
  "unidad_medida"     TEXT          NOT NULL DEFAULT 'unidad',
  "fecha_elaboracion" TIMESTAMPTZ,
  "fecha_vencimiento" TIMESTAMPTZ,
  "modo_inventario"   TEXT          NOT NULL DEFAULT 'cantidad',
  -- 'cantidad' (fungible, saldo numérico)
  -- 'lote'     (stock = SUM cantidad_disponible de item_lote)
  -- 'serie'    (stock = COUNT unidades disponibles en item_unidad)
  "costo_actual"      NUMERIC(18,4)
);

-- Extensión 1:1 para tipo 'servicio'
CREATE TABLE "item_servicio" (
  "item_id"           UUID    PRIMARY KEY REFERENCES "items" ("item_id"),
  "duracion_estimada" INTEGER,
  "requiere_cita"     BOOLEAN NOT NULL DEFAULT false
);

-- Extensión 1:1 para tipo 'suscripcion' (no participa de stock/inventario)
CREATE TABLE "item_suscripcion" (
  "item_id"    UUID PRIMARY KEY REFERENCES "items" ("item_id"),
  "frecuencia" TEXT NOT NULL  -- 'semanal' | 'quincenal' | 'mensual'
);

-- Extensión 1:1 para tipo 'receta' (producto compuesto, sin stock propio)
CREATE TABLE "item_receta" (
  "item_id"                  UUID          PRIMARY KEY REFERENCES "items" ("item_id"),
  "costo_actual"             NUMERIC(18,4),
  -- Cacheado al crear/editar; NO se recalcula automáticamente si cambia el
  -- costo de un ingrediente (ver pieza 5 — simulador de impacto de costos).
  "costo_propuesto_omitido"  NUMERIC(18,4)
  -- Snapshot del costo propuesto descartado por el usuario; NULL = sin omisión.
  -- La bandeja oculta la receta mientras el propuesto actual == este valor.
);

-- Ingredientes de una receta (N por receta)
CREATE TABLE "receta_ingredientes" (
  "receta_ingrediente_id" UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              UUID          NOT NULL REFERENCES "tenants" ("tenant_id"),
  "receta_item_id"         UUID          NOT NULL REFERENCES "items" ("item_id"),
  "ingrediente_item_id"    UUID          NOT NULL REFERENCES "items" ("item_id"),
  -- ingrediente_item_id apunta a un item tipo='ingrediente' (extensión item_producto)
  "cantidad"               NUMERIC(18,4) NOT NULL,  -- por 1 unidad de la receta
  "unidad_codigo"          TEXT          NOT NULL REFERENCES "unidades_medida" ("codigo"),
  "bloqueante"             BOOLEAN       NOT NULL DEFAULT true,
  "creado_el"              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"         TIMESTAMPTZ,
  "eliminado_el"           TIMESTAMPTZ
);

-- Un mismo producto no puede aparecer dos veces en la misma receta activa
CREATE UNIQUE INDEX "uq_receta_ingrediente_vivo"
  ON "receta_ingredientes" ("receta_item_id", "ingrediente_item_id")
  WHERE "eliminado_el" IS NULL;

CREATE TABLE "receta_extras_permitidos" (
  "receta_extra_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants" ("tenant_id"),
  "receta_item_id" UUID NOT NULL REFERENCES "items" ("item_id"),
  "ingrediente_item_id" UUID NOT NULL REFERENCES "items" ("item_id"),
  "cantidad" NUMERIC(18,4) NOT NULL,
  "unidad_codigo" TEXT NOT NULL REFERENCES "unidades_medida" ("codigo"),
  "precio_extra" NUMERIC(18,4) NOT NULL,
  "creado_el" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el" TIMESTAMPTZ
);
CREATE UNIQUE INDEX "uq_receta_extra_vivo"
  ON "receta_extras_permitidos" ("receta_item_id", "ingrediente_item_id")
  WHERE "eliminado_el" IS NULL;

ALTER TABLE "cuenta_lineas"
  ADD COLUMN IF NOT EXISTS "personalizacion" JSONB;
ALTER TABLE "venta_detalles"
  ADD COLUMN IF NOT EXISTS "personalizacion" JSONB;

ALTER TABLE "cuenta_lineas"
  ADD COLUMN IF NOT EXISTS "cantidad_presentacion" NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS "unidad_codigo_presentacion" TEXT REFERENCES "unidades_medida" ("codigo");
ALTER TABLE "venta_detalles"
  ADD COLUMN IF NOT EXISTS "cantidad_presentacion" NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS "unidad_codigo_presentacion" TEXT REFERENCES "unidades_medida" ("codigo");

-- Reglas de precio asociadas a cada item (N:M)
CREATE TABLE "item_impuestos" (
  "item_id"     UUID NOT NULL REFERENCES "items" ("item_id") ON DELETE CASCADE,
  "impuesto_id" UUID NOT NULL REFERENCES "impuestos" ("impuesto_id") ON DELETE CASCADE,
  PRIMARY KEY ("item_id", "impuesto_id")
);

CREATE TABLE "item_recargos" (
  "item_id"    UUID NOT NULL REFERENCES "items" ("item_id") ON DELETE CASCADE,
  "recargo_id" UUID NOT NULL REFERENCES "recargos" ("recargo_id") ON DELETE CASCADE,
  PRIMARY KEY ("item_id", "recargo_id")
);

CREATE TABLE "item_descuentos" (
  "item_id"      UUID NOT NULL REFERENCES "items" ("item_id") ON DELETE CASCADE,
  "descuento_id" UUID NOT NULL REFERENCES "descuentos" ("descuento_id") ON DELETE CASCADE,
  PRIMARY KEY ("item_id", "descuento_id")
);

-- Catálogo de causas de merma por tenant (vencimiento, rotura, etc.)
CREATE TABLE "causas_merma" (
  "causa_merma_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID NOT NULL REFERENCES "tenants" ("tenant_id"),
  "nombre"         TEXT NOT NULL,
  "activo"         BOOLEAN NOT NULL DEFAULT true,
  "es_fijo"        BOOLEAN NOT NULL DEFAULT false,
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);
CREATE UNIQUE INDEX "uq_causas_merma_tenant_nombre"
  ON "causas_merma" ("tenant_id", lower("nombre")) WHERE "eliminado_el" IS NULL;

-- Kardex de movimientos de stock (solo items tipo 'producto')
-- item_producto.stock es el saldo materializado; esta tabla es la fuente de verdad auditable.
CREATE TABLE "movimientos_inventario" (
  "movimiento_id"    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        UUID          NOT NULL REFERENCES "tenants" ("tenant_id"),
  "item_id"          UUID          NOT NULL REFERENCES "items" ("item_id"),
  "tipo"             TEXT          NOT NULL,   -- 'entrada' | 'salida' | 'ajuste'
  "motivo"           TEXT          NOT NULL,   -- 'compra' | 'venta' | 'devolucion' | 'merma' | 'ajuste_manual' | 'inventario_inicial'
  "cantidad"         NUMERIC(18,4) NOT NULL,   -- siempre positiva; el tipo define el signo
  "stock_anterior"   NUMERIC(18,4) NOT NULL,
  "stock_resultante" NUMERIC(18,4) NOT NULL,
  "venta_id"         UUID,         -- FK definida después de crear ventas (motivo 'venta'/'devolucion')
  "usuario_id"       UUID          REFERENCES "usuarios" ("usuario_id"),
  "comentario"       TEXT,
  "costo_unitario"   NUMERIC(18,4),
  "causa_merma_id"   UUID REFERENCES "causas_merma" ("causa_merma_id"),
  "creado_el"        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"   TIMESTAMPTZ,
  "eliminado_el"     TIMESTAMPTZ
);

-- Lotes (fuente de verdad de stock en modo 'lote'; metadato en modo 'serie')
-- En modo 'lote': cantidad_disponible es la cantidad real en stock.
-- En modo 'serie': cantidad_inicial y cantidad_disponible son 0 (el lote es solo metadato).
CREATE TABLE "item_lote" (
  "lote_id"              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            UUID          NOT NULL REFERENCES "tenants" ("tenant_id"),
  "item_id"              UUID          NOT NULL REFERENCES "items" ("item_id"),
  "codigo_lote"          TEXT          NOT NULL,
  "fecha_elaboracion"    TIMESTAMPTZ,
  "fecha_vencimiento"    TIMESTAMPTZ,
  "cantidad_inicial"     NUMERIC(18,4) NOT NULL DEFAULT 0,
  "cantidad_disponible"  NUMERIC(18,4) NOT NULL DEFAULT 0,
  "creado_el"            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"       TIMESTAMPTZ,
  "eliminado_el"         TIMESTAMPTZ
);
CREATE UNIQUE INDEX "uq_lote_item_codigo"
  ON "item_lote" ("item_id", "codigo_lote") WHERE "eliminado_el" IS NULL;

-- Unidades serializadas (modo 'serie')
CREATE TABLE "item_unidad" (
  "unidad_id"      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID        NOT NULL REFERENCES "tenants" ("tenant_id"),
  "item_id"        UUID        NOT NULL REFERENCES "items" ("item_id"),
  "lote_id"        UUID        REFERENCES "item_lote" ("lote_id"),
  "serie"          TEXT        NOT NULL,
  "estado"         TEXT        NOT NULL DEFAULT 'disponible',
  -- 'disponible' | 'reservado' | 'vendido' | 'baja'
  "condicion"      TEXT        NOT NULL DEFAULT 'nuevo',
  -- 'nuevo' | 'usado' | 'reacondicionado'
  "garantia_hasta" TIMESTAMPTZ,
  "venta_id"       UUID,       -- FK diferida (se define cuando exista tabla ventas)
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);
CREATE UNIQUE INDEX "uq_unidad_tenant_serie"
  ON "item_unidad" ("tenant_id", "serie") WHERE "eliminado_el" IS NULL;

-- Detalle del movimiento de inventario → qué unidades/lotes entraron o salieron
CREATE TABLE "movimiento_inventario_detalle" (
  "detalle_id"    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "movimiento_id" UUID          NOT NULL REFERENCES "movimientos_inventario" ("movimiento_id"),
  "unidad_id"     UUID          REFERENCES "item_unidad" ("unidad_id"),
  "lote_id"       UUID          REFERENCES "item_lote" ("lote_id"),
  "cantidad"      NUMERIC(18,4) NOT NULL,
  "creado_el"     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- =============================================================
-- 8. CAJAS
-- =============================================================

CREATE TABLE "cajas" (
  "caja_id"        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID          NOT NULL REFERENCES "tenants" ("tenant_id"),
  "usuario_id"     UUID          REFERENCES "usuarios" ("usuario_id"),
  "moneda_id"      UUID          REFERENCES "moneda" ("moneda_id"),
  "tipo"           TEXT          NOT NULL DEFAULT 'fisica',  -- 'fisica' | 'virtual'
  "fecha_apertura" TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "fecha_cierre"   TIMESTAMPTZ,
  "saldo_inicial"  NUMERIC(18,4) NOT NULL DEFAULT 0,
  "saldo_final"    NUMERIC(18,4),
  "monto_contado"  NUMERIC(18,4),   -- monto físico ingresado por el usuario al cerrar
  "diferencia"     NUMERIC(18,4),   -- monto_contado − saldo_esperado
  "estado"         TEXT          NOT NULL DEFAULT 'abierta',  -- 'abierta' | 'cerrada'
  "comentario"     TEXT,
  "creado_el"      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);

CREATE TABLE "movimientos_caja" (
  "movimiento_id"  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  "caja_id"        UUID            NOT NULL REFERENCES "cajas" ("caja_id"),
  "tipo"           tipo_movimiento NOT NULL,
  "concepto"       TEXT            NOT NULL,
  "monto"          NUMERIC(18,4)   NOT NULL,
  "referencia"     TEXT,
  "fecha"          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  "venta_id"       UUID,           -- FK definida después de crear ventas
  "pago_id"        UUID,           -- FK definida después de crear pagos
  "creado_el"      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);

-- =============================================================
-- 9. VENTAS
-- =============================================================

CREATE TABLE "ventas" (
  "venta_id"              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             UUID          NOT NULL REFERENCES "tenants" ("tenant_id"),
  "caja_id"               UUID          REFERENCES "cajas" ("caja_id"),
  "moneda_id"             UUID          NOT NULL REFERENCES "moneda" ("moneda_id"),
  "tipo_documento_id"     UUID          REFERENCES "tipos_documento_tributario" ("tipo_documento_id"),
  "canal"                 TEXT          NOT NULL DEFAULT 'fisico',  -- 'fisico' | 'online'
  "fecha"                 TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "estado"                estado_venta  NOT NULL DEFAULT 'pendiente',
  "total_bruto"           NUMERIC(18,4) NOT NULL DEFAULT 0,
  "total_descuentos"      NUMERIC(18,4) NOT NULL DEFAULT 0,
  "total_recargos"        NUMERIC(18,4) NOT NULL DEFAULT 0,
  "total_impuestos"       NUMERIC(18,4) NOT NULL DEFAULT 0,
  "total_final"           NUMERIC(18,4) NOT NULL DEFAULT 0,
  "venta_referencia_id"   UUID          REFERENCES "ventas" ("venta_id"),  -- para notas de crédito
  "comentario"            TEXT,
  "creado_el"             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"        TIMESTAMPTZ,
  "eliminado_el"          TIMESTAMPTZ
);

CREATE TABLE "venta_detalles" (
  "detalle_id"             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "venta_id"               UUID          NOT NULL REFERENCES "ventas" ("venta_id"),
  "item_id"                UUID          NOT NULL REFERENCES "items" ("item_id"),
  "moneda_id_origen"       UUID          NOT NULL REFERENCES "moneda" ("moneda_id"),
  "precio_unitario_origen" NUMERIC(18,4),
  "tasa_cambio"            NUMERIC(18,4),
  "precio_unitario"        NUMERIC(18,4) NOT NULL,
  "descripcion"            TEXT,
  "cantidad"               NUMERIC(18,4) NOT NULL,
  "subtotal"               NUMERIC(18,4) NOT NULL DEFAULT 0,
  "descuento_aplicado"     NUMERIC(18,4) NOT NULL DEFAULT 0,
  "recargo_aplicado"       NUMERIC(18,4) NOT NULL DEFAULT 0,
  "impuesto_aplicado"      NUMERIC(18,4) NOT NULL DEFAULT 0,
  "total_linea"            NUMERIC(18,4) NOT NULL DEFAULT 0,
  "creado_el"              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"         TIMESTAMPTZ,
  "eliminado_el"           TIMESTAMPTZ
);

-- "aplicado_en": 'detalle' (por línea) | 'venta' (global a toda la venta)
CREATE TABLE "ventas_descuentos" (
  "venta_descuento_id"  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "venta_id"            UUID          NOT NULL REFERENCES "ventas" ("venta_id"),
  "descuento_id"        UUID          NOT NULL REFERENCES "descuentos" ("descuento_id"),
  "valor_aplicado"      NUMERIC(18,4) NOT NULL,
  "porcentaje_aplicado" NUMERIC(7,4),
  "aplicado_en"         TEXT          NOT NULL DEFAULT 'venta',
  "creado_el"           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"      TIMESTAMPTZ,
  "eliminado_el"        TIMESTAMPTZ
);

CREATE TABLE "ventas_recargos" (
  "venta_recargo_id"    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "venta_id"            UUID          NOT NULL REFERENCES "ventas" ("venta_id"),
  "recargo_id"          UUID          NOT NULL REFERENCES "recargos" ("recargo_id"),
  "valor_aplicado"      NUMERIC(18,4) NOT NULL,
  "porcentaje_aplicado" NUMERIC(7,4),
  "aplicado_en"         TEXT          NOT NULL DEFAULT 'venta',
  "creado_el"           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"      TIMESTAMPTZ,
  "eliminado_el"        TIMESTAMPTZ
);

CREATE TABLE "ventas_impuestos" (
  "venta_impuesto_id"   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "venta_id"            UUID          NOT NULL REFERENCES "ventas" ("venta_id"),
  "impuesto_id"         UUID          NOT NULL REFERENCES "impuestos" ("impuesto_id"),
  "valor_aplicado"      NUMERIC(18,4) NOT NULL,
  "porcentaje_aplicado" NUMERIC(7,4),
  "aplicado_en"         TEXT          NOT NULL DEFAULT 'venta',
  "creado_el"           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"      TIMESTAMPTZ,
  "eliminado_el"        TIMESTAMPTZ
);

-- Datos del comprador final en la transacción  (era "venta_cliente_final")
CREATE TABLE "venta_customer" (
  "customer_id"    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "venta_id"       UUID NOT NULL REFERENCES "ventas" ("venta_id"),
  "tercero_id"     UUID REFERENCES "terceros" ("tercero_id"),  -- si es un tercero registrado
  "nombre"         TEXT NOT NULL,
  "rut"            TEXT,
  "direccion"      TEXT,
  "telefono"       TEXT,
  "email"          TEXT,
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);

-- =============================================================
-- 10. PAGOS
-- =============================================================

CREATE TABLE "pagos" (
  "pago_id"           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         UUID          NOT NULL REFERENCES "tenants" ("tenant_id"),
  "venta_id"          UUID          NOT NULL REFERENCES "ventas" ("venta_id"),
  "metodo_pago_id"    UUID          NOT NULL REFERENCES "metodos_pago" ("metodo_pago_id"),
  "moneda_oficial_id" UUID          NOT NULL REFERENCES "moneda" ("moneda_id"),
  "caja_id"           UUID          REFERENCES "cajas" ("caja_id"),
  "monto"             NUMERIC(18,4) NOT NULL,
  "vuelto"            NUMERIC(18,4) NOT NULL DEFAULT 0,
  "fecha"             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "referencia"        TEXT,
  -- Detalle de tarjeta devuelto por la pasarela (Webpay). NULL en pagos manuales/POS.
  "numero_cuotas"     INT,
  "tipo_pago"         VARCHAR,       -- payment_type_code Transbank: VD/VN/VC/SI/S2/NC/VP
  "tarjeta_ultimos4"  VARCHAR(4),
  "creado_el"         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"    TIMESTAMPTZ,
  "eliminado_el"      TIMESTAMPTZ
);

-- FKs diferidas de movimientos_caja (dependen de ventas y pagos)
ALTER TABLE "movimientos_caja" ADD FOREIGN KEY ("venta_id") REFERENCES "ventas" ("venta_id");
ALTER TABLE "movimientos_caja" ADD FOREIGN KEY ("pago_id")  REFERENCES "pagos" ("pago_id");

-- FK diferida de movimientos_inventario (depende de ventas)
ALTER TABLE "movimientos_inventario" ADD FOREIGN KEY ("venta_id") REFERENCES "ventas" ("venta_id");

-- =============================================================
-- 11. SUSCRIPCIONES
-- Alta de cobro recurrente sobre items tipo 'suscripcion'. El primer
-- período se cobra al alta (venta_inicial_id); períodos siguientes no
-- tienen job/cron en esta fase — solo se persiste proximo_cobro.
-- =============================================================

CREATE TABLE "suscripciones" (
  "suscripcion_id"   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        UUID        NOT NULL REFERENCES "tenants" ("tenant_id"),
  "usuario_id"       UUID        NOT NULL REFERENCES "usuarios" ("usuario_id"),
  "item_id"          UUID        NOT NULL REFERENCES "items" ("item_id"),
  "frecuencia"       TEXT        NOT NULL,  -- snapshot del item al suscribirse: 'semanal' | 'quincenal' | 'mensual'
  "dia_mes"          SMALLINT,              -- mensual: 1-28 · quincenal: 1-13 (cobra también dia_mes+15)
  "dia_semana"       SMALLINT,              -- semanal: 0-6 (0 = domingo)
  "estado"           TEXT        NOT NULL DEFAULT 'activa',  -- 'activa' | 'pausada' | 'cancelada'
  "proximo_cobro"    DATE        NOT NULL,
  "activa_hasta"     DATE,                  -- al cancelar: fin del período pagado (= proximo_cobro vigente); usable hasta el día anterior

  "inscripcion_id"   UUID,                  -- tarjeta Oneclick amarrada (pasarela_inscripciones); NULL en filas legacy
  "tarjeta_marca"    TEXT,
  "tarjeta_last4"    TEXT,
  "venta_inicial_id" UUID        REFERENCES "ventas" ("venta_id"),
  "creado_el"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el"   TIMESTAMPTZ,
  "eliminado_el"     TIMESTAMPTZ
);

-- ============================================================
-- Pasarela de pagos (módulo pasarela)
-- ============================================================

CREATE TABLE pasarelas (
    pasarela_id UUID PRIMARY KEY,
    codigo VARCHAR NOT NULL UNIQUE,
    nombre VARCHAR NOT NULL,
    soporta_tokenizacion BOOLEAN NOT NULL DEFAULT FALSE,
    soporta_cobro_recurrente BOOLEAN NOT NULL DEFAULT FALSE,
    soporta_mall BOOLEAN NOT NULL DEFAULT FALSE,
    url_produccion VARCHAR NOT NULL,
    url_pruebas VARCHAR NOT NULL,
    configuracion_produccion TEXT, -- blob cifrado AES-256-GCM 'v1:iv:tag:data'
    configuracion_pruebas TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);

CREATE TABLE tenant_pasarela (
    tenant_pasarela_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    pasarela_id UUID NOT NULL REFERENCES pasarelas(pasarela_id),
    ambiente VARCHAR NOT NULL, -- 'pruebas' | 'produccion'
    modo_integracion VARCHAR NOT NULL, -- 'mall' | 'individual'
    configuracion TEXT, -- blob cifrado
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    prioridad INTEGER NOT NULL DEFAULT 1,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);

CREATE TABLE pasarela_api_keys (
    api_key_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    nombre VARCHAR NOT NULL,
    prefijo VARCHAR NOT NULL,
    key_hash VARCHAR NOT NULL UNIQUE, -- SHA-256 hex; la key nunca se persiste
    ultimo_uso_el TIMESTAMPTZ,
    revocada_el TIMESTAMPTZ,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);

CREATE TABLE pasarela_inscripciones (
    inscripcion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    tenant_pasarela_id UUID NOT NULL REFERENCES tenant_pasarela(tenant_pasarela_id),
    pagador_ref VARCHAR(100) NOT NULL, -- opaco, lo aporta la app consumidora
    identificador_externo TEXT, -- tbkUser cifrado
    identificador_usuario_externo VARCHAR NOT NULL, -- username generado ('insc-…')
    estado VARCHAR NOT NULL DEFAULT 'pendiente', -- pendiente|activa|fallida|eliminada
    preferida BOOLEAN NOT NULL DEFAULT false, -- solo una por tenant+pagador
    token_proveedor VARCHAR, -- token temporal del start (un solo uso)
    url_retorno_app VARCHAR NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);
CREATE INDEX idx_pasarela_inscripciones_pagador ON pasarela_inscripciones (tenant_id, pagador_ref);
CREATE INDEX idx_pasarela_inscripciones_token ON pasarela_inscripciones (token_proveedor);

CREATE TABLE pasarela_medios_pago (
    medio_pago_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inscripcion_id UUID NOT NULL REFERENCES pasarela_inscripciones(inscripcion_id),
    tipo VARCHAR NOT NULL, -- TARJETA_CREDITO | TARJETA_DEBITO | TARJETA | ...
    marca VARCHAR,
    ultimos_4 VARCHAR(4) NOT NULL,
    fecha_expiracion VARCHAR,
    token_externo TEXT, -- cifrado (proveedores con token por tarjeta)
    estado VARCHAR NOT NULL DEFAULT 'activo', -- activo | eliminado
    metadata JSONB NOT NULL DEFAULT '{}',
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);

CREATE TABLE pasarela_ordenes (
    orden_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    pagador_ref VARCHAR(100),
    referencia_externa VARCHAR, -- correlación libre de apps externas (vía API key)
    venta_id UUID, -- venta materializada por callback in-process (vínculo interno, sin FK física)
    codigo_orden VARCHAR NOT NULL UNIQUE, -- buyOrder generado, ≤26 chars
    descripcion VARCHAR NOT NULL,
    monto NUMERIC(18,6) NOT NULL,
    moneda VARCHAR(3) NOT NULL,
    estado VARCHAR NOT NULL DEFAULT 'creada', -- creada|en_proceso|procesando|pagada|fallida|expirada|reembolsada
    fecha_expiracion TIMESTAMPTZ,
    token_proveedor VARCHAR, -- token del proveedor en flujos redirect (Webpay Plus); claim transitorio 'procesando'
    origen VARCHAR NOT NULL, -- 'interno' | 'api'
    api_key_id UUID REFERENCES pasarela_api_keys(api_key_id),
    metadata JSONB NOT NULL DEFAULT '{}',
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);

CREATE TABLE pasarela_transacciones (
    transaccion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    orden_id UUID REFERENCES pasarela_ordenes(orden_id), -- NULL para INSCRIPTION
    tenant_pasarela_id UUID NOT NULL REFERENCES tenant_pasarela(tenant_pasarela_id),
    inscripcion_id UUID REFERENCES pasarela_inscripciones(inscripcion_id),
    medio_pago_id UUID REFERENCES pasarela_medios_pago(medio_pago_id),
    transaccion_padre_id UUID REFERENCES pasarela_transacciones(transaccion_id),
    tipo VARCHAR NOT NULL, -- INSCRIPTION|AUTHORIZATION|CAPTURE|REVERSAL|REFUND|RECURRENT_PAYMENT
    estado VARCHAR NOT NULL, -- iniciada|aprobada|rechazada|error (inmutable una vez terminal)
    monto NUMERIC(18,6),
    moneda VARCHAR(3),
    codigo_orden VARCHAR,
    codigo_autorizacion VARCHAR,
    identificador_transaccion_externo VARCHAR,
    codigo_respuesta VARCHAR,
    tipo_pago VARCHAR,
    numero_cuotas INTEGER,
    monto_cuota NUMERIC(18,6),
    request JSONB NOT NULL DEFAULT '{}', -- redactado: nunca credenciales/tokens en claro
    response JSONB NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    fecha_transaccion TIMESTAMPTZ NOT NULL,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);
-- Idempotencia: una transacción externa no puede registrarse dos veces
CREATE UNIQUE INDEX idx_pasarela_tx_externo
    ON pasarela_transacciones (tenant_pasarela_id, identificador_transaccion_externo)
    WHERE identificador_transaccion_externo IS NOT NULL;
-- Visibilidad de reembolsos en ventas: agregados de REFUND por venta vinculada
CREATE INDEX idx_pasarela_ordenes_venta ON pasarela_ordenes (venta_id);
CREATE INDEX idx_pasarela_tx_orden ON pasarela_transacciones (orden_id);

-- Módulo de cron: registro de ejecuciones de jobs internos del sistema.
-- Sin tenant_id: los jobs recorren todos los tenants.
CREATE TABLE cron_ejecuciones (
    ejecucion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job VARCHAR NOT NULL,                       -- nombre estable, ej. 'expirar-ordenes'
    iniciado_el TIMESTAMPTZ NOT NULL,
    finalizado_el TIMESTAMPTZ,                  -- null mientras corre
    estado VARCHAR NOT NULL DEFAULT 'en_curso', -- 'en_curso' | 'ok' | 'error'
    detalle TEXT,                               -- resumen del resultado
    error TEXT,                                 -- mensaje si falló
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);
CREATE INDEX idx_cron_ejecuciones_job ON cron_ejecuciones (job);

-- ============================================================================
-- Módulo Salones y Mesas (restaurante)
-- ============================================================================

-- Salón: agrupación física de mesas dentro del local del tenant.
CREATE TABLE salones (
    salon_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    nombre TEXT NOT NULL,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);

-- Mesa: posicionada en el plano del salón. pos_x/pos_y son fracción 0..1 del
-- contenedor (plano responsivo). El estado libre/ocupada es DERIVADO de las
-- cuentas abiertas, no se almacena.
CREATE TABLE mesas (
    mesa_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    salon_id UUID NOT NULL REFERENCES salones(salon_id),
    nombre TEXT NOT NULL,
    pos_x NUMERIC(6,5) NOT NULL DEFAULT 0,
    pos_y NUMERIC(6,5) NOT NULL DEFAULT 0,
    forma TEXT NOT NULL DEFAULT 'cuadrada', -- redonda | cuadrada | rectangular
    tamano TEXT NOT NULL DEFAULT 'mediano', -- pequeno | mediano | grande | extra_grande
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);
CREATE INDEX idx_mesas_salon ON mesas (salon_id);

-- Cuenta: consumo de una mesa. Una mesa puede tener varias cuentas abiertas.
-- numero es correlativo por mesa, calculado solo entre las cuentas 'abierta' de
-- esa mesa ("Cuenta 1", "Cuenta 2"...): se reinicia en 1 cuando la mesa queda
-- completamente libre, no es un correlativo histórico. Al cerrar genera una
-- venta (venta_id) reusando el motor de ventas; cancelar la anula sin venta.
-- Garzón: identidad operativa liviana del tenant (NO es un usuario del sistema).
-- Se identifica por un PIN de 6 dígitos hasheado (bcrypt) para registrar quién
-- abre/cierra cada cuenta en dispositivos compartidos.
CREATE TABLE garzones (
    garzon_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    nombre VARCHAR(100) NOT NULL,
    pin_hash TEXT NOT NULL, -- bcrypt del PIN; nunca se expone por la API
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);
CREATE INDEX idx_garzones_tenant ON garzones (tenant_id);

CREATE TABLE turnos (
    turno_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    nombre VARCHAR(100) NOT NULL,
    hora_inicio VARCHAR(5) NOT NULL, -- HH:mm referencial
    hora_fin VARCHAR(5) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);
CREATE INDEX idx_turnos_tenant ON turnos (tenant_id);

CREATE TABLE sesiones_garzon (
    sesion_garzon_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    garzon_id UUID NOT NULL REFERENCES garzones(garzon_id),
    turno_id UUID NOT NULL REFERENCES turnos(turno_id),
    inicio_el TIMESTAMPTZ NOT NULL,
    fin_el TIMESTAMPTZ,
    estado TEXT NOT NULL DEFAULT 'abierta', -- abierta|cerrada
    origen_cierre TEXT, -- pin|admin
    cerrada_por_usuario_id UUID REFERENCES usuarios(usuario_id),
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);
CREATE INDEX idx_sesiones_garzon_tenant ON sesiones_garzon (tenant_id);
CREATE INDEX idx_sesiones_garzon_garzon ON sesiones_garzon (garzon_id);
CREATE UNIQUE INDEX uq_sesion_garzon_abierta
  ON sesiones_garzon (tenant_id, garzon_id)
  WHERE estado = 'abierta' AND eliminado_el IS NULL;

CREATE TABLE cuentas (
    cuenta_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    mesa_id UUID NOT NULL REFERENCES mesas(mesa_id),
    numero INTEGER NOT NULL,
    nombre TEXT,
    estado TEXT NOT NULL DEFAULT 'abierta', -- abierta|cerrada|cancelada
    venta_id UUID REFERENCES ventas(venta_id), -- set al cerrar
    garzon_apertura_id UUID REFERENCES garzones(garzon_id), -- garzón que abrió
    garzon_cierre_id UUID REFERENCES garzones(garzon_id),   -- garzón que cerró
    abierta_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cerrada_el TIMESTAMPTZ,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);
CREATE INDEX idx_cuentas_mesa ON cuentas (mesa_id);

-- Línea de cuenta: producto acumulado mientras la cuenta está abierta. El
-- precio se resuelve al cerrar (igual que ventas), no se snapshotea aquí.
CREATE TABLE cuenta_lineas (
    cuenta_linea_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    cuenta_id UUID NOT NULL REFERENCES cuentas(cuenta_id),
    item_id UUID NOT NULL REFERENCES items(item_id),
    cantidad NUMERIC(18,4) NOT NULL,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);
CREATE INDEX idx_cuenta_lineas_cuenta ON cuenta_lineas (cuenta_id);

-- cuenta_lineas.cantidad_enviada: cuánto de `cantidad` ya se imprimió en comanda.
-- El diff (cantidad - cantidad_enviada) es lo que se envía en el próximo POST.
ALTER TABLE cuenta_lineas
    ADD COLUMN cantidad_enviada NUMERIC(18,4) NOT NULL DEFAULT 0;


-- =============================================================
-- IMPRESORAS TÉRMICAS (comandas, precuenta, boleta)
-- =============================================================

-- Impresora térmica del tenant. La impresión real ocurre en el navegador vía
-- QZ Tray; esta tabla solo guarda cómo alcanzarla (red TCP raw o cola del SO).
CREATE TABLE impresoras (
    impresora_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(tenant_id),
    nombre        VARCHAR(100) NOT NULL,
    rol           TEXT NOT NULL,   -- 'comanda' | 'boleta'
    tipo_conexion TEXT NOT NULL,   -- 'red' | 'sistema'
    host          VARCHAR(255),
    puerto        INTEGER,
    nombre_cola   VARCHAR(100),
    activo        BOOLEAN NOT NULL DEFAULT true,
    creado_el     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el  TIMESTAMPTZ
);
CREATE INDEX idx_impresoras_tenant ON impresoras (tenant_id);

-- categorias gana impresora_id: rutea los ítems de la categoría a una
-- impresora de rol 'comanda' al enviar comanda.
ALTER TABLE "categorias"
    ADD COLUMN impresora_id UUID REFERENCES impresoras(impresora_id);
