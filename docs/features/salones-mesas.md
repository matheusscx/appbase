# Feature: Salones y Mesas (Restaurante)

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-07-12 (forma/tamaño de mesa)

---

## Overview

### ¿Qué es?

Vertical de restaurante sobre el POS. Tiene dos secciones:

- **Administración** — el tenant configura sus **salones** y las **mesas** de cada
  salón, ubicándolas en un plano mediante **drag & drop**.
- **Operación (garzón)** — se elige un salón, se ven las mesas gráficamente, se
  selecciona una mesa y se gestionan sus **cuentas**: crear una o varias cuentas por
  mesa, agregar productos (cuenta abierta = consumo pendiente) y **cerrar la cuenta**,
  lo que genera una **venta real** cobrada en la mesa con el flujo del POS.

### ¿Por qué existe?

En un restaurante el garzón lleva la cuenta de cada mesa y cobra en el lugar. Este
módulo modela esa operación reusando el motor de ventas/cobro existente.

### Scope

- Incluido: CRUD de salones y mesas, plano con posiciones libres `(x, y)`, forma
  (redonda/cuadrada/rectangular) y tamaño (pequeña/mediana/grande/extra grande) de
  mesa, múltiples cuentas abiertas por mesa, agregar/quitar/editar líneas, cancelar
  cuenta, cerrar cuenta → venta (canal `fisico`, requiere caja abierta).
- NO incluido (futuro): mover/unir cuentas entre mesas, capacidad (nº comensales),
  reservas.

---

## API Endpoints

Todos bajo `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)`. Módulo RBAC
**`Salones`**. Administración usa `Leer`/`Crear`/`Actualizar`/`Eliminar`; la operación
del garzón usa el permiso dedicado **`Operar`**.

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/salones` | Leer | Salones con sus mesas (admin) |
| POST | `/salones` | Crear | Crear salón |
| PATCH | `/salones/:id` | Actualizar | Renombrar salón |
| DELETE | `/salones/:id` | Eliminar | Eliminar salón (y sus mesas) |
| POST | `/salones/:salonId/mesas` | Crear | Crear mesa en el salón |
| PATCH | `/salones/:salonId/layout` | Actualizar | Guardar posiciones (drag) en bloque |
| PATCH | `/mesas/:id` | Actualizar | Renombrar / reposicionar mesa |
| DELETE | `/mesas/:id` | Eliminar | Eliminar mesa |
| GET | `/salones/operacion` | Operar | Salones + mesas con flag `ocupada` |
| GET | `/mesas/:id/cuentas` | Operar | Cuentas abiertas de la mesa (con líneas) |
| POST | `/mesas/:id/cuentas` | Operar | Abrir cuenta (asigna `numero` correlativo por mesa) |
| POST | `/cuentas/:id/lineas` | Operar | Agregar producto (merge por ítem) |
| PATCH | `/cuentas/:id/lineas/:lineaId` | Operar | Cambiar cantidad |
| DELETE | `/cuentas/:id/lineas/:lineaId` | Operar | Quitar producto |
| POST | `/cuentas/:id/cancelar` | Operar | Anular cuenta (sin venta) |
| POST | `/cuentas/:id/cerrar` | Operar | Cerrar → genera venta |

`POST /cuentas/:id/cerrar` body: `{ pagos?: PagoVentaDto[], tipoDocumentoId?, customer? }`
(reusa las clases de `ventas/dto/create-venta.dto.ts`). Respuesta:
`{ cuenta: CuentaDetalle, ventaId }`.

---

## Backend

- **Módulo**: `src/modules/salones/salones.module.ts` (importa `VentasModule`).
- **Controllers**: `salones.controller.ts` → `SalonesController` (`/salones`),
  `MesasController` (`/mesas`), `CuentasController` (`/cuentas`).
- **Service**: `salones.service.ts` → `SalonesService`.

### Cierre de cuenta → venta (atómico)

`SalonesService.cerrarCuenta` abre una transacción, mapea las `cuenta_lineas` a
`LineaVentaDto[]`, arma un `CreateVentaDto` con `canal: 'fisico'` y llama a
**`VentasService.crearEnTransaccion(manager, tenantId, usuarioId, dto)`** dentro de la
misma transacción. Así la venta y el cambio de estado de la cuenta commitean juntos.
Requiere caja física abierta (lo valida `crearEnTransaccion`).

### Tablas

**`salones`**: `salon_id` PK, `tenant_id`, `nombre` + soft delete/timestamps.

**`mesas`**: `mesa_id` PK, `tenant_id`, `salon_id`, `nombre`, `pos_x`, `pos_y`
(`numeric`, fracción `0..1` del contenedor), `forma`
(`redonda|cuadrada|rectangular`, default `cuadrada`), `tamano`
(`pequeno|mediano|grande|extra_grande`, default `mediano`). El estado libre/ocupada es
**derivado** (cuentas abiertas), no se almacena.

**`cuentas`**: `cuenta_id` PK, `tenant_id`, `mesa_id`, `numero int` (correlativo por
**mesa**, calculado solo entre las cuentas actualmente `abierta` de esa mesa → se
reinicia en 1 cuando la mesa queda completamente libre, no es un correlativo
histórico), `estado` (`abierta|cerrada|cancelada`), `venta_id` (set al cerrar),
`abierta_el`, `cerrada_el`.

**`cuenta_lineas`**: `cuenta_linea_id` PK, `tenant_id`, `cuenta_id`, `item_id`,
`cantidad numeric(18,4)`. El precio se resuelve al cerrar (igual que ventas).

---

## Frontend

### Pages

- `pages/salones/index.vue` — Operación del garzón: selector de salón → plano →
  drawer de la mesa (lista de cuentas / detalle de cuenta con catálogo, líneas, total
  en vivo, cancelar y cerrar+cobrar).
- `pages/configuracion/salones.vue` — Administración (dentro de Configuración): CRUD
  de salones/mesas + editor de plano con drag & drop y "Guardar distribución".

### Components

- `components/salones/SalonPlano.vue` — Lienzo que posiciona las mesas por
  `pos_x/pos_y`. `editable` → drag con **pointer events nativos** (`@move`), guarda la
  distribución automáticamente al soltar la mesa (`@dragend`, solo si hubo movimiento
  real), abre la edición con doble click (`@edit`) y permite redimensionar el alto del
  plano arrastrando la esquina (`resize-y`, como un `<textarea>`, 220px–70vh); el alto
  elegido se persiste en `localStorage` (`salones-plano-alto`, preferencia de
  navegador, no por tenant/salón) vía `ResizeObserver`; operación → `@select(mesa)`.
- `components/salones/MesaNode.vue` — Caja de una mesa (nombre, ocupación). El
  `tamano` mapea a un ancho/alto en px (64/80/96/112) y `forma` a la clase visual
  (`redonda` → círculo, `rectangular` → 1.5× más ancha).

### Composable

- `composables/useSalones.ts` — wrappers `useApiFetch` de todos los endpoints +
  `cuentaToCalcularInput` (mapea la cuenta al motor de precios para el total en vivo,
  vía `useCalculoPrecios`).

### Reuso del POS

El detalle de cuenta reusa `VentasCatalogoGrid` (agregar productos), `useCalculoPrecios`
(total en vivo) y `VentasCobroModal` (cobro al cerrar). La operación del garzón se
navega desde `layouts/dashboard.vue` (`/salones`, gateada por `can('Salones','Operar')`);
la administración vive dentro de Configuración (`pages/configuracion.vue` →
`/configuracion/salones`, gateada por `can('Salones','Crear')`).

---

## Testing

### Unit Tests (Backend)

```bash
npm test -- modules/salones/salones.service.spec.ts
```

Cubre: número de cuenta correlativo, agregar/merge/quitar líneas, cierre que invoca
`crearEnTransaccion` y marca la cuenta `cerrada` con `ventaId`, cancelar sin venta,
aislamiento por tenant.

### Manual (Frontend)

1. `docker-compose up`. El seeder crea el módulo Salones y salones/mesas demo para el
   tenant Paris.
2. Con caja física abierta: en `/salones` elegir salón → mesa → nueva cuenta → agregar
   productos → "Cerrar y cobrar" → verificar la venta en `/ventas`.
3. En `/configuracion/salones` crear salón/mesa, arrastrar mesas y "Guardar distribución".

---

## Decisiones

- Un módulo RBAC `Salones` con permiso extra `Operar` (patrón de `Reembolsar` /
  `Nota de crédito`) para separar administrar estructura vs. operar cuentas.
- Cierre reusa `VentasService.crearEnTransaccion` (atomicidad; evita el doble commit
  de `crear()`).
- Estado de mesa derivado, no almacenado.
- Drag & drop con pointer events nativos, sin nueva dependencia.
- `pos_x/pos_y` como fracción `0..1` para plano responsivo.

## Related Features

- [ventas.md](./ventas.md) — motor de ventas y POS reusado en el cierre.
- [gestion-cajas.md](./gestion-cajas.md) — caja física requerida para cobrar.
- [roles-permisos.md](./roles-permisos.md) — módulo RBAC `Salones` y permiso `Operar`.
