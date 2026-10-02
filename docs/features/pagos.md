# Feature: Módulo de Pagos (abonos y ledger)

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-07-23

---

## Overview

### What is it?

Módulo de pagos que permite registrar abonos a ventas pendientes y consultar el ledger (historial) de todos los pagos del tenant.

### Why does it exist?

Las ventas pueden quedar en estado `pendiente` (sin pagos) o `pagada_parcial` (abono parcial).
Este módulo permite cobrar esas ventas en uno o varios abonos posteriores a la creación, y provee una vista de todos los pagos recibidos.

### Scope

- **In scope**: `POST /pagos` (registrar abono), `GET /pagos` (ledger paginado), `GET /pagos/resumen` (KPIs), `AbonoModal`, página `/pagos`, detalle de venta con abono.
- **Out of scope**: integración con pasarela de cobro, conciliación automática, reversión de pagos.

---

## API Endpoints

### POST /api/pagos

Registra un abono a una venta pendiente o parcialmente pagada.

```
POST /api/pagos
Authorization: Bearer <token-con-tenant_id>
Idempotency-Key: <uuid por intento de abono>

Request:
{
  "ventaId": "uuid",
  "pagos": [
    { "metodoPagoId": "uuid", "monto": "5000", "referencia": "opcional" }
  ]
}

Response (201):
{ "id": "uuid", "ventaId": "uuid", "monto": "5000", ... }
```

**Errores:**
- `400` — venta no encontrada o no pertenece al tenant
- `400` — venta en estado `pagada` o `cancelada` (no se puede abonar), o sin saldo pendiente
- `400` — excedente sin método con `permite_vuelto = true`
- `400` — `metodoPagoId` no habilitado para el tenant
- `400` — sin caja abierta para el usuario
- `400` — falta la cabecera `Idempotency-Key` o no es un UUID
- `422` — la misma `Idempotency-Key` con otro abono (body con `ventaId`)

**Un abono que se repite no se registra dos veces** (2026-09-19,
[ADR-026](../adr/026-idempotencia-de-cobros.md)). Con la misma clave, el reintento después de
un corte devuelve el abono que ya entró, más `repetida: true`, en vez de registrar un segundo
pago. El `AbonoModal` guarda la clave **por venta** (`abono:<ventaId>`) a nivel de pestaña, así
que cerrar y reabrir el modal sigue siendo el mismo intento. La clave muere con el éxito.
⚠️ Recargar la página la pierde: un segundo abono ahí sale si a la venta le queda saldo, y el
listado recargado ya muestra el primero.

### GET /api/pagos

Lista paginada de pagos del tenant, ordenados por `creado_el` descendente.

```
GET /api/pagos?page=1&pageSize=15&metodoPagoId=uuid&ventaEstado=pagada
Authorization: Bearer <token-con-tenant_id>

Response (200):
{
  "data": [
    {
      "id": "uuid",
      "ventaId": "uuid",
      "monto": "5000",
      "vuelto": "0",
      "fecha": "2026-06-30T...",
      "cajaId": "uuid",
      "referencia": null,
      "metodoNombre": "Efectivo",
      "ventaEstado": "pagada",
      "totalFinal": "5000",
      "customerNombre": "Juan Pérez"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 15,
    "total": 42,
    "totalPages": 3
  }
}
```

Query params opcionales: `page`, `pageSize`, `fechaDesde`, `fechaHasta`, `metodoPagoId`, `cajaId`, `ventaId`, `ventaEstado`.

`fechaDesde`/`fechaHasta` siguen el contrato del resto de los filtros de fecha
(`rango-fecha.util.ts`): una fecha pura (`2026-09-16`) es el **día del negocio** del tenant —el
día local que termina en su hora de corte, no la medianoche del calendario— y `fechaHasta` lo
incluye completo; un timestamp con hora se respeta tal cual. Con `hora_corte = 0` (el default)
coincide con la medianoche de siempre. Hasta el 2026-09-18 la fecha pura se leía en UTC y
`fechaHasta` dejaba afuera el día elegido.

### GET /api/pagos/resumen

KPIs globales del tenant (independientes de filtros/página).

```
GET /api/pagos/resumen

Response (200):
{
  "totalPagos": 42,
  "montoCobrado": "150000.0000",
  "pagosHoy": 3,
  "montoHoy": "25000.0000"
}
```

"Hoy" es el **día del negocio** del tenant: el día local (zona de su provincia) que termina en
la hora de corte configurada (`tenants.hora_corte`, 0–6, default 0) —la misma ventana que el
resumen de descuadres de caja—. Con corte 0 coincide con la medianoche de siempre. Hasta el
2026-09-18 se resolvía en UTC y en Chile cortaba a las 21:00 (20:00 en invierno).

---

## Quién ve qué: el eje `Cajas:Leer`

`Pagos:Leer` es el **piso**; cuánto ves lo decide el mismo eje que en ventas, porque es la
**misma fila** vista de otro lado. La regla —sus **tres** ramas, por qué `MiCaja:Leer` quedó
afuera, y qué NO cierra— está una sola vez, en
[`ventas.md` → Quién ve qué](./ventas.md#quién-ve-qué-el-eje-cajasleer). Acá solo lo propio de
pagos.

**El filtro se deriva por la caja** (`p.caja_id → cajas.usuario_id`) porque `pagos` no guarda
quién lo hizo. Sin `verTodas`, se aplica a `listar` **y también a `resumen`**: si los KPI
fueran globales, la resta contra lo listado devolvería justo lo que el eje esconde.

⚠️ **La rama de la venta `online` también está acá, y no es simetría por prolijidad.** Sin
ella, `ventas` y `pagos` trataban distinto a la misma fila: el cajero veía la venta online y
sus pagos por `GET /ventas/:id` pero no en `/pagos`, así que la exclusión no compraba
seguridad y sí descuadraba `montoCobrado`/`montoHoy` contra `ventas/resumen`. Los pagos online
viven en la caja **virtual**, cuyo `usuario_id` es NULL.

⚠️ **Un borde conocido:** `registrarAbono` resuelve la venta **solo por tenant**, así que si el
cajero B abona una venta que abrió el cajero A, el pago cae en la caja de B y **sí** aparece en
su listado —es suyo—, mientras `GET /ventas/:id` de esa misma venta le responde 404. La fila
derivada se ve y la de origen no. No filtra plata ajena, pero es una regla partida en dos.

## Backend

### Module & Services

- **Module**: `src/modules/pagos/pagos.module.ts`
- **Controller**: `src/modules/pagos/pagos.controller.ts`
- **Service**: `src/modules/pagos/pagos.service.ts`

### Flujo de `registrarAbono`

1. Verificar caja abierta para el tenant+usuario.
2. Cargar la venta y validar que pertenece al tenant y está en estado abonable (`pendiente` o `pagada_parcial`).
3. Calcular el saldo pendiente: `total_final − Σ(pago_aplicaciones.monto WHERE tipo = 'venta')`.
4. Rechazar todo `metodoPagoId` que no esté en `tenant_metodo_pago` del tenant.
5. Calcular el excedente de pagos; validar `permite_vuelto` si hay excedente.
6. En transacción: crear registros en `pagos` → anotar el voucher duplicado de la máquina, si corresponde (ver abajo) → recalcular saldo → actualizar `venta.estado` → registrar movimientos de caja (efectivo).

### El abono no documenta, salvo el voucher duplicado (2026-10-02, E1 y E1b)

Lo que un abono paga **ya estaba documentado al entregar** (la boleta o factura nació con la
venta, se haya pagado o no): el abono no crea ningún documento, sea cual sea su medio
(`sistema` o `nadie`). Una sola excepción: un pago cuyo medio emite con la **`maquina`** hace que
la máquina imprima un voucher que vale como boleta sobre algo ya documentado. Ese pago deja un
documento `maquina` con `es_duplicado = true` (`VentaDocumentosService.registrarDuplicadoDeAbono`),
con su `pago_id` y, si el cajero los tipeó, el número y la clase del voucher (`PagoItemDto` suma
`numeroDocumento?` y `claseDocumento?`, con las mismas validaciones que `PagoVentaDto`: máx. 40,
sin caracteres de control; en un medio que no es de la máquina se ignoran sin error).

- Se anota solo si la venta tiene algún documento **vigente, no duplicado y de `sistema`,
  `maquina` o `externo`**: una fila `nadie` no cuenta, porque la deuda va siempre a `sistema` o
  `externo` (E1/E2). Una venta de $0 o de un país sin boleta no tiene nada que duplicar.
- Un pago cuyo aplicado a la venta fue 0 (todo propina) no da documento.
- **El cobro nunca se rechaza por esto**: el pago se registra igual y el contador corrige después.
- No cuenta para la cobertura del total de la venta ni para los topes de una nota de crédito.
- Una lectura y un `save` del array por abono, aunque haya varios pagos de la máquina; corre
  dentro de la transacción que ya tiene el lock de la venta.

### Reglas de negocio

- Solo se puede abonar a ventas en estado `pendiente` o `pagada_parcial`.
- **El saldo se mide sobre lo aplicado a la venta, no sobre el bruto cobrado.** Un pago
  puede repartirse entre venta y propina (`pago_aplicaciones` guarda el split); usar
  `Σ(pago.monto − pago.vuelto)` contaría la propina como pago de la venta y la dejaría
  en `pagada` con parte del total sin cobrar.
- **Un `metodoPagoId` que el tenant no tiene en `tenant_metodo_pago` se rechaza con 400.**
  La FK apunta al catálogo global, así que la base no lo frena: sin ese gate el pago se
  persiste y luego no aparece en `GET /pagos`, que hace INNER JOIN contra la tabla del
  tenant.
- **Un abono cobra solo lo que de verdad se debe** (2026-10-02, tarea 14 del frente de emisión):
  el tope es el saldo de la **expresión única** (`saldo-venta.ts`: `total − Σ aplicado a la venta −
  Σ correcciones "no vuelve plata"`), leído bajo el `FOR UPDATE` de la venta. Con saldo 0 → `400`
  ("La venta no tiene saldo pendiente"). Una nota "no vuelve plata" que cubrió la deuda ya dejó la
  venta en `pagada` y el abono se rechaza por estado: el cliente no paga dos veces lo perdonado.
- El estado de la venta se re-deriva tras cada abono con la regla única (`recalcularEstadoDeLaVenta`):
  - Saldo = 0 → `pagada`
  - saldo > 0 con algo aplicado → `pagada_parcial`
  - La respuesta trae `venta: { id, estado, saldo, puedeAbonar }`; `puedeAbonar` (estado que admite
    abono y saldo > 0) la decide el backend y la pantalla no replica la regla.
- `vuelto` se genera solo si algún método tiene `permite_vuelto = true` y la suma supera el saldo.
- **El vuelto se reparte entre los pagos que lo permiten, acotado al monto de cada uno**
  (orden determinista por `metodoPagoId`, mismo criterio que el split de propina). Ningún
  pago puede devolver más de lo que aportó: si pudiera, su neto (`monto − vuelto`) quedaría
  negativo y se persistiría un movimiento de caja `entrada` con monto negativo.
- **Si el excedente supera lo devolvible → 400.** Equivale a que los pagos con métodos sin
  vuelto superen el total a cobrar: ese excedente no hay con qué devolverlo. El frontend ya
  lo marcaba en `resumenCobro` (`excedenteSinVuelto`); ahora también es guard de backend.
- Los pagos son inmutables: no hay edición ni eliminación (soft delete solo para auditoría).
- **`monto` tiene que ser mayor a cero** (`@IsDecimalPositivo`, 2026-08-22): mismo gate que
  la línea de pago de una venta, que lo tenía desde siempre. Un abono negativo ya no llegaba
  a persistirse —el guard de `registrarMovimientoEnTransaccion` lo frena y revierte la
  transacción entera— pero contestaba **422 hablando de un movimiento de caja** en vez de
  del monto que el cliente mandó; y el **cero** no lo frenaba nadie, y dejaba pago,
  aplicación y movimiento de caja en cero sin aportar nada.
- **`monto` se rechaza con 400 si trae más decimales de los que admite la moneda oficial
  del tenant** (`@EsMontoCobrado` + `EscalaMonedaPipe`; medio peso chileno no existe). El
  contrato completo, incluido el de las pasarelas —**validan en su borde y nunca redondean
  ahí**— está en [backend.md](../patterns/backend.md).
- **`vuelto` no se cuantiza acá y no hace falta**: se deriva de un total que el motor de
  precios ya cerró en la escala de la moneda, así que hereda enteros por construcción. Era
  el caso medido (`pagos.vuelto = 994942.5000`) y se arregló sin tocar `pagos.service.ts`.
- ⚠️ **La excepción a la regla del 400 es el callback de reembolso de la pasarela**, que
  informa un hecho ya consumado: se cuantiza y se registra, no se rechaza. Vive en
  [reembolsos-nota-credito.md](./reembolsos-nota-credito.md), que es donde está ese camino.

---

## Frontend

### Páginas

| Página | Ruta | Descripción |
|--------|------|-------------|
| Ledger de pagos | `/pagos` | Tabla paginada server-side; filtros por método (`USelectMenu`) y estado de venta; KPIs vía `/pagos/resumen` |

### Componentes

| Componente | Ubicación | Responsabilidad |
|---|---|---|
| `AbonoModal` | `app/components/pagos/AbonoModal.vue` | Modal para registrar abono a una venta pendiente |

### AbonoModal

Props:
- `ventaId: string` — ID de la venta a abonar
- `saldo: string` — Monto pendiente, **del backend** (`GET /ventas/:id` → `saldo`; se usa como límite de cobro). El botón "Registrar pago" sale de `puedeAbonar`, del mismo detalle.
- `metodos: MetodoPago[]` — Métodos habilitados del tenant (con su `emisor`)
- `abonoConMaquinaDuplica: boolean` — del detalle de la venta (`GET /ventas/:id`); la pantalla no replica la regla

Comportamiento:
- **Voucher duplicado (E1b):** con la bandera y un pago cuyo medio emite con la máquina, avisa antes de confirmar: *"Esta venta ya tiene su boleta. El voucher de este pago también vale como boleta y la duplica. El cobro sigue, y queda marcado para que el contador lo corrija."* No bloquea. Ahí mismo pide el número y la clase del voucher (opcionales; `numeroDocumento` / `claseDocumento` en el pago). Sin la bandera no avisa ni los pide: el servidor los ignoraría. Después del abono el drawer vuelve a pedir el detalle y el documento aparece marcado "Duplicado — para el contador".
- Usa `v-model:open` para controlar visibilidad
- Emite `success` al registrar el pago con éxito (la página recarga la venta)
- Reutiliza helpers puros de `useVenta.ts`: `resumenCobro`, `sumaPagos`
- "Agregar pago" prellena el pago nuevo con el restante; al escribir un monto, los demás pagos absorben el excedente (`setMontoPago`: reducen empezando por el primero, nunca aumentan solos)
- Si los métodos sin vuelto superan el saldo, se deshabilita el confirmar con mensaje (validación al confirmar, no mientras se escribe)
- Los pagos que quedan en $0 se omiten al registrar (no ensucian el ledger)

### Composables

- `usePaginatedList` — listados paginados server-side (`app/composables/usePaginatedList.ts`)
- Helpers de cobro en `useVenta.ts`: `resumenCobro`, `setMontoPago`, `sumaPagos`

---

## Data Flow

### Registrar abono

```
[Usuario abre AbonoModal en /ventas?venta={uuid}]
  ↓
[Selecciona métodos de pago y montos]
  ↓ useApiFetch POST /pagos { ventaId, pagos }
[Controller valida DTO]
  ↓
[Service: verificar caja, cargar venta, calcular vuelto]
  ↓
[Transacción: crear pagos → actualizar estado venta → movimientos caja]
  ↓
[AbonoModal emite 'success']
  ↓
[VentaDetalleDrawer recarga venta (GET /ventas/:id)]
  ↓
[UI muestra nuevo estado y saldo actualizado]
```

---

## Testing

```bash
# Unit tests backend
cd backend && npm test -- --testPathPatterns=pagos

# Build frontend (smoke test)
cd frontend && npm run build
```

---

## Acceptance Criteria

- [x] POST /pagos registra abono y actualiza estado de venta
- [x] GET /pagos devuelve respuesta paginada con filtros
- [x] GET /pagos/resumen expone KPIs globales
- [x] Página /pagos usa paginación server-side y USelectMenu para método
- [x] Sidebar incluye entradas "Ventas" y "Pagos"
- [x] Estado `pagada_parcial` visible en UI (badge info)

---

## Propina en el POS

La propina ingresada en el POS (canal `fisico` sin mesero asignado) se persiste como `venta_propina` atribuida al garzón placeholder **"Mostrador"** del tenant, con `tipoGarzon = null`, `sesionGarzonId = null` y `turnoId = null`. Esta atribución neutral permite que la propina sume al pool sin asignarse directamente al placeholder.

### Por qué reparte correctamente

- El pool de liquidación (`buscarTipsElegibles`) no filtra por `tipo_garzon`, así que el monto suma al total a distribuir.
- Como `tipo_garzon = null`, el placeholder no matchea ningún grupo en `garzonesGrupo`, por lo que **nunca recibe dinero directo**.
- La plata se reparte entre los participantes reales según la configuración de distribución vigente del tenant.

### Edge del turno

- La propina de POS no tiene turno asignado (`turno_id = null`).
- Se liquida en la liquidación de **período completo** (sin filtro de turno).
- Operativamente: para liquidar las propinas de POS, ejecutar una liquidación del período sin especificar filtro de turno.

### Características del placeholder

- `activo = false` — no aparece en listados de garzones operacionales.
- `pin_hash` inutilizable — no se puede identificar por PIN.
- `es_placeholder = true` — marca interno para distinguir de garzones reales.
- Oculto en la UI de selección de garzones.

### Porcentaje sugerido

La ruta `GET /api/propinas/porcentaje-sugerido-venta` devuelve el porcentaje sugerido para una venta en el POS, guardado en `propina_configuracion.porcentaje_sugerido`. Requiere permiso `Ventas:Crear`.

### Habilitar/deshabilitar propina por canal

El admin puede apagar la propina por canal desde `/configuracion/propinas-distribucion`
(`propina_configuracion.habilitado_pos` / `habilitado_salones`, ver
[liquidacion-propinas-config.md](./liquidacion-propinas-config.md)). El enforcement
vive en `POST /ventas` (bloque 7g de `ventas.service.ts`), no en el DTO: si el canal
está deshabilitado, la propina enviada **se ignora**, no se rechaza — la venta se crea
igual, solo que sin fila `venta_propina`.

- **POS** (`dto.propinaDirecta`, único productor: `pos.vue`): se ignora si
  `habilitado_pos = false`. Con el flag en `true` (default), se registra como se
  describe arriba (garzón placeholder "Mostrador").
- **Salones** (`dto.propinaCierreMesa`, único productor: `salones.service.ts` al
  cerrar cuenta): se ignora si `habilitado_salones = false`. Con el flag en `true`
  (default), se registra atribuida al `garzon_responsable_id` vigente — ver
  [salones-mesas.md](./salones-mesas.md).
- Tenant sin fila de config aún (nunca abrió la pantalla de configuración): ambos
  canales se tratan como habilitados (`?? true`), preservando el comportamiento previo
  a este flag.
- **Venta `canal = 'online'`**: las dos propinas son del canal presencial (el POS y el
  cierre de mesa), así que una venta online que las mande se trata igual que un canal
  apagado — se ignoran aunque los dos flags estén encendidos. La config ni se consulta.

---

## Quién emite el documento: `emisor` por medio y `facturador` por comercio

Dos declaraciones que **solo se guardan y se editan** hoy; nada las lee todavía (las lee la
emisión por venta, spec `docs/superpowers/specs/2026-10-01-emision-por-venta-design.md`).

- **`tenant_metodo_pago.emisor`** — `'sistema' | 'maquina' | 'nadie'`, no nulo, default
  `'sistema'`. Dice quién emite el documento de lo cobrado con ese medio: el sistema arma
  la boleta, la máquina de tarjeta emite la suya, o nadie (la venta queda sin documento y
  emitirlo es responsabilidad del comercio). Va en `tenant_metodo_pago` y no en
  `metodos_pago` porque esa tabla es global: la regla sería la misma para todos los
  comercios. Un comercio nuevo (alta y seed) trae `'sistema'` en todos los medios: es el
  error barato, se corrige con una nota de crédito.
  `GET /metodos-pago` lo devuelve junto con `esEfectivo` por fila; `PATCH /metodos-pago/:id`
  lo acepta (`TenantAdminGuard`). Un valor fuera de la lista da 400, `null` también, y
  omitirlo conserva el que había.
- **`tenants.facturador`** — `'sistema' | 'externo'`, no nulo, default `'sistema'` (la
  conducta de hoy). Dice quién hace las facturas y documenta lo que queda debiendo: el
  sistema u otro facturador (el del SII, su software contable). Se lee por
  `GET /tenants/me` y se escribe por `PATCH /tenants/me` (admin), con las mismas reglas que
  `emisor`. No va por `preferencias-financieras`: ese `PUT` reemplaza toda la
  configuración de precios.
- Los dos tienen `CHECK` en la base (`chk_tenant_metodo_pago_emisor`,
  `chk_tenants_facturador`). La pantalla es `configuracion/metodos-pago`: un selector
  arriba de la tabla para el comercio y uno por fila para el medio.

---

## Related Features

- [ventas.md](./ventas.md) — Procesamiento de ventas y frontend POS
- [gestion-cajas.md](./gestion-cajas.md) — Cajas (requerida para el abono)
