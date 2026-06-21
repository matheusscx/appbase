-- =============================================================
-- SEED DATA — SaaS POS Multi-tenant
-- =============================================================
-- Secciones:
--   [GLOBAL]      Datos del sistema, compartidos por todos los tenants.
--                 Deben existir en producción.
--   [DESARROLLO]  Datos de prueba. Solo para entorno local/dev.
-- =============================================================

-- =============================================================
-- [GLOBAL] 1. PAÍSES
-- moneda_oficial_id se actualiza después de insertar monedas
-- =============================================================

INSERT INTO "pais" ("pais_id", "nombre", "codigo_iso", "zona_horaria_principal") VALUES
  ('550e8400-e29b-41d4-a716-446655440000', 'Chile', 'CL', 'America/Santiago');

-- =============================================================
-- [GLOBAL] 2. MONEDAS
-- =============================================================

INSERT INTO "moneda" ("moneda_id", "nombre", "codigo_iso", "codigo_numero", "simbolo", "decimales") VALUES
  ('550e8400-e29b-41d4-a716-446655440003', 'Peso Chileno',           'CLP', '152', '$', 0),
  ('550e8400-e29b-41d4-a716-446655440004', 'Unidad de Fomento',      'UF',  '990', '$', 4),
  ('550e8400-e29b-41d4-a716-446655440005', 'Dólar Estadounidense',   'USD', '840', '$', 2);

-- Asignar moneda oficial a cada país
UPDATE "pais" SET "moneda_oficial_id" = '550e8400-e29b-41d4-a716-446655440003'
  WHERE "pais_id" = '550e8400-e29b-41d4-a716-446655440000'; -- Chile → CLP

-- =============================================================
-- [GLOBAL] 3. PROVINCIAS
-- =============================================================

INSERT INTO "provincia" ("provincia_id", "pais_id", "nombre", "zona_horaria") VALUES
  ('550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440000', 'Región Metropolitana', 'America/Santiago'),
  ('550e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440000', 'Isla de Pascua',       'Pacific/Easter');

-- =============================================================
-- [GLOBAL] 4. MÉTODOS DE PAGO
-- =============================================================

INSERT INTO "metodos_pago" ("metodo_pago_id", "nombre", "abreviatura", "activo") VALUES
  ('30ef8cd8-8e17-48fd-8093-76a170202cda', 'Efectivo',             'EF',  true),
  ('81fb39b9-fe82-48da-9f37-79f3c4fcd29b', 'Tarjeta de Crédito',  'TC',  true),
  ('0ac14322-3f7a-479d-94d7-a0a9c51355e6', 'Tarjeta de Débito',   'TD',  true),
  ('11f7a34b-3456-40bc-9529-49dba452d1d0', 'Transferencia Bancaria', 'TRF', true),
  ('8e00e6ec-b95e-42f0-80cf-425dc84dd827', 'Cheque',               'CHQ', true),
  ('94b0dc91-7cf5-4d9d-8ccd-dc3fcfb630be', 'PayPal',               'PP',  true),
  ('a0481ece-fc34-4b52-a381-9825941fcecc', 'WebPay',               'WP',  true),
  ('36830263-c5bc-4b2c-b9d8-cf72514079db', 'MercadoPago',          'MP',  true);

-- =============================================================
-- [GLOBAL] 5. MÓDULOS DE LA APP
-- =============================================================

INSERT INTO "modulos_app" ("modulo_app_id", "nombre", "descripcion", "url", "icono", "tiene_configuracion") VALUES
  ('550e8400-e29b-41d4-a716-446655440010', 'Facturación', 'Gestión de facturas, boletas y documentos tributarios', '/facturacion', 'mdi-file-document-multiple-outline', false),
  ('550e8400-e29b-41d4-a716-446655440011', 'Caja',        'Gestión de pagos, cobranzas y flujo de caja',          '/caja',        'mdi-cash-register',                  false);

-- =============================================================
-- [GLOBAL] 6. PERMISOS
-- =============================================================

INSERT INTO "permisos" ("permiso_id", "nombre", "descripcion") VALUES
  ('550e8400-e29b-41d4-a716-446655440012', 'Leer',        'Visualizar y consultar registros'),
  ('550e8400-e29b-41d4-a716-446655440013', 'Crear',       'Crear nuevos registros'),
  ('550e8400-e29b-41d4-a716-446655440014', 'Actualizar',  'Modificar registros existentes'),
  ('550e8400-e29b-41d4-a716-446655440015', 'Eliminar',    'Eliminar registros');

-- =============================================================
-- [GLOBAL] 7. PERMISOS POR MÓDULO
-- =============================================================

INSERT INTO "modulo_app_permisos" ("modulo_app_permiso_id", "modulo_app_id", "permiso_id") VALUES
  -- Facturación: todos los permisos
  ('550e8400-e29b-41d4-a716-446655440030', '550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440012'),
  ('550e8400-e29b-41d4-a716-446655440031', '550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440013'),
  ('550e8400-e29b-41d4-a716-446655440032', '550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440014'),
  ('550e8400-e29b-41d4-a716-446655440033', '550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440015'),
  -- Caja: todos los permisos
  ('550e8400-e29b-41d4-a716-446655440034', '550e8400-e29b-41d4-a716-446655440011', '550e8400-e29b-41d4-a716-446655440012'),
  ('550e8400-e29b-41d4-a716-446655440035', '550e8400-e29b-41d4-a716-446655440011', '550e8400-e29b-41d4-a716-446655440013'),
  ('550e8400-e29b-41d4-a716-446655440036', '550e8400-e29b-41d4-a716-446655440011', '550e8400-e29b-41d4-a716-446655440014'),
  ('550e8400-e29b-41d4-a716-446655440037', '550e8400-e29b-41d4-a716-446655440011', '550e8400-e29b-41d4-a716-446655440015');

-- =============================================================
-- [GLOBAL] 8. TIPOS DE DOCUMENTO TRIBUTARIO — Chile
-- =============================================================

INSERT INTO "tipos_documento_tributario" ("tipo_documento_id", "pais_id", "nombre", "codigo", "descripcion") VALUES
  (gen_random_uuid(), '550e8400-e29b-41d4-a716-446655440000', 'Boleta',         '39',  'Boleta electrónica de venta'),
  (gen_random_uuid(), '550e8400-e29b-41d4-a716-446655440000', 'Factura',        '33',  'Factura electrónica'),
  (gen_random_uuid(), '550e8400-e29b-41d4-a716-446655440000', 'Nota de Crédito','61',  'Nota de crédito electrónica'),
  (gen_random_uuid(), '550e8400-e29b-41d4-a716-446655440000', 'Nota de Débito', '56',  'Nota de débito electrónica');

-- =============================================================
-- [DESARROLLO] Tenant, usuario y datos de prueba
-- NO usar en producción
-- =============================================================

INSERT INTO "tenants" ("tenant_id", "provincia_id", "nombre", "correo", "telefono", "direccion") VALUES
  ('550e8400-e29b-41d4-a716-446655440007', '550e8400-e29b-41d4-a716-446655440001', 'Paris', 'contacto@paris.cl', '+56226005000', 'Av. Presidente Kennedy 9001, Las Condes, Santiago');

INSERT INTO "usuarios" ("usuario_id", "nombre_usuario", "contrasena", "nombre", "apellido", "telefono", "correo", "es_superadmin") VALUES
  ('550e8400-e29b-41d4-a716-446655440019', 'admin', '$2b$10$3G96idl/t9r9MspBYfSG0emDgoeSpmBRiW0yHlrUwkImlhXmuI1qW', 'Admin', 'Sistema', '123456789', 'admin@sistema.com', true);

INSERT INTO "usuarios_tenants" ("usuario_id", "tenant_id") VALUES
  ('550e8400-e29b-41d4-a716-446655440019', '550e8400-e29b-41d4-a716-446655440007');

-- Rol admin fijo del tenant (es_fijo = true)
INSERT INTO "roles" ("rol_id", "tenant_id", "nombre", "descripcion", "es_fijo") VALUES
  ('550e8400-e29b-41d4-a716-446655440018', '550e8400-e29b-41d4-a716-446655440007', 'Administrador', 'Acceso completo a todos los módulos', true);

INSERT INTO "roles_usuarios" ("usuario_id", "tenant_id", "rol_id") VALUES
  ('550e8400-e29b-41d4-a716-446655440019', '550e8400-e29b-41d4-a716-446655440007', '550e8400-e29b-41d4-a716-446655440018');

-- Módulo Caja contratado por el tenant de prueba
INSERT INTO "tenant_modulos" ("modulo_tenant_id", "tenant_id", "modulo_app_id", "estado", "expira_en") VALUES
  ('550e8400-e29b-41d4-a716-446655440023', '550e8400-e29b-41d4-a716-446655440007', '550e8400-e29b-41d4-a716-446655440011', 'activo', '2026-12-31 23:59:59');

-- Fórmula de precio por defecto del tenant (neto → descuentos → recargos → impuestos)
INSERT INTO "tenant_formula_precio" ("tenant_id", "paso", "tipo") VALUES
  ('550e8400-e29b-41d4-a716-446655440007', 1, 'descuentos'),
  ('550e8400-e29b-41d4-a716-446655440007', 2, 'recargos'),
  ('550e8400-e29b-41d4-a716-446655440007', 3, 'impuestos');

-- Monedas habilitadas para el tenant de prueba (CLP oficial por país, UF y USD adicionales)
INSERT INTO "tenant_moneda" ("tenant_id", "moneda_id", "es_default", "habilitada", "valor_del_dia") VALUES
  ('550e8400-e29b-41d4-a716-446655440007', '550e8400-e29b-41d4-a716-446655440003', true,  true,  1.0000),        -- CLP (moneda oficial, tasa 1)
  ('550e8400-e29b-41d4-a716-446655440007', '550e8400-e29b-41d4-a716-446655440004', false, true,  39360.3200),    -- UF
  ('550e8400-e29b-41d4-a716-446655440007', '550e8400-e29b-41d4-a716-446655440005', false, false, 966.5000);      -- USD (deshabilitada)

-- Métodos de pago habilitados para el tenant de prueba
INSERT INTO "tenant_metodo_pago" ("tenant_id", "metodo_pago_id", "permite_vuelto", "habilitada") VALUES
  ('550e8400-e29b-41d4-a716-446655440007', '30ef8cd8-8e17-48fd-8093-76a170202cda', true,  true),   -- Efectivo (permite vuelto)
  ('550e8400-e29b-41d4-a716-446655440007', '81fb39b9-fe82-48da-9f37-79f3c4fcd29b', false, true),   -- Tarjeta de Crédito
  ('550e8400-e29b-41d4-a716-446655440007', '0ac14322-3f7a-479d-94d7-a0a9c51355e6', false, true),   -- Tarjeta de Débito
  ('550e8400-e29b-41d4-a716-446655440007', '11f7a34b-3456-40bc-9529-49dba452d1d0', false, true);   -- Transferencia

-- =============================================================
-- [DESARROLLO] Segundo tenant de prueba — Falabella
-- =============================================================

INSERT INTO "tenants" ("tenant_id", "provincia_id", "nombre", "correo", "telefono", "direccion") VALUES
  ('550e8400-e29b-41d4-a716-446655440040', '550e8400-e29b-41d4-a716-446655440001', 'Falabella', 'contacto@falabella.cl', '+56226007000', 'Av. Presidente Kennedy 6400, Las Condes, Santiago');

INSERT INTO "usuarios_tenants" ("usuario_id", "tenant_id") VALUES
  ('550e8400-e29b-41d4-a716-446655440019', '550e8400-e29b-41d4-a716-446655440040');

INSERT INTO "roles" ("rol_id", "tenant_id", "nombre", "descripcion", "es_fijo") VALUES
  ('550e8400-e29b-41d4-a716-446655440041', '550e8400-e29b-41d4-a716-446655440040', 'Administrador', 'Acceso completo a todos los módulos', true);

INSERT INTO "roles_usuarios" ("usuario_id", "tenant_id", "rol_id") VALUES
  ('550e8400-e29b-41d4-a716-446655440019', '550e8400-e29b-41d4-a716-446655440040', '550e8400-e29b-41d4-a716-446655440041');

-- Módulos contratados por Falabella (Facturación y Caja)
INSERT INTO "tenant_modulos" ("modulo_tenant_id", "tenant_id", "modulo_app_id", "estado", "expira_en") VALUES
  ('550e8400-e29b-41d4-a716-446655440042', '550e8400-e29b-41d4-a716-446655440040', '550e8400-e29b-41d4-a716-446655440010', 'activo', '2026-12-31 23:59:59'),
  ('550e8400-e29b-41d4-a716-446655440043', '550e8400-e29b-41d4-a716-446655440040', '550e8400-e29b-41d4-a716-446655440011', 'activo', '2026-12-31 23:59:59');

INSERT INTO "tenant_formula_precio" ("tenant_id", "paso", "tipo") VALUES
  ('550e8400-e29b-41d4-a716-446655440040', 1, 'descuentos'),
  ('550e8400-e29b-41d4-a716-446655440040', 2, 'recargos'),
  ('550e8400-e29b-41d4-a716-446655440040', 3, 'impuestos');

INSERT INTO "tenant_moneda" ("tenant_id", "moneda_id", "es_default", "habilitada", "valor_del_dia") VALUES
  ('550e8400-e29b-41d4-a716-446655440040', '550e8400-e29b-41d4-a716-446655440003', true,  true,  1.0000),
  ('550e8400-e29b-41d4-a716-446655440040', '550e8400-e29b-41d4-a716-446655440004', false, true,  39360.3200),
  ('550e8400-e29b-41d4-a716-446655440040', '550e8400-e29b-41d4-a716-446655440005', false, false, 966.5000);

INSERT INTO "tenant_metodo_pago" ("tenant_id", "metodo_pago_id", "permite_vuelto", "habilitada") VALUES
  ('550e8400-e29b-41d4-a716-446655440040', '30ef8cd8-8e17-48fd-8093-76a170202cda', true,  true),
  ('550e8400-e29b-41d4-a716-446655440040', '81fb39b9-fe82-48da-9f37-79f3c4fcd29b', false, true),
  ('550e8400-e29b-41d4-a716-446655440040', '0ac14322-3f7a-479d-94d7-a0a9c51355e6', false, true),
  ('550e8400-e29b-41d4-a716-446655440040', '11f7a34b-3456-40bc-9529-49dba452d1d0', false, true);
