# CLAUDE.md

Guía para Claude Code (claude.ai/code) al trabajar en este repositorio.

## Visión del proyecto — SaaS POS Multi-tenant

Sistema SaaS de punto de venta y facturación **multi-tenant**. Cada tenant (empresa)
opera de forma aislada con su propio catálogo, monedas, impuestos, usuarios, roles y
ventas. Un usuario puede pertenecer a varios tenants y opera en uno a la vez.

Monorepo full-stack, **Docker-first** — todo el stack corre con `docker-compose up`.
No requiere Node.js/PostgreSQL local.

- **backend/** — NestJS (TypeScript), API REST en el puerto 3000
- **frontend/** — Nuxt3 (Vue3), SPA/SSR en el puerto 5173
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
├── frontend/          # Nuxt3 app
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
| Perfil multi-tenant | 🔲 Por construir |
| RBAC (roles, módulos, permisos) | 🔲 Por construir |
| Gestión de tenants y razones sociales | 🔲 Por construir |
| Terceros (proveedores, empresas) | 🔲 Por construir |
| Catálogos base (país, provincia, moneda) | 🔲 Por construir |
| Configuración de monedas por tenant | 🔲 Por construir |
| Catálogos financieros (impuestos, descuentos, recargos) | 🔲 Por construir |
| Catálogo de items (productos y servicios) | 🔲 Por construir |
| Motor de cálculo de precios | 🔲 Por construir |
| Procesamiento de ventas | 🔲 Por construir |
| Gestión de cajas | 🔲 Por construir |
| Registro de pagos | 🔲 Por construir |

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

### Cajas
- `'fisica'`: abierta manualmente, el usuario ingresa saldo inicial
- `'virtual'`: una por tenant, creada automáticamente, siempre abierta, para ventas online
- Una sola caja física abierta por tenant+usuario en simultáneo
- Al cerrar: usuario ingresa `monto_contado`, sistema calcula `diferencia`

### Pagos
- Una venta puede tener múltiples pagos con distintos métodos
- Sistema calcula `vuelto` cuando suma de pagos > total (solo si `permite_vuelto = true`)
- Sin integración con pasarela en esta fase — registro contable

### Base de datos
- Todas las tablas tienen soft delete: `eliminado_el TIMESTAMPTZ` — toda lectura filtra `eliminado_el IS NULL`
- Timestamps: `creado_el`, `actualizado_el`
- PKs: UUID en todas las tablas
- Items: modelo base + extensión (`item_producto`, `item_servicio`) — escalable a combos, suscripciones, etc.
- Condiciones de descuento/recargo (`condicion_tipo`): modeladas en BD, lógica de evaluación en fase posterior

### Pendiente para fases futuras
- Evaluación de condiciones en descuentos/recargos (`monto_minimo`, `cantidad_minima`, etc.)
- Integración con proveedor externo de tasas de cambio
- Sub-tenants (jerarquía entre tenants)
- Integración con pasarela de pagos online

---

## Convenciones

### Generales
- Soft delete en todo — nunca borrar filas, marcar `eliminado_el`
- Todo cálculo de dinero y porcentajes usa Decimal.js
- `tenant_id` en las queries siempre viene del token del usuario autenticado, nunca del body
- Al crear un tenant, sembrar automáticamente: rol admin, fórmula de precio por defecto, caja virtual

### Backend
- Cada feature vive en `src/modules/<nombre>/` con su propio controller, service, entity y DTOs. Registrar en `app.module.ts`.
- **Validación:** ValidationPipe es global en `main.ts`; usar decoradores de `class-validator` en todos los DTOs.

### Frontend
- Routing basado en archivos vía `pages/`. Usar `$fetch` para llamadas a la API (no axios).
- Prefijar las vars de runtime config públicas con `VITE_` en el env y acceder vía `useRuntimeConfig().public`.

---

## Archivos de referencia

| Archivo | Contenido |
|---|---|
| `.claude/docs/PRODUCTO.md` | Especificación completa de todas las funcionalidades con reglas de negocio |
| `.claude/docs/MIGRACION-FUNCIONALIDADES.md` | Plan/seguimiento de migración de funcionalidades |
| `startup-pos.sql` | Esquema de BD completo con nombres actualizados |
| `seed.sql` | Datos semilla globales (países, monedas, módulos, permisos) y datos de desarrollo |
