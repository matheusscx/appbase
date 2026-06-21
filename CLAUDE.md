# CLAUDE.md

Guía para Claude Code (claude.ai/code) al trabajar en este repositorio.

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
| Perfil multi-tenant (pantallas de gestión) | 🔲 Por construir |
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

### Seed de datos de desarrollo

**Cuando se pida "agregar algo al seed", siempre editar el módulo NestJS**, no el archivo SQL:

- **Fuente de verdad del seed:** `backend/src/modules/seeder/seeder.service.ts`
- El archivo `seed.sql` en la raíz existe como referencia/documentación SQL, pero **no se ejecuta en el flujo normal** — el seeder TypeScript corre automáticamente al arrancar el backend.
- Cada entidad tiene su propio método privado (`seedTenants`, `seedUsuariosTenants`, etc.). Al agregar datos nuevos, modificar el método correspondiente.
- Los IDs fijos siguen el patrón `550e8400-e29b-41d4-a716-446655440XXX`. Usar el siguiente número libre al agregar registros nuevos.
- Si el `seed.sql` también se actualiza, hacerlo en el mismo commit para mantenerlos sincronizados.

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

### Planes de implementación
Todo plan de implementación se **persiste dentro del repo** (no solo en el archivo efímero del modo plan):

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
| Cambia el estado de una funcionalidad | `docs/MIGRACION-FUNCIONALIDADES.md` + tabla "Estado actual" de este `CLAUDE.md` |
| Cambio arquitectónico / estructural | `docs/ARCHITECTURE.md` |
| Decisión técnica importante | Nuevo ADR en `docs/adr/` + índice `docs/adr/README.md` |
| Cambio en reglas de negocio | `docs/PRODUCTO.md` |
| Nueva convención de código/doc | `docs/CONVENTIONS.md` |

---

## Archivos de referencia

| Archivo | Contenido |
|---|---|
| `docs/PRODUCTO.md` | Especificación completa de todas las funcionalidades con reglas de negocio |
| `docs/MIGRACION-FUNCIONALIDADES.md` | Plan/seguimiento de migración de funcionalidades |
| `startup-pos.sql` | Esquema de BD completo con nombres actualizados |
| `seed.sql` | Datos semilla globales (países, monedas, módulos, permisos) y datos de desarrollo |
