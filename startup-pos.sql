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
  "simbolo"        VARCHAR(5),
  "decimales"      SMALLINT    DEFAULT 0,
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);

ALTER TABLE "pais" ADD FOREIGN KEY ("moneda_oficial_id") REFERENCES "moneda" ("moneda_id");

-- Documentos tributarios válidos por país (boleta, factura, nota de crédito, etc.)
-- Cada país define sus propios tipos; no es un enum fijo.
CREATE TABLE "tipos_documento_tributario" (
  "tipo_documento_id" UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "pais_id"           UUID        NOT NULL REFERENCES "pais" ("pais_id"),
  "nombre"            VARCHAR(100) NOT NULL,
  "codigo"            VARCHAR(20),   -- código tributario local (ej. '33' = Factura en Chile)
  "descripcion"       TEXT,
  "activo"            BOOLEAN     NOT NULL DEFAULT true,
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

CREATE TABLE "descuentos" (
  "descuento_id"    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       UUID          NOT NULL REFERENCES "tenants" ("tenant_id"),
  "nombre"          TEXT          NOT NULL,
  "modo"            modo_regla    NOT NULL,
  "valor"           NUMERIC(18,4) NOT NULL,   -- decimal si modo=porcentaje: 0.10 = 10%
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
  "valor"           NUMERIC(18,4) NOT NULL,   -- decimal si modo=porcentaje: 0.10 = 10%
  "condicion_tipo"  condicion_tipo NOT NULL DEFAULT 'ninguna',
  "condicion_valor" TEXT,
  "fecha_inicio"    DATE,
  "fecha_fin"       DATE,
  "activo"          BOOLEAN       NOT NULL DEFAULT true,
  "creado_el"       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"  TIMESTAMPTZ,
  "eliminado_el"    TIMESTAMPTZ
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
  "tipo"                    TEXT          NOT NULL,   -- 'producto' | 'servicio'
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
  "fecha_vencimiento" TIMESTAMPTZ
);

-- Extensión 1:1 para tipo 'servicio'
CREATE TABLE "item_servicio" (
  "item_id"           UUID    PRIMARY KEY REFERENCES "items" ("item_id"),
  "duracion_estimada" INTEGER,
  "requiere_cita"     BOOLEAN NOT NULL DEFAULT false
);

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
  "creado_el"         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"    TIMESTAMPTZ,
  "eliminado_el"      TIMESTAMPTZ
);

-- FKs diferidas de movimientos_caja (dependen de ventas y pagos)
ALTER TABLE "movimientos_caja" ADD FOREIGN KEY ("venta_id") REFERENCES "ventas" ("venta_id");
ALTER TABLE "movimientos_caja" ADD FOREIGN KEY ("pago_id")  REFERENCES "pagos" ("pago_id");
