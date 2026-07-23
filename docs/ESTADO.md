# Estado actual del proyecto

Estado de todas las funcionalidades del SaaS POS multi-tenant. **Mantener esta tabla
al implementar o cambiar una feature** (ver "Documentación viva" en [`CLAUDE.md`](../CLAUDE.md)).
Cada feature ✅ tiene su doc operativa en [`features/`](./features/).

| Funcionalidad | Estado |
|---|---|
| Login (JWT access + refresh) | ✅ Implementado |
| Flujo multi-tenant en frontend (selección de tenant) | ✅ Implementado |
| Configuración — perfil de usuario (nombre, teléfono, contraseña) | ✅ Implementado |
| Perfil multi-tenant (pantallas de gestión) | 🔲 Por construir |
| Configuración — Roles y Permisos (RBAC: roles, matriz de permisos, asignación a usuarios) | ✅ Implementado |
| RBAC — gestión de módulos contratados (superadmin) | 🔲 Por construir |
| Gestión de tenants y razones sociales | ✅ Implementado |
| Terceros (proveedores, empresas) + selector en el POS | ✅ Implementado (2026-07-04) |
| Catálogos base (país, provincia, moneda) | 🔲 Por construir |
| Configuración de monedas por tenant | ✅ Implementado |
| Configuración — Preferencias financieras (cálculo de descuentos/recargos, fórmula de precios) | ✅ Implementado |
| Catálogos financieros (categorías, impuestos, descuentos, recargos, métodos de pago, tipos de regla) | ✅ Implementado |
| Descuentos y recargos — formularios dinámicos por tipo de regla (tramos, métodos de pago, días) | ✅ Implementado (2026-06-27) |
| Catálogo de items (productos y servicios) | ✅ Implementado |
| Gestión de inventario (kardex de movimientos de stock) | ✅ Implementado |
| Inventario serializado (modo `serie`) y por lote (modo `lote`) | ✅ Implementado (2026-06-28) |
| Costo por producto (último costo) + congelado en kardex | ✅ Implementado (2026-07-14) |
| Conversión de unidades de medida (catálogo global + conversión en movimientos) | ✅ Implementado (2026-07-14) |
| Tipo item ingrediente (insumos no vendibles) | ✅ Implementado (2026-07-15) |
| Recetas + criticidad de ingredientes (bloqueante/no bloqueante) | ✅ Implementado (2026-07-15) |
| Personalización de recetas antes del carrito (omitir, extras, comentario; POS + Salones) | ✅ Implementado (2026-07-16) |
| Cantidad con unidad de presentación en carrito (POS / Salones / Online; `AppCantidadInput`, tickets e historial) | ✅ Implementado (2026-07-16) |
| Mermas tipificadas y valorizadas | ✅ Implementado (2026-07-15) |
| Simulador de impacto de costos (desfase recetas, aplicar/descartar) | ✅ Implementado (2026-07-15) |
| Motor de cálculo de precios | ✅ Implementado (2026-06-28) |
| Procesamiento de ventas (canal físico, pagos inline, vuelto) | ✅ Implementado (2026-06-29) |
| Gestión de cajas | ✅ Implementado |
| Registro de pagos | ✅ Implementado (inline con ventas, 2026-06-29) |
| Frontend POS (crear venta: catálogo, carrito, cobro multipago, fricción por documento) | ✅ Implementado (2026-06-29) |
| Frontend — historial/consulta de ventas | ✅ Implementado (2026-06-30) |
| Módulo de Pagos (GET /pagos, POST /pagos, abono a ventas pendientes, ledger) | ✅ Implementado (2026-06-30) |
| Tienda Online (canal online, checkout dummy, catálogo/carrito, medios de pago mock) | ✅ Implementado (2026-07-05) |
| Suscripciones (tipo de item suscripcion, alta con primer cobro, gestión) | ✅ Implementado (2026-07-05) |
| Suscripciones — administración (módulo RBAC propio, vigencia `activa_hasta`, "Mis suscripciones") | ✅ Implementado (2026-07-06) |
| Pasarela de pagos (Oneclick real, API keys m2m, cifrado de credenciales, admin UI) | ✅ Implementado (2026-07-08) |
| Pasarela — Webpay Plus Mall (pago único con redirect: crear→confirmar, reembolso y verificación) | ✅ Implementado (2026-07-08) |
| Tienda Online — checkout por Webpay Plus real (orden con snapshot, venta creada por callback in-process, fallback a página simulada) | ✅ Implementado (2026-07-09) |
| Pasarela — reorganización UI: config (Mis pasarelas + API Keys) en `/configuracion/pasarelas`; Órdenes como módulo propio del nav en `/ordenes`, con filtros (estado, origen, rango de fechas), buscador y drawer de detalle con historial de transacciones | ✅ Implementado (2026-07-10) |
| Pasarela — reembolso (total/parcial) de órdenes `pagada`/`conciliada` desde el drawer de Órdenes, endpoint interno JWT + permiso RBAC dedicado `Pasarelas:Reembolsar` | ✅ Implementado (2026-07-10) |
| Reembolsos — nota de crédito interna elegible (doc tipo 61 sin SII, `venta_referencia_id`) + devolución de stock elegible (modo `cantidad`) + visibilidad de reembolsos en detalle/listado de ventas (badges derivados) | ✅ Implementado (2026-07-10) |
| Nota de crédito manual desde el detalle de venta (permiso dedicado `Ventas:Nota de crédito`, egreso de caja elegible en la misma transacción, devolución de stock elegible) | ✅ Implementado (2026-07-11) |
| Módulo de cron (jobs internos: registro de ejecuciones + expiración de órdenes de pasarela) | ✅ Implementado (2026-07-11) |
| Tienda Online — Mis medios de pago (inscripción Oneclick real: tarjetas tokenizadas por usuario, preferida en BD, eliminación en Transbank) | ✅ Implementado (2026-07-11) |
| Suscripciones — cobro Oneclick real en el alta (cobro del primer período con tarjeta tokenizada, suscripción amarrada a inscripción, alta reanudable tras inscribir tarjeta, cambio de tarjeta, cascada de cancelación al eliminar la tarjeta) | ✅ Implementado (2026-07-12) |
| Salones y Mesas (restaurante): administración de salones/mesas con plano drag&drop (forma y tamaño de mesa), operación del garzón (cuentas por mesa, múltiples cuentas, cancelar), cierre de cuenta que genera venta real reusando el POS | ✅ Implementado (2026-07-12) |
| Gestión de Garzones: registro de garzones con PIN de 6 dígitos (hasheado), identificación operativa por PIN en dispositivos compartidos, trazabilidad de quién abre/cierra cada cuenta | ✅ Implementado (2026-07-13) |
| Turnos y sesiones de garzón: catálogo de turnos, marcar entrada/salida con PIN, cierre admin, sesión obligatoria para abrir/cerrar cuentas | ✅ Implementado (2026-07-16) |
| Responsable vigente de cuenta + transferencia por PIN/admin + historial auditable | ✅ Implementado (2026-07-16) |
| Registro de propinas al cerrar cuenta de mesa (`venta_propina` + `pago_aplicaciones`, estrategia `NO_VUELTO`, UI salones) | ✅ Implementado (2026-07-17) |
| Liquidación propinas E1 — modelo base (tipo garzón, tip+sesión, bases venta) | ✅ Implementado (2026-07-17) |
| Liquidación propinas E2 — config distribución versionada (grupos %, criterios, MANUAL pesos) | ✅ Implementado (2026-07-17) |
| Liquidación propinas E3 — motor por período, confirmación/anulación y UI | ✅ Implementado (2026-07-17) |
| Configuración de propina sugerida por tenant (`propina_configuracion.porcentaje_sugerido`) | ✅ Implementado (2026-07-17) |
| Reportes de propinas F — resumen del ciclo completo y agregados por trabajador (front de reportes pesado retirado; backend `resumen`/`trabajadores` se mantiene, solo `resumen` se consume hoy desde `/propinas`) | ✅ Implementado (2026-07-17) |
| Liquidación propinas — operatividad simplificada (pantalla única: reparto en vivo `preview` → `liquidar` atómico → impresión PDF/A4 persona/resumen/grupo; reportes reducidos a 2 métricas) | ✅ Implementado (2026-07-17) |
| Propina en el POS (venta directa `fisico`) — `propinaDirecta` → `venta_propina` en garzón placeholder "Mostrador" (atribución neutra, reparte por config del tenant) | ✅ Implementado (2026-07-22) |
| Impresión Térmica (comandas cocina/barra por categoría via claim atómico + QZ Tray, precuenta, boleta) | ✅ Implementado (2026-07-13; claim atómico 2026-07-15) |
| Boleta POS — plantilla unificada (emisor con RUT, DOCUMENTO INTERNO / slot electrónico dormante, Neto+impuestos reales, propina → TOTAL A PAGAR) + precuenta con propina sugerida | ✅ Implementado (2026-07-18) |
| Hardening concurrency/validaciones (locks TOCTOU salones/caja/comanda/ajustarStock; costo_actual solo compra; factor_base/costo > 0) | ✅ Implementado (2026-07-15) |
| Catálogo de impuestos del sistema + clasificación tributaria | ✅ Implementado (2026-07-19) |
| Combos (paquetes con precio propio fijo, componentes producto/receta/servicio bloqueantes, una línea de venta, disponibilidad conservadora) | ✅ Implementado (2026-07-20) |
| Grupos de modificadores reutilizables (asociables a combos/recetas, familia derivada ingrediente/vendible, min/max en unidades, precio en el grupo, opción siempre bloqueante, snapshot congelado; impresión térmica de la opción elegida diferida) | ✅ Implementado (2026-07-20) |
| Grupos de modificadores — cantidad/precioExtra overrideables por receta (modelo híbrido default+override, `COALESCE`, estado pendiente, upsert-preservando UUID, drawer de recetas + override en lote) | ✅ Implementado (2026-07-21) |
| Grupos de modificadores anidados en combos, un nivel (automático + por unidad + solo recetas; `GET /items/:id` batched; snapshot `personalizacion.componentes`; descuento de stock por componente/unidad; drawer con selector en vez de radio, cambio global) | ✅ Implementado (2026-07-22) |
