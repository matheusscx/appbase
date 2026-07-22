# Plan — Módulo de Salones y Mesas (Restaurantes)

Status: Draft
Date: 2026-07-12
Owner: Cesar Matheus

> Al aprobar, copiar este plan a `docs/superpowers/plans/2026-07-12-modulo-salones-mesas.md`
> (convención del proyecto) y ejecutar tarea por tarea marcando los checkboxes.

## Context

El SaaS POS es genérico; falta una vertical de **restaurante**. Se necesita que un
tenant configure la distribución física de su local (salones → mesas ubicadas en un
plano) y que el garzón opere sobre ella: abrir cuentas por mesa, ir agregando
productos mientras la mesa está ocupada y, al cerrar la cuenta, cobrar en la mesa con
el POS existente generando una venta real.

Es un módulo **greenfield** (no existe nada de mesas/salones/cuentas en el repo). La
arquitectura ya tiene todo lo reusable: `VentasService.crearEnTransaccion` (para el
cierre atómico), el catálogo de items, el motor de precios, el flujo de cobro del POS
(`CobroModal`) y los patrones CRUD del frontend.

### Decisiones del usuario (confirmadas)
- **Cobro:** inmediato al cerrar la cuenta, reusando el flujo de venta del POS
  (`CobroModal` + `POST /ventas` vía canal `fisico`). Requiere **caja física abierta**.
- **Plano:** posición **libre (x, y)** con drag & drop.
- **Mesas:** solo posición (todas iguales; sin forma/tamaño/capacidad en la v1).
- **Cuentas:** **múltiples cuentas abiertas por mesa** + **cancelar cuenta**.
  Fuera de v1: mover/unir cuentas.

## Scope

Módulo backend `salones/` (entidades `Salon`, `Mesa`, `Cuenta`, `CuentaLinea`) +
RBAC nuevo (módulo "Salones" con permiso extra `Operar`) + dos vistas frontend
(Administración con editor drag&drop, y Operación del garzón que reusa el POS).
`synchronize` activo en dev crea las tablas solas; se documenta el esquema a mano.

## Modelo de datos (nuevas tablas)

Convenciones obligatorias en todas: `type: 'uuid'` explícito en PK/FK
([ADR-004](../../adr/004-uuid-column-types.md)), `tenant_id` del token, soft delete
`@DeleteDateColumn({ name: 'eliminado_el' })`, `creado_el`/`actualizado_el`,
`numeric(18,4)` → string con Decimal.js, columnas `snake_case` vía `name:`.

- **`salones`** — `salon_id` PK, `tenant_id` FK, `nombre`.
- **`mesas`** — `mesa_id` PK, `tenant_id` FK, `salon_id` FK, `nombre`,
  `pos_x numeric`, `pos_y numeric` (fracción `0..1` del contenedor, para plano
  responsivo). Sin estado almacenado: el estado **libre/ocupada** se deriva por
  presencia de cuentas abiertas.
- **`cuentas`** — `cuenta_id` PK, `tenant_id` FK, `mesa_id` FK, `numero int`
  (secuencial por tenant → "Cuenta 85"), `estado` enum `abierta|cerrada|cancelada`
  (default `abierta`), `venta_id uuid` nullable (se setea al cerrar), `abierta_el`,
  `cerrada_el` nullable. `numero` = `COALESCE(MAX(numero),0)+1` por tenant dentro de
  la transacción de apertura.
- **`cuenta_lineas`** — `cuenta_linea_id` PK, `tenant_id` FK, `cuenta_id` FK,
  `item_id` FK, `cantidad numeric(18,4)`. El precio se resuelve al cerrar (igual que
  ventas: `precioUnitario ?? item.precioBase`); el total en vivo lo calcula el
  frontend con `useCalculoPrecios`.

Entidades de referencia para copiar: PK simple `modules/tenants/entities/tenant.entity.ts`.

## Backend — `backend/src/modules/salones/`

Estructura estándar (`entities/`, `dto/`, `salones.service.ts` + `.spec.ts`,
`salones.controller.ts`, `salones.module.ts`). Guard de **módulo de negocio**:
`@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)` a nivel controller +
`@RequiresPermiso('Salones', '<Permiso>')` por handler.

- [ ] **Entidades** `Salon`, `Mesa`, `Cuenta`, `CuentaLinea` (enum `EstadoCuenta`).
- [ ] **DTOs** con `class-validator`: `CreateSalonDto`/`UpdateSalonDto` (`nombre`);
  `CreateMesaDto`/`UpdateMesaDto` (`nombre`, `salonId`, `posX`, `posY`);
  `UpdateLayoutDto` (`mesas: {mesaId, posX, posY}[]` para guardar drag en bloque);
  `CreateCuentaDto` (vacío / opcional `nombre`); `AddLineaDto` (`itemId`, `cantidad`
  `@IsNumberString`); `UpdateLineaDto` (`cantidad`); `CerrarCuentaDto`
  (`pagos: PagoVentaDto[]`, `tipoDocumentoId?`, `customer?`) — **reusar** las clases
  `PagoVentaDto`/`CustomerVentaDto` de `ventas/dto/create-venta.dto.ts`.
- [ ] **`SalonesService`** (lectura SQL raw filtrando `eliminado_el IS NULL`,
  mutación en `dataSource.transaction`, errores `BadRequestException`/`NotFoundException`
  en español):
  - CRUD salones y mesas; `guardarLayout(tenantId, dto)` (PATCH posiciones en bloque).
  - `listarSalonesOperacion(tenantId)` → salones con mesas y flag `ocupada` (LEFT JOIN
    count de cuentas `abierta`) para pintar el plano del garzón.
  - `abrirCuenta`, `agregarLinea`, `actualizarLinea`, `quitarLinea`, `cancelarCuenta`.
  - **`cerrarCuenta(tenantId, usuarioId, cuentaId, dto)`**: dentro de una transacción,
    mapea `cuenta_lineas` → `LineaVentaDto[]`, arma `CreateVentaDto` (`lineas`, `pagos`,
    `canal: 'fisico'`, `tipoDocumentoId?`, `customer?`) y llama
    **`ventasService.crearEnTransaccion(manager, tenantId, usuarioId, dto)`**
    (firma real en `ventas.service.ts:80`; ya exportado por `VentasModule`). Setea
    `cuenta.estado='cerrada'`, `cuenta.ventaId`, `cerrada_el`. Todo atómico.
    Si no hay caja física abierta, `crearEnTransaccion` lanza `'No tienes una caja
    abierta'` → propagar tal cual.
- [ ] **`SalonesController`** — rutas y permisos:
  - Admin estructura: `GET /salones`, `POST /salones` (`Crear`),
    `PATCH/DELETE /salones/:id` (`Actualizar`/`Eliminar`); mesas análogo bajo
    `/salones/:id/mesas` o `/mesas`; `PATCH /salones/:id/layout` (`Actualizar`).
  - Operación (garzón): `GET /salones/operacion` (`Operar`),
    `GET /mesas/:id/cuentas`, `POST /mesas/:id/cuentas`,
    `POST /cuentas/:id/lineas`, `PATCH/DELETE /cuentas/:id/lineas/:lineaId`,
    `POST /cuentas/:id/cerrar`, `POST /cuentas/:id/cancelar` — todas `Operar`.
- [ ] **`SalonesModule`**: `imports: [VentasModule, ItemsModule]`, inyecta
  `VentasService`. Registrar entidades en el array `entities` y el módulo en `imports`
  de `app.module.ts` (dos lugares, ~líneas 106-200).
- [ ] **RBAC seed** (`seeder.service.ts`, IDs contiguos desde el siguiente libre
  **`...440221`**):
  - `seedPermisos()`: añadir permiso `Operar` (`...440221`).
  - `seedModulosApp()`: módulo `Salones`, url `/salones`, icono `mdi-silverware-fork-knife`
    (`...440222`).
  - `seedModuloAppPermisos()`: cruzar `Salones` × {Leer, Crear, Actualizar, Eliminar,
    Operar} (`...440223`–`...440227`).
  - `seedTenantModulo()`: contratar Salones al tenant demo Paris
    (`tenant ...440007`, `...440228`).
  - Nuevos métodos idempotentes `seedSalones()`/`seedMesas()` (2 salones, varias mesas
    con `pos_x/pos_y`) invocados en `onApplicationBootstrap()` tras crearse el tenant;
    registrar repos en el constructor y entidades en `seeder.module.ts`.
- [ ] **Tests** (`salones.service.spec.ts`, TDD): apertura asigna `numero` correlativo;
  agregar/quitar líneas; `cerrarCuenta` invoca `crearEnTransaccion` y deja cuenta
  `cerrada` con `ventaId`; cancelar deja `cancelada` sin venta; aislamiento por tenant.

## Frontend — `frontend/app/`

Reusar: `useApiFetch`, `useFormatters`, `useCalculoPrecios` (total en vivo),
`usePermissionsStore().can`, componentes `crud/` (`CrudPageHeader`, `CrudTable`,
`CrudModal`), `AppDrawer`, y del POS: `VentasCatalogoGrid` (agregar productos) y
`VentasCobroModal` (cobro al cerrar). Design system: tokens semánticos, iconos Lucide.

- [ ] **`components/salones/SalonPlano.vue`** — lienzo que posiciona las mesas por
  `pos_x/pos_y` (absolute, fracción del contenedor). Prop `editable`: en modo editor,
  drag con **pointer events nativos** (`pointerdown/move/up`; no hay librería d&d en el
  repo y no se agrega ninguna) que actualiza posiciones y emite `@move`; en modo
  operación, emite `@select(mesa)` al click y colorea según `ocupada`.
  `components/salones/MesaNode.vue` para cada mesa.
- [ ] **Administración** `pages/salones/admin.vue` — selector de salón + CRUD de
  salones (patrón `configuracion/categorias.vue`: `CrudTable` + `AppDrawer`), y a la
  derecha `SalonPlano :editable` con drawer crear/editar mesa; botón "Guardar
  distribución" → `PATCH /salones/:id/layout`.
- [ ] **Operación (garzón)** `pages/salones/index.vue` — selecciona salón →
  `SalonPlano` (mesas gráficas, ocupadas resaltadas) → al elegir mesa, `AppDrawer`/
  slideover con sus cuentas abiertas y botón "Nueva cuenta". Elegir/crear cuenta abre
  el **detalle de cuenta**: `VentasCatalogoGrid` para agregar productos +
  lista de líneas con cantidad/quitar + total en vivo (`useCalculoPrecios`) +
  botones "Cancelar cuenta" y "Cerrar y cobrar" → `VentasCobroModal` → `POST
  /cuentas/:id/cerrar`. Etiquetas: "Salón 1", "Mesa 4", "Cuenta 85".
- [ ] **`composables/useSalones.ts`** — wrappers `useApiFetch` de los endpoints y
  helpers puros (mapear cuenta→input de `useCalculoPrecios`), testeables (patrón
  `useVenta.ts`).
- [ ] **Navegación** `layouts/dashboard.vue` (array `items` computed): item
  "Salones" → `/salones` gateado `esAdmin || can('Salones','Operar')`; item
  "Distribución"/admin → `/salones/admin` gateado `esAdmin || can('Salones','Crear')`.

## Documentación viva (mismo commit)

- [ ] `startup-pos.sql`: agregar tablas `salones`, `mesas`, `cuentas`, `cuenta_lineas`.
- [ ] `docs/features/salones-mesas.md` (desde `TEMPLATE.md`) + link en `docs/README.md`.
- [ ] `docs/ESTADO.md`: fila `Salones y Mesas | ✅ Implementado (2026-07-12)`.
- [ ] ADR si se decide algo no obvio (p.ej. numeración de cuentas por tenant).

## Verification

- [ ] `cd backend && npm test` (specs de `SalonesService`) y `npm run lint`.
- [ ] `docker-compose up --build`; el seeder crea módulo Salones + salones/mesas demo.
- [ ] Backend E2E manual con MCP postgres / Swagger `3000/api/docs`: abrir cuenta en
  una mesa, agregar líneas, cerrar con caja física abierta → verificar que se creó la
  venta (`ventas` + `venta_detalle`) y la cuenta quedó `cerrada` con `venta_id`.
- [ ] Frontend con MCP chrome-devtools en `5173`: (a) admin — crear salón/mesa,
  arrastrar mesas, guardar y recargar comprobando posiciones; (b) garzón —
  seleccionar salón, abrir cuenta, agregar productos, ver total en vivo, cerrar y
  cobrar; verificar la venta en `/ventas`. Probar cancelar cuenta.
- [ ] Permisos: usuario sin `Operar` no ve la operación; sin `Crear` no administra.

## Decisions

- Un solo módulo RBAC **"Salones"** con permiso extra **`Operar`** (patrón de
  `Reembolsar`/`Nota de crédito`) para separar administrar estructura vs. operar cuentas.
- Cierre de cuenta reusa **`VentasService.crearEnTransaccion`** para atomicidad venta +
  cuenta (evita el doble commit de `crear()`).
- Estado de mesa (libre/ocupada) **derivado**, no almacenado.
- Drag & drop con **pointer events nativos** — sin nueva dependencia.
- `pos_x/pos_y` como fracción `0..1` para plano responsivo.
