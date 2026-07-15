# Documentación — SaaS POS Multi-tenant

Índice de la documentación técnica. Para setup y comandos ver el [README raíz](../README.md); para convenciones de código ver [`CLAUDE.md`](../CLAUDE.md).

## Por dónde empezar

1. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — stack, estructura del monorepo, flujo de requests, rutas del frontend
2. [`ESTADO.md`](./ESTADO.md) — estado de todas las funcionalidades (✅/🔲 con fechas)
3. [`PRODUCTO.md`](./PRODUCTO.md) — especificación funcional y reglas de negocio
4. [`patterns/`](./patterns/) — **leer antes de planificar una feature**: patrones de-facto backend/frontend
5. [`CONVENTIONS.md`](./CONVENTIONS.md) — cómo escribir y mantener esta documentación

## Architecture Decision Records

Índice completo con template en [`adr/README.md`](./adr/README.md).

| ADR | Decisión |
|---|---|
| [001](./adr/001-jwt-auth.md) | JWT stateless (access + refresh) |
| [002](./adr/002-google-oauth.md) | Google OAuth 2.0 |
| [003](./adr/003-jwt-decode-client.md) | JWT decode en cliente + patrón híbrido JWT/store |
| [004](./adr/004-uuid-column-types.md) | `type: 'uuid'` explícito en columnas PK/FK de TypeORM |
| [005](./adr/005-pais-moneda-y-moneda-oficial.md) | Tabla `pais_moneda` y moneda oficial derivada del país |
| [006](./adr/006-relational-tramos-and-metodos-pago.md) | Modelado relacional de tramos y métodos de pago |
| [007](./adr/007-inventario-serie-lote.md) | Inventario serializado y por lote — eje `modo_inventario` |

## Features

Cada feature implementada tiene su doc operativa en [`features/`](./features/) (template: [`features/TEMPLATE.md`](./features/TEMPLATE.md)).

| Doc | Contenido |
|---|---|
| [auth.md](./features/auth.md) | Autenticación (JWT + Google OAuth) |
| [frontend-multitenant.md](./features/frontend-multitenant.md) | Flujo multi-tenant en frontend (selección de tenant) |
| [modulo-configuracion.md](./features/modulo-configuracion.md) | Configuración — perfil de usuario y contraseña |
| [roles-permisos.md](./features/roles-permisos.md) | RBAC: roles, matriz de permisos, asignación a usuarios |
| [tenants-razones-sociales.md](./features/tenants-razones-sociales.md) | Gestión de tenants y razones sociales |
| [configuracion-monedas.md](./features/configuracion-monedas.md) | Monedas por tenant (multi-moneda + tasa de cambio) |
| [preferencias-financieras.md](./features/preferencias-financieras.md) | Preferencias financieras (modos de cálculo, fórmula de precios) |
| [descuentos-recargos.md](./features/descuentos-recargos.md) | Descuentos/recargos — formularios dinámicos por tipo de regla |
| [motor-calculo-precios.md](./features/motor-calculo-precios.md) | Motor de cálculo de precios (neto → pasos → total) |
| [inventario-kardex.md](./features/inventario-kardex.md) | Kardex de movimientos de stock |
| [inventario-serializado.md](./features/inventario-serializado.md) | Inventario por serie y por lote (`modo_inventario`) |
| [conversion-unidades.md](./features/conversion-unidades.md) | Catálogo global de unidades de medida + conversión en ajuste de stock |
| [mermas-valorizadas.md](./features/mermas-valorizadas.md) | Mermas tipificadas por causa + valorización financiera en kardex |
| [simulador-impacto-costos.md](./features/simulador-impacto-costos.md) | Simulador de desfase de costo en recetas (aplicar/descartar, modal + bandeja) |
| [recetas.md](./features/recetas.md) | Recetas (productos compuestos) + criticidad bloqueante/no bloqueante de ingredientes |
| [gestion-cajas.md](./features/gestion-cajas.md) | Cajas: apertura, movimientos, cuadre y cierre |
| [ventas.md](./features/ventas.md) | Procesamiento de ventas + frontend POS |
| [pagos.md](./features/pagos.md) | Abonos a ventas pendientes y ledger de pagos |
| [terceros.md](./features/terceros.md) | Directorio de terceros (proveedores/empresas) + selector en el POS |
| [tienda-online.md](./features/tienda-online.md) | Tienda online: catálogo, carrito, checkout dummy, suscripciones y medios de pago mock |
| [pasarela-pagos.md](./features/pasarela-pagos.md) | Pasarela de pagos multi-proveedor (Oneclick real, API keys m2m, admin UI) |
| [reembolsos-nota-credito.md](./features/reembolsos-nota-credito.md) | Reembolsos con NC interna elegible + devolución de stock + visibilidad en ventas |
| [cron.md](./features/cron.md) | Jobs internos programados: registro de ejecuciones + expiración de órdenes de pasarela |
| [salones-mesas.md](./features/salones-mesas.md) | Salones y mesas de restaurante: plano drag&drop, cuentas por mesa y cierre que genera venta |
| [garzones.md](./features/garzones.md) | Garzones con PIN de 6 dígitos: identificación operativa en dispositivos compartidos y trazabilidad de quién abre/cierra cada cuenta |
| [impresion-termica.md](./features/impresion-termica.md) | Impresión térmica vía QZ Tray: comandas de cocina/barra ruteadas por categoría (envío en dos fases), precuenta y boleta desde Salones y el POS |

## Otros

- [`superpowers/`](./superpowers/) — planes y specs de implementación en curso (los completados se eliminan; ver su README)
- [`../frontend/docs/DESIGN-SYSTEM.md`](../frontend/docs/DESIGN-SYSTEM.md) — tokens semánticos Nuxt UI, espaciado, componentes CRUD
- [`../startup-pos.sql`](../startup-pos.sql) — esquema completo de BD (fuente de verdad del schema)
- Swagger: http://localhost:3000/api/docs
