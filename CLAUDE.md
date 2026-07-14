# CLAUDE.md

Guía para Claude Code (claude.ai/code) al trabajar en este repositorio.

> ## ⚠️ Flujo de trabajo — Etapa de desarrollo
>
> El proyecto está en **etapa de desarrollo activo**. **No crear ramas nuevas ni PRs**:
> trabajar y commitear **directamente sobre `main`**.

## Visión — SaaS POS Multi-tenant

Sistema SaaS de punto de venta y facturación **multi-tenant**: cada tenant (empresa)
opera aislado con su propio catálogo, monedas, impuestos, usuarios, roles y ventas.
Un usuario puede pertenecer a varios tenants y opera en uno a la vez.

Monorepo full-stack **Docker-first** (`docker-compose up` levanta todo; no requiere
Node.js/PostgreSQL local):

- **backend/** — NestJS (TypeScript), API REST puerto 3000 (Swagger en `3000/api/docs`)
- **frontend/** — Nuxt 4 (Vue 3), SPA/SSR puerto 5173
- **PostgreSQL 15** — puerto 5432
- **Aritmética financiera: Decimal.js** — nunca `number` nativo para dinero o porcentajes

Estructura de directorios, mapa de módulos y flujo de requests: `docs/ARCHITECTURE.md`.

## Comandos

```bash
docker-compose up            # Stack completo (preferido); --build reconstruye imágenes
docker-compose down -v       # Detener y borrar el volumen de la BD

cd backend
npm run start:dev            # Watch mode | npm test | npm run test:e2e | npm run lint

cd frontend
npm run dev                  # Dev server | npm run build
```

Config vía `.env` en la raíz (copiar `.env.example`). Backend lee `DATABASE_URL`,
`JWT_SECRET`, `PORT`, `API_PREFIX`; frontend lee `VITE_API_URL`.

## Estado actual

El estado de todas las funcionalidades (✅/🔲 con fechas) vive en **`docs/ESTADO.md`**.
Consultarlo para saber qué existe y **actualizarlo en el mismo commit** que implementa
o cambia una feature.

## Decisiones de arquitectura tomadas

### Terminología (crítico — no mezclar)
| Concepto | Tabla DB | Nombre en código/docs |
|---|---|---|
| Empresa que contrata el SaaS | `tenants` | **tenant** |
| Comprador final en una venta | `venta_customer` | **customer** |
| Entidad externa (proveedor, empresa) | `terceros` | **tercero** |

### Reglas transversales
- **Auth:** JWT access + refresh ya implementado — no modificar el sistema de tokens.
- **Permisos:** enforcement **real en el backend** (guards por ruta, no solo frontend).
  Modelo: `rol → módulo contratado (tenant_modulos) → permisos`. Superadmin: flag
  `es_superadmin` en `usuarios`, rutas `/admin/*` con guard propio independiente del
  RBAC de tenants. El rol `admin` del tenant es fijo (`es_fijo = true`), se crea
  automáticamente con cada tenant.
- **Monedas:** la moneda oficial viene de `pais.moneda_oficial_id` — no la elige el
  tenant. Tasas de cambio (`valor_del_dia`) en `tenant_moneda`, por tenant. Todos los
  totales de venta se persisten convertidos a la moneda oficial.
  **Porcentajes siempre en decimal:** `0.19` = 19%, nunca `19`.
- **Motor de precios:** `precioNeto → pasos según tenant_formula_precio → totalFinal`
  (default: `descuentos → recargos → impuestos`; cada paso aplica sobre el acumulado).
  `items.precio_incluye_impuesto` y `tenants.calculo_descuentos` (`'base'`|`'compuesto'`)
  modulan el cálculo. Detalle: `docs/features/motor-calculo-precios.md`.
- **Fiscal (SII):** la emisión electrónica al SII llega **a futuro, no ahora**; se diseña
  todo **compatible con SII sin integrarlo**. Regla: **capturar y congelar el hecho fiscal
  en el momento de la transacción; diferir lo que solo transmite/formatea** (DTE, folios/CAF,
  firma). "Exento" es un estado explícito, nunca la ausencia de impuesto. No construir
  infraestructura DTE especulativa (YAGNI). Detalle y qué-hacer-ahora vs qué-diferir: ADR-010.
- **Ventas:** canales `'fisico'` (requiere caja abierta) y `'online'` (directo a
  `pagada`, caja virtual). Estados: `borrador → pendiente → pagada | cancelada`, más
  `pagada_parcial` derivado (saldo > 0 y < total). Sin array `pagos` al crear → queda
  `pendiente` (cuenta por cobrar). Saldo = total_final − Σ(monto − vuelto). Tipos de
  documento por país desde `tipos_documento_tributario` (tabla, no enum). Nota de
  crédito referencia la venta original con `venta_referencia_id`.
  Detalle: `docs/features/ventas.md`.
- **Cajas:** `'fisica'` (apertura manual con saldo inicial; una sola abierta por
  tenant+usuario) y `'virtual'` (una por tenant, automática, siempre abierta, para
  ventas online). Al cerrar: `monto_contado` → sistema calcula `diferencia`.
  Detalle: `docs/features/gestion-cajas.md`.
- **Inventario:** solo items `tipo='producto'` tienen stock. `movimientos_inventario`
  es la fuente de verdad auditable; `item_producto.stock` es saldo materializado.
  Movimiento + saldo en una transacción; `salida` valida stock no negativo. Eje
  `modo_inventario`: `cantidad` (default) | `serie` (unidades con identidad) | `lote`
  (agrupadas con vencimiento) — inmutable una vez hay movimientos.
  Detalle: `docs/features/inventario-serializado.md` y ADR-007.
- **Pagos:** una venta acepta múltiples pagos de distintos métodos; `vuelto` solo si
  `permite_vuelto = true`. Detalle: `docs/features/pagos.md`.
- **BD:** soft delete en todo (`eliminado_el TIMESTAMPTZ`; toda lectura filtra
  `IS NULL`), timestamps `creado_el`/`actualizado_el`, PKs UUID. Items: modelo base +
  extensión (`item_producto`, `item_servicio`, `item_suscripcion` con `frecuencia`).
- **Fases futuras:** evaluación de condiciones en descuentos/recargos, proveedor
  externo de tasas de cambio, sub-tenants, bodegas/traspasos/costeo.

## Convenciones

- Soft delete en todo — nunca borrar filas, marcar `eliminado_el`.
- Todo cálculo de dinero y porcentajes usa Decimal.js.
- `tenant_id` en las queries siempre del token del usuario autenticado, nunca del body.
- Al crear un tenant, sembrar automáticamente: rol admin, fórmula de precio por
  defecto, caja virtual.
- **Seed de desarrollo:** fuente de verdad `backend/src/modules/seeder/seeder.service.ts`
  (corre al arrancar el backend). Un método privado por entidad; IDs fijos con patrón
  `550e8400-e29b-41d4-a716-446655440XXX` (usar el siguiente número libre).
  Detalle: `docs/patterns/backend.md` §8.
- **Backend:** cada feature en `src/modules/<nombre>/` (controller, service, entity,
  DTOs), registrada en `app.module.ts`. DTOs con `class-validator` (ValidationPipe
  global en `main.ts`). **Toda columna PK/FK de UUID declara `type: 'uuid'` explícito**
  — sin él TypeORM infiere `varchar` y rompe los JOINs en SQL raw
  ([ADR-004](docs/adr/004-uuid-column-types.md)).
- **Frontend:** routing por `pages/`. Llamadas API con `$fetch`/`useApiFetch`, no
  axios. Runtime config pública con prefijo `VITE_` vía `useRuntimeConfig().public`.
  Funciones de formato (`formatMonto`, `formatFecha` y toda utilidad de presentación
  reutilizable) centralizadas en composables de `app/composables/` (hoy
  `useFormatters`), nunca definidas localmente en un `.vue`.
- **Design System:** siempre tokens semánticos de Nuxt UI (`text-muted`,
  `divide-default`, `bg-default`), nunca Tailwind hardcoded (`text-gray-500`,
  `bg-white dark:bg-gray-900`). Excepción: colores financieros (verde/rojo/azul) en
  el módulo Caja. Referencia: `frontend/docs/DESIGN-SYSTEM.md` y `app/app.config.ts`.

## Planes de implementación

- **Antes de planificar:** leer `docs/patterns/backend.md` y `docs/patterns/frontend.md`
  para reusar los patrones de-facto en vez de re-escanear el repo.
- Todo plan se persiste en `docs/superpowers/plans/YYYY-MM-DD-<kebab-slug>.md`, con
  metadata `Status` (Draft/Approved/In Progress/Done) / `Date` / `Owner` y secciones
  Context, Scope, Backend, Frontend, Verification, Decisions; tareas con `- [ ]`.
- Flujo: el agente redacta y guarda el plan → el usuario lo edita → el usuario pasa
  la ruta del plan → el agente lo ejecuta tarea por tarea marcando los checkboxes.
- `docs/superpowers/specs/` es diseño/contexto; `plans/` son pasos ejecutables.

## Documentación viva (actualizar en el mismo commit que el código)

| Tipo de cambio | Archivo(s) a actualizar |
|---|---|
| Nueva feature implementada | `docs/features/<feature>.md` (desde `TEMPLATE.md`) + link en `docs/README.md` + fila en `docs/ESTADO.md` |
| Cambia el estado de una funcionalidad | `docs/ESTADO.md` |
| Cambio arquitectónico / estructural | `docs/ARCHITECTURE.md` |
| Decisión técnica importante | Nuevo ADR en `docs/adr/` + índice `docs/adr/README.md` |
| Cambio en reglas de negocio | `docs/PRODUCTO.md` |
| Nueva convención de código/doc | `docs/CONVENTIONS.md` |
| Patrón backend/frontend nuevo o cambiado | `docs/patterns/backend.md` o `docs/patterns/frontend.md` |

## Archivos de referencia

| Archivo | Contenido |
|---|---|
| `docs/patterns/` | **Playbook backend/frontend — leer ANTES de planificar una feature** |
| `docs/ESTADO.md` | Estado de todas las funcionalidades |
| `docs/PRODUCTO.md` | Especificación funcional completa con reglas de negocio |
| `startup-pos.sql` | Esquema de BD completo |
| `backend/src/modules/seeder/seeder.service.ts` | Fuente de verdad del seed (corre al arrancar) |
