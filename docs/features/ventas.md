# Feature: Procesamiento de ventas (transaccional)

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-07-01

---

## Overview

### What is it?

Endpoint transaccional que registra una venta completa en una sola operación atómica: cabecera + líneas + reglas aplicadas (descuentos/recargos/impuestos) + datos del cliente + pagos, con descuento automático de stock. Canal **físico** únicamente en esta versión.

### Why does it exist?

Es el corazón del POS: sin él no hay ventas registradas. Concentra en una sola transacción de base de datos todas las tablas involucradas para garantizar consistencia.

### Scope

- **In scope**: canal `fisico`, pagos inline con auto-estado (`pagada`/`pendiente`), cálculo de vuelto, movimientos de inventario y caja dentro de la transacción, historial en `/ventas`, POS en `/ventas/pos`.
- **Out of scope**: canal `online`/caja virtual, notas de crédito.

---

## API Endpoints

### GET /api/tipos-documento

Lista tipos de documento tributarios del país del tenant.

```
GET /api/tipos-documento
Authorization: Bearer <token-con-tenant_id>

Response (200):
[
  {
    "id": "uuid",
    "nombre": "Boleta",
    "codigo": "39",
    "requiereCustomer": false
  },
  {
    "id": "uuid",
    "nombre": "Factura",
    "codigo": "33",
    "requiereCustomer": true
  }
]
```

Usada en el frontend para renderizar el selector de documento y aplicar fricción (cliente obligatorio en Factura, opcional en Boleta).

### POST /api/ventas

Crea una venta completa.

```
POST /api/ventas
Authorization: Bearer <token-con-tenant_id>

Request:
{
  "tipoDocumentoId": "uuid",                    // opcional
  "lineas": [
    {
      "itemId": "uuid",
      "cantidad": "1",
      "personalizacion": { ... },               // opcional (recetas y combos)
      "descuentoIds": ["uuid"],                 // opcional
      "recargoIds":   ["uuid"],                 // opcional
      "impuestoIds":  ["uuid"],                 // opcional
      "unidadIds":    ["uuid"],                 // modo serie
      "loteId":       "uuid"                    // modo lote
    }
  ],
  "pagos": [
    { "metodoPagoId": "uuid", "monto": "1069810.0000", "referencia": "opt" }
  ],
  "customer": { "nombre": "Juan Pérez", "rut": "12.345.678-9" },  // opcional
  "comentario": "string",                       // opcional
  "metodoPagoId": "uuid",                       // para el motor de precios (desc/recargos por método)
  "descuentosVentaIds": ["uuid"],               // descuentos a nivel de venta
  "recargosVentaIds":  ["uuid"]
}

Response (201):
{
  "id": "uuid",
  "canal": "fisico",
  "estado": "pagada | pendiente",
  "totalFinal": "1069810.000000",
  ...
}
```

**Errores:**
- `400` — sin caja abierta para el usuario
- `400` — excedente de pago sin método con `permite_vuelto = true`
- `400` — `metodoPagoId` no habilitado para el tenant (rollback completo)
- `400` — stock insuficiente (rollback completo)

**Una línea no lleva precio (2026-08-30).** El precio sale de `item.precioBase` —más lo
que agregue la personalización— y lo calcula el servidor. Hasta esa fecha había un
`precioUnitario` opcional y estrictamente positivo (decisión del owner del 2026-08-11: el
`0` era el único camino para dejar una línea sin monto **sin rastro de quién la regaló**).
Se sacó entero: no lo alimentaba ningún cliente —el POS no lo incluye en
`toVentaLineasBody`, la tienda lo evita a propósito y `cerrarCuenta` arma el body en el
servidor— y era el segundo canal por el que un precio podía entrar desde afuera. La venta
gratis legítima sigue existiendo por los dos caminos de siempre: un ítem con
`precio_base` 0, o un descuento, que queda en la traza del cálculo con su regla y su monto.

⚠️ El `ValidationPipe` corre con `whitelist: true` y **sin** `forbidNonWhitelisted`, así
que un cliente que todavía mande `precioUnitario` no recibe un 400: se le **ignora en
silencio** y la venta se cobra al precio de catálogo. Mismo comportamiento en
`POST /api/calculo-precios/calcular`, donde el campo también se fue.
Ver `docs/features/motor-calculo-precios.md` § *El precio de una línea lo calcula el
servidor*.

### POST /api/ventas/:id/anular

Anula una venta — el *void* del dominio, distinto de la devolución. Permiso propio
`Ventas/Anular` (no `Actualizar`: es la operación más sensible del módulo y el mercado la
trata aparte).

```
POST /api/ventas/{id}/anular
Request: { "motivo": "Ingresada por error", "reponerStock": true }
Response (201): { "id": "uuid", "estado": "cancelada", "stockRepuesto": true, "motivo": "..." }
```

**Solo aplica a una venta `pendiente`, sin pagos y sin documento tributario.** Ahí no hay
hecho fiscal que compensar ni dinero que devolver, así que se puede deshacer de verdad —
y sigue siendo válido después de integrar el SII, que no permite anular un DTE aceptado.
Todo lo demás se revierte con nota de crédito.

- `motivo` obligatorio, mínimo 10 caracteres: una anulación sin explicación no sirve como
  auditoría. Queda en `ventas.motivo_cancelacion`, junto con `cancelada_el` y
  `cancelada_por_usuario_id`.
- `reponerStock` (default `true` en la API) devuelve al kardex lo que la venta descontó, con motivo
  **`anulacion`** — distinto de `devolucion`, porque anular una venta mal ingresada y que
  un cliente devuelva mercadería son eventos distintos. En `false` el descuento original
  queda como pérdida (equivalente a la "Anulación no Recuperable" de Toteat).
- **Lo que se devuelve sale del kardex, no de las líneas de la venta** (2026-08-22). La
  regla es "revertir las salidas que esta venta produjo", y quien las conoce es
  `movimientos_inventario`. Tres consecuencias que la lista de líneas no daba:
  una línea de **receta o combo** repone sus ingredientes/componentes (no tiene stock
  propio: antes desaparecía en silencio y la respuesta igual decía que había repuesto);
  un ingrediente **no bloqueante que se vendió sin stock** no vuelve, porque nunca salió;
  y **editar la receta después de vender** no cambia lo que hay que devolver.
- Reponer stock exige que **todo lo que salió** sea `modo_inventario='cantidad'`; serie y
  lote se rechazan con el mismo mensaje que la devolución de una NC (registrarlo a mano
  desde Inventario). Se valida antes de mover nada: no deja media reposición hecha.
- **`stockRepuesto` dice lo que pasó, no lo que se pidió:** una venta que no movió
  inventario (puros servicios) responde `false` aunque `reponerStock` viniera en `true`.
- Reponer toma un `FOR UPDATE` por ítem, así que la anulación ordena por `itemId` con el
  **mismo comparador que la venta** y reintenta ante `40P01`, igual que `crear()`. Dos
  órdenes distintos volverían a hacer posible el cruce que el orden fijo evita.

**Errores:** `400` motivo corto · `400` estado distinto de `pendiente` · `400` con pagos ·
`400` con documento tributario · `400` reponer stock de serie/lote · `403` sin permiso.

**El default del checkbox de reposición lo decide la cocina, no la API** (decisión del
owner 2026-08-15; caso mixto cerrado el 2026-08-23). En la pantalla, "Reponer el stock que
la venta descontó" nace **destildado** si la venta salió de una cuenta de salón con
**alguna** línea ya enviada a cocina, y explica por qué. La razón es del local, no técnica:
reponer comida que ya se cocinó mete al inventario ingredientes que **físicamente no
existen**, y eso es peor que no reponer.

- Es **un solo checkbox para toda la venta** y basta con que **una** línea se haya
  despachado. Partirlo por línea sería más fino y menos usable: el cajero está anulando la
  venta entera, no reconciliando el inventario plato por plato.
- Es un **default, no un bloqueo**: el cajero lo tilda igual si la mercadería sigue
  vendible (la botella que volvió cerrada).
- La venta de POS, que no viene de ninguna cuenta, sigue naciendo **tildada**.
- El dato lo expone `GET /ventas/:id` como `tieneLineasDespachadas` (ver abajo). El
  **backend no cambia**: sigue haciendo lo que `reponerStock` diga.

Origen de la decisión: `docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md`.

### GET /api/ventas/resumen

KPIs globales del tenant (no dependen de la página actual del listado).

```
GET /api/ventas/resumen
Authorization: Bearer <token-con-tenant_id>

Response (200):
{
  "totalVentas": 42,
  "totalFacturado": "1250000.0000",
  "saldoPendiente": "85000.0000"
}
```

### GET /api/ventas

Lista paginada de ventas del tenant autenticado. Query params: `page` (default 1), `pageSize` (default 15, max 100), `estado`, `canal`. La respuesta incluye campos enriquecidos por fila: `montoPagado` (suma de pagos menos vuelto) y `saldo` (total_final − montoPagado).

```
GET /api/ventas?page=1&pageSize=15&estado=pendiente&canal=fisico

Response (200):
{
  "data": [
    {
      "id": "uuid",
      "canal": "fisico",
      "estado": "pagada",
      "totalFinal": "1069810.0000",
      "montoPagado": "1069810.0000",
      "saldo": "0.0000",
      "fecha": "2026-06-29T...",
      "creadoEl": "2026-06-29T..."
    }
  ],
  "meta": { "page": 1, "pageSize": 15, "total": 42, "totalPages": 3 }
}
```

### GET /api/ventas/:id

Retorna la venta con sus relaciones expandidas: `detalles`, `descuentos`, `recargos`, `impuestos`, `customer`, `pagos`. Incluye `montoPagado` y `saldo`.

`tieneLineasDespachadas` (booleano) dice si la venta salió de una **cuenta de salón con
alguna línea ya enviada a cocina**. Es el único consumidor de ese puente hacia salones, y
existe para el default del checkbox de anulación (arriba). Se resuelve con un `EXISTS`
dentro de la misma consulta de la cabecera —`cuentas` → `cuenta_lineas` con
`cantidad_enviada > 0`—, así que no agrega ni una ida a la base; `cantidad_enviada` vive
solo en `cuenta_lineas`, nunca en `venta_detalles`. `false` en la venta de POS.

---

## Quién ve qué: el eje `Cajas:Leer`

`Ventas:Leer` es el **piso** —dice si podés entrar—; el que dice **cuánto ves** es un eje
aparte, y lo gobierna un permiso de otro módulo. La regla completa tiene **tres** ramas:

| Situación | Alcance | Por qué |
|---|---|---|
| Tiene `Cajas:Leer` | **Todo el tenant** | Es el nivel de supervisión. |
| No lo tiene, y el tenant **no contrató** el módulo `Cajas` | **Todo el tenant** | Ahí la supervisión no existe como concepto: `Cajas:Leer` es inobtenible **incluso para el admin**, así que acotar sería permanente e irreversible por configuración. Es el caso de la tienda **solo online**. |
| No lo tiene, y el tenant **sí contrató** `Cajas` | **Lo de sus cajas** | Que no lo tenga es una decisión de configuración, no una ausencia del concepto. |

📌 **`MiCaja` y `Cajas` se venden juntos, y con `Ventas` presencial** (regla del owner,
2026-08-22). No son dos productos: son **dos alcances de permiso modelados como módulos** — uno
es la operación del cajero sobre su propio turno y el otro la supervisión de las cajas ajenas, y
sueltos no sirven. Esa convención es la que hace que la rama 2 solo alcance a la tienda **solo
online**, que es su justificación escrita.
⚠️ **Nada en el código la sostiene:** el alta de tenant **no contrata ningún módulo**
(`tenant_modulos` arranca vacío) y se agregan de a uno por `POST /admin/tenants/:id/modules`, sin
endpoint para quitarlos. O sea que un tenant con `MiCaja` y sin `Cajas` es construible por
descuido al dar de alta, y ahí sus cajeros se verían la plata entre ellos. Es un error de
aprovisionamiento, no un paquete que exista — se decidió **no** codificar la dependencia entre
módulos, que hoy el catálogo no tiene.

⚠️ **`MiCaja:Leer` no entra en la regla, y es a propósito.** La primera versión lo usaba y era
**fail-open**: sacarle `MiCaja:Leer` a un rol que conserva `MiCaja:Crear` le concedía
visibilidad total, y `Crear` alcanza para operar caja de punta a punta. Quitar un permiso no
puede conceder acceso. Detalle en el docblock de `resolverAlcanceDerivadoDeCaja`.

**Por qué el eje de caja y no uno propio:** ni `ventas` ni `pagos` guardan quién los hizo —solo
`caja_id`—, así que la autoría **se deriva de la caja** (`caja_id → cajas.usuario_id`), exacto
porque una caja abierta pertenece a un solo usuario. El permiso que decide *"¿ves cajas
ajenas?"* es entonces el mismo que decide *"¿ves ventas ajenas?"*. Mecánica y las **dos**
funciones que no hay que confundir (la de caja lanza 403, esta no) en
[`patterns/backend.md` §16](../patterns/backend.md).

**De dónde salió (2026-08-22).** Antes de esto, un cajero con `Ventas:Leer` listaba **todas** las
ventas del tenant y podía abrir el detalle de cualquiera — y el detalle trae `caja_id`, `monto`
y `vuelto` **por pago**, así que era el camino largo para reconstruir el esperado de una caja
ajena. Ahora el detalle de una venta que no es suya responde **404**, y en el detalle de una
venta propia el `caja_id` de un pago que no es suyo **viaja en `null`**.

**Lo que arregla es más grande que el modo ciego:** hasta acá cualquier cajero veía la
facturación entera del local. Medido después de construir el eje: el admin ve 87 pagos de 18
cajas, el cajero ve 3, de las 2 suyas.

⚠️ **El detalle de una venta ajena responde `404`, no `403`** — un `403` confirmaría que existe.

⚠️ **Lo que este eje NO cubre: las escrituras por id.** `POST /ventas/:id/notas-credito` y
`POST /ventas/:id/anular` siguen resolviendo la venta **solo por tenant**, así que un usuario
acotado puede operar sobre una venta que `GET /ventas/:id` le oculta. Hoy no es alcanzable con
el rol `Vendedor` del seed —no tiene esos dos permisos—, pero el eje es de **lectura** y no hay
que leerlo como si cubriera todo.

⚠️ **La venta `canal='online'` la ve cualquiera con `Ventas:Leer`**, aunque no sea de nadie: va
siempre contra la caja **virtual** del tenant, que nunca se cuenta físicamente, así que no puede
revelar el esperado de ningún cajón que alguien vaya a arquear. Sus **pagos** también entran en
el listado, por la misma razón — si no, la misma fila tendría dos reglas distintas y los KPI de
pagos quedarían descuadrados contra los de ventas.
⚠️ **Eso vale mientras online exija pago completo.** No es una propiedad del canal: descansa en
que `crear` rechaza una venta online sin pago total y en que el abono opera siempre sobre caja
física. Si algún día se habilita pago contra entrega o abono parcial online, hay que volver a
mirar este filtro.

⛔ **Lo que NO arregla, y conviene no confundirlo:** el cajero **sigue pudiendo deducir el
esperado de su PROPIA caja** sumando sus propios pagos — verificado corriendo la demostración
otra vez con el eje puesto: dedujo 20.357 contra 20.357 reales. Y está bien que pueda, porque
esos pagos los cobró él. Cerrarlo exigiría quitarle su propio historial de ventas, que es la
misma aritmética que hizo descartar el ocultamiento del resultado post-conteo.
**Corolario:** contra la caja propia, el modo ciego es **fricción, no barrera** — evita el
maquillaje casual, no a quien lleva la cuenta. Lo que sí garantiza, y antes no, es que **no vea
la plata de otros**.

⚠️ **Tampoco cerraba los dos oráculos** del modo ciego (el `422` de
`POST /caja/:id/movimientos` y el de la nota de crédito en efectivo). No salen de un listado
sino del borde aceptar/rechazar de una validación legítima.
✅ **Resueltos por RASTRO el 2026-08-23**, que es lo que el owner había decidido: el chequeo
queda intacto y el intento rechazado se registra en `caja_intentos_rechazados` para que lo
lea el supervisor. Del lado de ventas cambia **solo el mensaje**: el `422` del tope de la
devolución en efectivo ya **no interpola el monto disponible** —era un oráculo de UN request,
que entregaba el efectivo cobrado de la venta sin emitir ninguna NC— y el tope en sí, el
monto de la NC y la semántica del documento no se tocaron. Detalle del mecanismo y de la
lectura del supervisor en
[`features/gestion-cajas.md`](./gestion-cajas.md#rastro-de-intentos-rechazados).

## Backend

### Module & Services

- **Module**: `src/modules/ventas/ventas.module.ts`
- **Controller**: `src/modules/ventas/ventas.controller.ts`
- **Service**: `src/modules/ventas/ventas.service.ts`

### Entities & Database

| Entity | Tabla |
|--------|-------|
| `Venta` | `ventas` |
| `VentaDetalle` | `venta_detalles` |
| `VentaDescuento` | `ventas_descuentos` |
| `VentaRecargo` | `ventas_recargos` |
| `VentaImpuesto` | `ventas_impuestos` |
| `VentaCustomer` | `venta_customer` |
| `Pago` | `pagos` |
| `TipoDocumentoTributario` | `tipos_documento_tributario` |

Todas con soft delete (`eliminado_el`) y triada de auditoría. PKs UUID con `type: 'uuid'` (ADR-004).

**La línea es un snapshot, no un puntero al catálogo.** `venta_detalles` congela
`descripcion`, `clasificacion_tributaria`, `precio_unitario`, `tasa_cambio` y —desde el
2026-08-02— **`unidad_codigo_base`**: en qué unidad está `cantidad`. Sin ella el número no
tiene magnitud (`2` no dice si son 2 unidades o 2 kg) y había que leer `items` para saberlo.
Es `NOT NULL`; para servicios, recetas y combos vale `'unidad'`.

Distinta de `unidad_codigo_presentacion`, que es nullable y solo existe cuando la línea se
vendió por presentación ("2 cajas"): describe **cómo se pidió**, no en qué unidad está el
número con el que calculó el motor.

⚠️ Hoy esa unidad **no puede derivar**: `items.service.ts` bloquea cambiarla en un producto
con movimientos no-`ajuste`, vender siempre registra uno y nada soft-borra movimientos
(medido 2026-08-02). Congelarla es **defensa en profundidad** —que la línea no dependa de un
guard de otro módulo— y sobre todo hace que el dato **exista en la venta**, que es lo que el
detalle necesita para mostrar "2,5 kg" en vez de "2,5". Ver también el congelado de reglas en
[`motor-calculo-precios.md`](motor-calculo-precios.md).

### Flujo transaccional (`crear`)

1. Verificar caja abierta (`cajaService.findActiva`)
2. Cargar items + resolver moneda oficial (`pais.moneda_oficial_id` — ADR-005 y ADR-021)
3. Convertir precios a moneda oficial (`precioOrigen × tasa_cambio`)
4. Llamar `calculoPreciosService.calcular` → importes autoritativos
5. Calcular excedente; validar `permite_vuelto` si hay excedente; determinar estado
6. `dataSource.transaction`: guardar cabecera → detalles → trazas de reglas → customer → inventario (`salida/venta` por producto) → pagos → movimientos de caja (efectivo)

### Dependencias reutilizadas

| Servicio | Uso |
|----------|-----|
| `CalculoPreciosService.calcular` | Fuente autoritativa de todos los importes |
| `InventarioService.registrarMovimiento(manager, ...)` | Ya manager-aware, entra en la misma TX |
| `CajaService.findActiva` | Busca caja física abierta |
| `CajaService.registrarMovimientoEnTransaccion(manager, ...)` | Nuevo método extraído para entrar en la TX |

---

## Nuevos estados de venta

| Estado | Cuándo se asigna |
|--------|-----------------|
| `pendiente` | La venta se crea sin pagos y con total > 0 |
| `pagada_parcial` | Al registrar un abono parcial: saldo > 0 pero < total_final |
| `pagada` | El saldo llega a 0 (lo aplicado a la venta ≥ total_final), **incluido el caso de total $0 sin ninguna línea de pago** |
| `cancelada` | Anulación explícita |

**Una venta de total $0 es una venta PAGADA, sin línea de pago.** Es el caso real de una
promoción que descuenta el 100%: la venta existió, descuenta stock, emite su documento y
**no** aparece como deuda. El estado se deriva siempre de lo aplicado
(`calcularEstadoVenta`), sin condicionarlo a que existan pagos — condicionarlo dejaba esa
venta en `pendiente` con saldo $0, arrastrándose en los listados de deuda. Ni el POS ni la
tienda registran un pago de $0 con un método elegido a dedo: simplemente no mandan pagos.

⚠️ Esto **no** afloja la regla de que *"las ventas online requieren el pago completo"*, que
es anterior e independiente: una venta `online` con total > 0 y sin pagos sigue rechazándose
con `400`. Lo que cambió es qué estado se calcula, no quién puede crear una venta sin pagar.

**No existe `borrador`** (eliminado del enum el 2026-07-27): la venta en construcción vive
en `cuenta`/`cuenta_lineas` de salones, que es el *open ticket* del dominio; un estado
paralelo en `ventas` sería una segunda forma de resolver lo mismo.

`cancelada` la asigna `POST /ventas/:id/anular` (ver abajo), acotada al subconjunto seguro.

El saldo se recalcula en cada abono sobre **lo aplicado a la venta**, no sobre el bruto
cobrado: `saldo = total_final − Σ(pago_aplicaciones.monto WHERE tipo = 'venta')`.

La distinción no es cosmética: un pago puede repartirse entre venta y propina
(`pago_aplicaciones` guarda el split), así que `Σ(pago.monto − pago.vuelto)` contaría la
propina como si pagara la venta y la dejaría en `pagada` con parte del total sin cobrar.
Misma fuente en `listar()`, `resumen()` y `registrarAbono()`.

---

## Frontend (POS)

Interfaz de punto de venta para crear una venta desde el catálogo hasta el cobro final.

### Ruta y Componente Principal

- **Ruta**: `/ventas/pos` (`app/pages/ventas/pos.vue`)
- **Layout**: Dos paneles — catálogo + buscador a la izquierda, carrito + desglose + cobro a la derecha
- **Gate**: Panel bloqueante si no hay caja abierta (verifica estado en el store de cajas)

### Componentes

| Componente | Ubicación | Responsabilidad |
|---|---|---|
| `CatalogoGrid` | `app/components/ventas/CatalogoGrid.vue` | Buscador de items + grilla de productos; emite `add` al carrito |
| `ClienteForm` | `app/components/ventas/ClienteForm.vue` | Datos del cliente (nombre, RUT, dirección, teléfono, email); exporta tipo `CustomerForm` |
| `CarritoPanel` | `app/components/ventas/CarritoPanel.vue` | Líneas del carrito con `AppCantidadInput` (±, selector de unidad de la misma magnitud), selector de tipo de documento, desglose, botón Cobrar |
| `CobroModal` | `app/components/ventas/CobroModal.vue` | Modal de pagos múltiples con distintos métodos, cálculo de vuelto, confirmación y emisión de POST /api/ventas |

| `AppCantidadInput` | `app/components/AppCantidadInput.vue` | Stepper + selector de unidad (misma magnitud); emite cantidad canónica y presentación |

### Cantidad con unidad de presentación

- Cada línea guarda **cantidad canónica** (`cantidad`, unidad base del ítem) para precio/stock y **presentación** (`cantidadPresentacion` + `unidadCodigoPresentacion`) para UI/tickets.
- Helpers en `app/utils/cantidad-presentacion.ts`; catálogo de unidades vía `useUnidadesMedidaStore().ensureLoaded()`.
- POST `/ventas` envía ambos campos cuando el operador eligió una unidad distinta a la base (ej. `500 g` → canónica `0.5` kg).

### Composable & Lógica Pura

- **`useVenta.ts`** (`app/composables/useVenta.ts`): Helpers puros sin Nuxt ni Vue (100% testeables con Vitest)
  - `puedeCobrar(tipoDoc, customer)` — valida si se puede proceder a cobro (Boleta sin cliente OK; Factura requiere nombre)
  - `resumenCobro(carrito, detalles)` — resume montos por tipo de descuento/recargo/impuesto
  - `sumaPagos(pagos)` — suma total de pagos para calcular vuelto
  - `setMontoPago(total, pagos, indice, monto)` — fija el monto de un pago y los demás absorben el excedente (reducen desde el primero, con piso 0; nunca aumentan solos). El pago nuevo se prellena con el restante y los pagos en $0 se omiten al confirmar
  - `resumenCobro` marca `excedenteSinVuelto` cuando los pagos con métodos sin vuelto superan el total (ese excedente no se puede devolver); el vuelto solo se acredita si proviene de métodos con vuelto
  - `toCalculoInput(carrito, metodoPago, descuentosVenta, recargosVenta)` — estructura payload para `/calculo-precios/calcular`

- **Estado reactivo**: `ref` del carrito; el resultado del cálculo lo maneja
  `useResultadoCalculado()` (debounce 300 ms), que lo mantiene atado al carrito que lo
  produjo — ver `docs/patterns/frontend.md` §10.1. El botón Cobrar espera un cálculo
  vigente antes de abrir el modal: el `:total` que se cobra sale de ahí.

### Fricción por Documento

- **Boleta**: cliente opcional — se puede cobrar sin datos del comprador.
- **Factura**: cliente obligatorio — campo de nombre debe estar completado para habilitar botón "Cobrar".
- **Validación en cliente** vía `puedeCobrar()` y cambio de estado del botón Cobrar.

### Testing

```bash
cd frontend && npm test -- app/composables/useVenta.spec.ts    # 15/15 Vitest
```

---

## Testing

```bash
# Unit tests (6 casos: estado pagada/pendiente, vuelto, inventario, servicio-sin-stock)
cd backend && npm test -- --testPathPatterns=ventas

# E2E tests (9 casos contra Docker PostgreSQL)
cd backend && npm run test:e2e -- --testPathPatterns=ventas --forceExit
```

---

## Frontend — historial y detalle de ventas

Implementado en 2026-06-30; rutas unificadas en 2026-07-01.

### Páginas (rutas canónicas)

| Página | Ruta | Descripción |
|--------|------|-------------|
| Historial de ventas | `/ventas` | Tabla con filtros, KPIs; fila clickeable abre detalle |
| Detalle de venta | `/ventas?venta={uuid}` | Drawer lateral (`VentaDetalleDrawer`): líneas, totales, pagos, saldo; botón "Registrar pago" para `pendiente`/`pagada_parcial` |
| Punto de venta | `/ventas/pos` | Crear venta (ver sección POS arriba) |

### Redirects de compatibilidad

| Ruta legacy | Destino |
|-------------|---------|
| `/ventas/historial` | `/ventas` (conserva query string) |
| `/ventas/:id` | `/ventas?venta=:id` |

### Componentes

| Componente | Ubicación | Responsabilidad |
|---|---|---|
| `VentaDetalleDrawer` | `app/components/ventas/VentaDetalleDrawer.vue` | Detalle expandible, pagos, abono |
| `AbonoModal` | `app/components/pagos/AbonoModal.vue` | Abono a venta pendiente/parcial |

### AbonoModal

`app/components/pagos/AbonoModal.vue` — modal para registrar abonos a ventas pendientes:
- Props: `ventaId`, `saldo` (monto pendiente), `metodos` (métodos de pago del tenant)
- Reutiliza helpers de `useVenta.ts`: `resumenCobro`, `setMontoPago`, `sumaPagos`, `PagoInput`
- Al confirmar: `POST /pagos` con `{ ventaId, pagos: [...] }`; emite `success` para que la página recargue

---

## Pendiente (fase futura)

- **Filtrado avanzado en historial** — Rango de fechas, búsqueda por cliente, exportación
- **Comprobante imprimible** — Generación y descarga de PDF del comprobante de venta
- **Descuentos/recargos manuales** — Aplicación inline de descuentos o recargos por línea o a nivel de venta
- **Canal online** — Soporte de ventas en canal `online` con caja virtual automática
- **Notas de crédito** — Creación de notas de crédito referenciando ventas originales

---

## Notes

- `tenant_id` y `usuario_id` siempre del JWT, nunca del body.
- El estado se determina como `pagada` si `sumaPagos - excedente ≥ totalFinal`.
- Efectivo heuristic: `permite_vuelto = true` en `tenant_metodo_pago` indica método en efectivo.
- Plan de implementación: `docs/superpowers/plans/2026-06-29-procesamiento-ventas.md`.
