# CLAUDE.md

Guía para Claude Code (claude.ai/code) al trabajar en este repositorio.

> ## ⚠️ Flujo de trabajo — Etapa de desarrollo
>
> El proyecto está en **etapa de desarrollo activo**. **No crear ramas nuevas**:
> trabajar **directamente sobre `main`** y commitear ahí. No abrir PRs para integrar;
> los cambios van directo a `main`.

## Visión del proyecto — SaaS POS Multi-tenant

Sistema SaaS de punto de venta y facturación **multi-tenant**. Cada tenant (empresa)
opera de forma aislada con su propio catálogo, monedas, impuestos, usuarios, roles y
ventas. Un usuario puede pertenecer a varios tenants y opera en uno a la vez.

Monorepo full-stack, **Docker-first** — todo el stack corre con `docker-compose up`.
No requiere Node.js/PostgreSQL local.

- **backend/** — NestJS (TypeScript), API REST en el puerto 3000
- **frontend/** — Nuxt 4 (Vue 3), SPA/SSR en el puerto 5173
- **PostgreSQL 15** — gestionado por Docker, puerto 5432
- **Aritmética financiera:** Decimal.js (nunca `number` nativo para dinero o porcentajes)

## Comandos

### Stack completo (preferido)
```bash
docker-compose up          # Levantar todos los servicios
docker-compose up --build  # Reconstruir imágenes primero
docker-compose down -v     # Detener y borrar el volumen de la BD
```

### Solo backend (dev local)
```bash
cd backend
npm run start:dev   # Watch mode
npm test            # Tests unitarios
npm run test:e2e    # Tests end-to-end
npm run lint        # Lint + auto-fix
```

### Solo frontend (dev local)
```bash
cd frontend
npm run dev         # Servidor de desarrollo
npm run build       # Build de producción
```

## Arquitectura

```
practica/
├── backend/           # NestJS app
│   └── src/
│       ├── main.ts           # Bootstrap: CORS, ValidationPipe, Swagger
│       ├── app.module.ts     # Módulo raíz
│       └── modules/          # Módulos de feature
├── frontend/          # Nuxt 4 app
│   ├── app/app.vue           # Componente raíz
│   ├── pages/                # Routing basado en archivos
│   ├── components/           # Componentes auto-importados
│   ├── composables/          # Composables auto-importados
│   └── stores/               # Stores Pinia
├── docker-compose.yml
├── backend.Dockerfile
├── frontend.Dockerfile
└── .env                      # Copiar de .env.example
```

### Mapa de puertos
| Servicio   | Puerto host   |
|------------|---------------|
| Frontend   | 5173          |
| Backend    | 3000          |
| Swagger    | 3000/api/docs |
| PostgreSQL | 5432          |

### Entorno
Toda la config vía `.env` en la raíz (copiar `.env.example`). El backend lee
`DATABASE_URL`, `JWT_SECRET`, `PORT`, `API_PREFIX`. El frontend lee `VITE_API_URL`.

---

## Estado actual

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
| Pasarela — Webpay Plus Mall (pago único con redirect: crear→confirmar; reembolso pendiente) | ✅ Implementado (2026-07-08) |

---

## Decisiones de arquitectura tomadas

### Terminología (crítico — no mezclar)
| Concepto | Tabla DB | Nombre en código/docs |
|---|---|---|
| Empresa que contrata el SaaS | `tenants` | **tenant** |
| Comprador final en una venta | `venta_customer` | **customer** |
| Entidad externa (proveedor, empresa) | `terceros` | **tercero** |

### Autenticación
- JWT estándar de la empresa: access token + refresh token con tiempos ya definidos
- El sistema de tokens ya está implementado — no modificar

### Permisos
- Enforcement **real en el backend** — guards por ruta, no solo frontend
- Modelo: `rol → módulo contratado (tenant_modulos) → permisos`
- **Superadmin:** flag `es_superadmin` en `usuarios`. Rutas `/admin/*` con guard propio, independiente del RBAC de tenants
- Rol `admin` del tenant es fijo (`es_fijo = true`), se crea automáticamente con cada tenant

### Monedas
- La **moneda oficial** del tenant viene de `pais.moneda_oficial_id` — no la elige el tenant
- Tasas de cambio (`valor_del_dia`) en `tenant_moneda` — por tenant, actualizables en cualquier momento
- Todos los totales de venta se convierten a la moneda oficial al persistir
- **Porcentajes siempre en decimal:** `0.19` = 19%, nunca `19`

### Motor de precios (fórmula configurable)
```
precioNeto (fijo, siempre primero)
  → paso 1, 2, 3 según tenant_formula_precio
  → totalFinal (fijo, siempre último)
```
Default: `descuentos → recargos → impuestos`. Cada paso aplica sobre el acumulado anterior.
- `items.precio_incluye_impuesto`: si el precio ingresado ya incluye impuestos
- `tenants.calculo_descuentos`: `'base'` (todos sobre precioNeto) | `'compuesto'` (cascada)

### Ventas
- Dos canales: `'fisico'` (requiere caja abierta) | `'online'` (pago inmediato, caja virtual)
- Tipos de documento desde tabla `tipos_documento_tributario` por país (no enum fijo)
- Estados: `borrador` → `pendiente` → `pagada` | `cancelada`
- Ventas online llegan directamente a `pagada`
- Nota de crédito referencia la venta original con `venta_referencia_id`
- Ventas sin pago: al crear sin array `pagos`, la venta queda en estado `pendiente` (cuenta por cobrar)
- Estado `pagada_parcial`: nuevo estado derivado cuando saldo > 0 pero < total_final
- Saldo = total_final − Σ(pago.monto − pago.vuelto); se actualiza en cada abono via `PagosService`

### Cajas
- `'fisica'`: abierta manualmente, el usuario ingresa saldo inicial
- `'virtual'`: una por tenant, creada automáticamente, siempre abierta, para ventas online
- Una sola caja física abierta por tenant+usuario en simultáneo
- Al cerrar: usuario ingresa `monto_contado`, sistema calcula `diferencia`

### Inventario (kardex de stock)
- Trazabilidad de stock solo para items `tipo = 'producto'` (los servicios no tienen stock)
- `movimientos_inventario` es la fuente de verdad auditable; `item_producto.stock` es el saldo materializado para lectura rápida y alertas
- Movimiento + actualización de saldo en una sola transacción; la `salida` valida stock suficiente (no negativo)
- Cada línea de venta genera un movimiento `salida`/`motivo='venta'` (devoluciones → `entrada`/`motivo='devolucion'`) dentro de la transacción de la venta
- `tenant_id` y `usuario_id` siempre del token
- **Eje `modo_inventario`** en `item_producto` (inmutable una vez hay movimientos):
  - `cantidad` (default): stock fungible, comportamiento original
  - `serie`: cada unidad tiene identidad propia (`item_unidad`); `stock = COUNT(estado='disponible')`
  - `lote`: unidades agrupadas por lote con vencimiento (`item_lote`); `stock = SUM(cantidad_disponible)`
  - En modo `serie`, `item_unidad.lote_id` es metadato (sin cantidad); el conteo de stock viene del estado de la unidad (anti-doble-conteo)
  - `movimiento_inventario_detalle` liga cada movimiento con las unidades/lotes afectados
- Fuera de alcance (fases futuras): bodegas, traspasos, costeo/valoración, FEFO automático en lotes

### Pagos
- Una venta puede tener múltiples pagos con distintos métodos
- Sistema calcula `vuelto` cuando suma de pagos > total (solo si `permite_vuelto = true`)
- Sin integración con pasarela en esta fase — registro contable

### Base de datos
- Todas las tablas tienen soft delete: `eliminado_el TIMESTAMPTZ` — toda lectura filtra `eliminado_el IS NULL`
- Timestamps: `creado_el`, `actualizado_el`
- PKs: UUID en todas las tablas
- Items: modelo base + extensión (`item_producto`, `item_servicio`, `item_suscripcion` con `frecuencia`) — escalable a combos, etc. Solo `producto` participa del tracking de stock/inventario.
- Condiciones de descuento/recargo (`condicion_tipo`): modeladas en BD, lógica de evaluación en fase posterior

### Pendiente para fases futuras
- Evaluación de condiciones en descuentos/recargos (`monto_minimo`, `cantidad_minima`, etc.)
- Integración con proveedor externo de tasas de cambio
- Sub-tenants (jerarquía entre tenants)
- Integración con pasarela de pagos online
- Inventario avanzado: bodegas/almacenes, traspasos, costeo y valoración de stock

---

## Convenciones

### Seed de datos de desarrollo

**Cuando se pida "agregar algo al seed", editar el seeder NestJS:**

- **Fuente de verdad del seed:** `backend/src/modules/seeder/seeder.service.ts`. El seeder TypeScript corre automáticamente al arrancar el backend.
- Cada entidad tiene su propio método privado (`seedTenants`, `seedUsuariosTenants`, etc.). Al agregar datos nuevos, modificar el método correspondiente.
- Los IDs fijos siguen el patrón `550e8400-e29b-41d4-a716-446655440XXX`. Usar el siguiente número libre al agregar registros nuevos.

### Generales
- Soft delete en todo — nunca borrar filas, marcar `eliminado_el`
- Todo cálculo de dinero y porcentajes usa Decimal.js
- `tenant_id` en las queries siempre viene del token del usuario autenticado, nunca del body
- Al crear un tenant, sembrar automáticamente: rol admin, fórmula de precio por defecto, caja virtual

### Backend
- Cada feature vive en `src/modules/<nombre>/` con su propio controller, service, entity y DTOs. Registrar en `app.module.ts`.
- **Validación:** ValidationPipe es global en `main.ts`; usar decoradores de `class-validator` en todos los DTOs.
- **Columnas UUID en entidades TypeORM (crítico):** Toda columna que sea PK o FK de UUID **debe** declarar `type: 'uuid'` explícitamente. Sin ese tipo, TypeORM infiere `varchar` y las columnas quedan como `character varying` en la BD, rompiendo los JOINs en SQL raw. Aplica a `@PrimaryColumn`, `@Column` y columnas de relación sin `@ManyToOne`. Ver [ADR-004](docs/adr/004-uuid-column-types.md).
  ```typescript
  // ✅ Correcto
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })

  // ❌ Incorrecto — TypeORM infiere varchar, BD queda character varying
  @PrimaryColumn({ name: 'tenant_id' })
  @Column({ name: 'usuario_id', type: 'varchar', nullable: true })
  ```

### Frontend
- Routing basado en archivos vía `pages/`. Usar `$fetch` para llamadas a la API (no axios).
- Prefijar las vars de runtime config públicas con `VITE_` en el env y acceder vía `useRuntimeConfig().public`.
- **Funciones de formato centralizadas:** `formatMonto` y `formatFecha` (y cualquier utilidad de presentación reutilizable) deben vivir en composables de `app/composables/`, nunca definirse localmente dentro de un componente. Hoy están en `useFormatters`. Antes de escribir una función de formato en un `.vue`, verificar si ya existe en un composable.

### Design System (Nuxt UI Semantic Tokens)
- **Siempre usar tokens semánticos, nunca Tailwind hardcoded.** Permite consistencia en tema claro/oscuro.
- ❌ Prohibido: `text-gray-500`, `divide-gray-100 dark:divide-gray-800`, `bg-white dark:bg-gray-900`
- ✅ Usar: `text-muted`, `divide-default`, `bg-default`
- Referencia: `frontend/docs/DESIGN-SYSTEM.md` y `app/app.config.ts`
- **Excepción:** colores financieros (verde/rojo/azul) en módulo Caja son intencionales.

### Planes de implementación
Todo plan de implementación se **persiste dentro del repo** (no solo en el archivo efímero del modo plan):

- **Antes de planificar:** leer `docs/patterns/backend.md` y `docs/patterns/frontend.md` para reusar los patrones de-facto del proyecto en vez de re-escanear el repo.
- **Ubicación:** `docs/superpowers/plans/`
- **Nombre estándar:** `YYYY-MM-DD-<kebab-slug>.md` (fecha de creación + tema). Ej: `2026-06-21-modulo-test-permisos.md`.
- **Estado:** se rastrea con el campo de metadata `Status` (Draft / Approved / In Progress / Done), nunca por el nombre del archivo.
- **Estructura:** encabezado `# Plan: <título>`; metadata `Status` / `Date` (YYYY-MM-DD) / `Owner`; secciones **Context**, **Scope / Out of scope**, **Backend**, **Frontend**, **Verification**, **Decisions / Open questions**. Las tareas usan checkboxes `- [ ]` para seguimiento.
- **Flujo de trabajo:** el agente redacta y guarda el plan en `docs/superpowers/plans/` → el usuario lo edita en su editor de código → el usuario pasa la **ruta del plan** al agente → el agente lee ese archivo como fuente de verdad y lo ejecuta tarea por tarea, marcando los `- [ ]` a medida que avanza.
- Diferencia con `docs/superpowers/specs/`: los `specs/` son diseño/contexto; los `plans/` son pasos ejecutables.

---

## Documentación viva (mantener sincronizada)

Al desarrollar, actualiza SIEMPRE el/los archivo(s) que correspondan en el
mismo cambio que toca el código. No dejar la doc para después: si un cambio de
código afecta lo que describe un doc, el commit/PR incluye la actualización.

| Tipo de cambio | Archivo(s) a actualizar |
|---|---|
| Nueva feature implementada | Crear `docs/features/<feature>.md` (desde `docs/features/TEMPLATE.md`) + agregar link en `docs/README.md` |
| Cambia el estado de una funcionalidad | Tabla "Estado actual" de este `CLAUDE.md` |
| Cambio arquitectónico / estructural | `docs/ARCHITECTURE.md` |
| Decisión técnica importante | Nuevo ADR en `docs/adr/` + índice `docs/adr/README.md` |
| Cambio en reglas de negocio | `docs/PRODUCTO.md` |
| Nueva convención de código/doc | `docs/CONVENTIONS.md` |
| Patrón backend/frontend nuevo o cambiado | `docs/patterns/backend.md` o `docs/patterns/frontend.md` |

---

## Archivos de referencia

| Archivo | Contenido |
|---|---|
| `docs/patterns/` | **Playbook de patrones backend/frontend — leer ANTES de planificar una feature** (esqueleto de módulo, guards, entities, SQL raw, seeding, páginas con update optimista). Evita re-escanear el repo. |
| `docs/PRODUCTO.md` | Especificación completa de todas las funcionalidades con reglas de negocio |
| `startup-pos.sql` | Esquema de BD completo con nombres actualizados |
| `backend/src/modules/seeder/seeder.service.ts` | Fuente de verdad del seed (datos globales y de desarrollo); corre al arrancar el backend |
