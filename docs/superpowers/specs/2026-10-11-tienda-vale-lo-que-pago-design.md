# Spec: la venta online vale lo que se pagó

**Date**: 2026-10-11 · Entrada: [`pendientes.md`](../../agent/pendientes.md) § 3, "La tienda calcula el
total dos veces…", opción **A** (owner, 2026-10-09). D y E ya están construidas (`63628bef`).
**Frente fiscal y de motor: va solo, con el sistema quieto** (`CLAUDE.md`, ADR-010).

## Problema

`POST /online/pagar` calcula el total y lo autoriza en Webpay. Al volver el comprador,
`OnlineCallbackHandler` crea la venta con `VentasService.crear`, que **recalcula** desde el snapshot
(solo ítem y cantidad) con el catálogo y el reloj del retorno. Si algo que mueve el total cambia en
el medio, la venta se rechaza y la orden queda `pagada` sin venta. Medido el 2026-10-09 con
[`tienda-dos-ahoras.e2e-spec.ts`](../../../backend/test/tienda-dos-ahoras.e2e-spec.ts): 6 de 7 casos
quedan sin venta (hora, fecha, precio que sube, precio que baja, precio que baja con
`permite_vuelto`, tasa). Solo el control sin cambios crea la venta.

## Decisión del owner

**"Vale lo que pagó"**: `pagar` congela en la orden el resultado resuelto por el servidor —líneas,
impuestos, reglas y promos aplicadas, total— y el callback crea la venta con eso, **sin
recalcular**. Nunca viene del cliente.

## Por qué no alcanza con el precedente `lineasCongeladas`

`crearEnTransaccion` ya acepta `lineasCongeladas` (lo usa el cierre de salón): congela precio, tasa y
reglas de línea. Las reglas congeladas llevan su `vigente`, así que cubriría precio, tasa y el caso
de la fecha. **No cubre el caso de la hora**, ni lo que el owner pidió congelar:

- Con `lineasCongeladas` el motor **igual corre**. Las promos se cargan del catálogo vivo y se
  evalúan contra el `new Date()` del retorno (`instantesDeLineas`). El happy hour que termina sigue
  dejando la orden sin venta.
- Los impuestos se leen vivos a propósito en ese camino (docblock de `crearEnTransaccion`).

Cubrir la hora por ese lado exigía meter un "instante congelado" en el motor, y la venta seguiría
recalculando con promos e impuestos vivos. Se descartó, igual que crear la venta pendiente en
`pagar` (descontaría stock y documentaría antes del cobro: preguntas de producto nuevas).

## Diseño

### 1. Lo que se congela (`CheckoutSnapshot`)

`CheckoutSnapshot.checkout` gana un campo `congelado: VentaCongelada`:

```ts
/** Lo que `pagar` resolvió y cobró. Canal interno: nunca un campo de DTO. */
export interface VentaCongelada {
  /** El resultado del motor tal como se autorizó en Webpay. */
  resultado: ResultadoVenta;
  /** 1:1 con `resultado.lineas` y con `checkout.lineas`, en el mismo orden. */
  lineas: {
    precioUnitarioOrigen: string;   // en la moneda del ítem
    monedaIdOrigen: string;
    tasaCambio: string;             // la que une origen y `resultado.lineas[i].precioUnitario`
    clasificacionTributaria: string; // la que decidió el IVA cobrado
  }[];
}
```

El tipo vive en `ventas.service.ts`, al lado de `LineaCongelada`, porque es lo que `ventas`
consume; `online` lo importa.

`ResultadoVenta` ya es JSON plano de strings: líneas con sus trazas (descuentos, recargos,
impuestos, promos), `trazasVenta`, totales, advertencias y `config`. Viaja en `pasarela_ordenes.metadata`
(jsonb) sin transformación. `checkout.totalFinal` queda, porque es lo que `pagar` le pide a Webpay;
el pago de la venta sale de `congelado.resultado.totales.totalFinal`, que es el mismo número.

### 2. `OnlineService.pagar` — congela al calcular

Para que origen, tasa y precio convertido no se contradigan, `pagar` hace la conversión como la
hace hoy la venta y se la pasa al motor por el canal interno:

1. `prepararLineasCheckout` ya carga los ítems con `cargarBasePorIds` (`precioBase`, `monedaId`,
   `clasificacionTributaria`). Los devuelve junto con lo que ya devuelve.
2. Se resuelven la escala de la moneda oficial, la config (`cargarConfig`) y las tasas
   (`MonedasService.findMonedas`, misma forma que `tasaMap` del motor: oficial = 1).
3. Por línea: `precioConvertido = convertirAMonedaOficial(precioBase, monedaId, tasaMap, modoRedondeo)`
   —la misma función que usan el motor y la venta—.
4. `calcular` recibe esas líneas con `precioUnitarioResuelto` y `precioUnitarioOrigenResuelto`, y la
   config por `configPrecargada`.
5. El snapshot guarda `{ resultado, lineas: [{precioBase, monedaId, tasa, clasificacion}] }`.

Es la misma cuenta que hace hoy el motor solo, así que el total autorizado no cambia. La
conversión queda en dos lugares (venta y tienda): se acepta, la regla del repo extrae a la tercera.

**Una ventana que se acepta:** `clasificacionTributaria` sale de la lectura de `pagar`, y el motor
lee el ítem de nuevo dentro de `calcular`. Si alguien cambia la clasificación justo entre las dos
lecturas de la misma request, lo congelado y lo cobrado difieren. Es la misma ventana que tiene hoy
`crearEnTransaccion` (lee el ítem y después lo vuelve a leer el motor).

La rama demo (`modo: 'simulado'`) no se toca.

### 3. `VentasService.crearEnTransaccion` — parámetro `ventaCongelada`

Parámetro interno nuevo, después de `lineasCongeladas`, con el mismo régimen: nunca en un DTO,
porque lleva plata ya resuelta. Se agrega también a `crear` y `crearConReintento`, que son la
puerta del callback (fuera de transacción, con reintento por deadlock). Con un congelado
determinista, reintentar da el mismo resultado.

Cuando viene:

- **Coherencia, antes de escribir nada:** `resultado.lineas.length` y `congelado.lineas.length`
  igualan `dto.lineas.length`, y por línea coinciden ítem (sin distinguir mayúsculas) y cantidad
  canónica. Si no coinciden es un error del servidor, no del cliente: `Error` con mensaje propio.
  El dispatcher deja el motivo genérico en `motivo_sin_venta` ("Error interno al registrar la
  venta…") y el mensaje en el log, que es como ya trata todo error que no es HTTP.
- **No** se resuelve personalización (la tienda no la manda), **no** se carga la config, **no** se
  convierte y **no** se llama a `calcular`. `resultado = ventaCongelada.resultado`.
- `venta_detalles` toma de lo congelado `precio_unitario_origen`, `moneda_id_origen`,
  `tasa_cambio`, `clasificacion_tributaria` y `precio_unitario` (= `resultado.lineas[i].precioUnitario`).
  Todo lo demás sale de `resultado`, igual que hoy: totales, trazas, `config_calculo`.
- Los documentos (`documentarVenta`) arman sus porciones desde los detalles, así que heredan la
  clasificación congelada sin cambio.

Lo que **sigue vivo**, a propósito:

- caja virtual y tipo de documento;
- que el ítem exista y se pueda vender (404 si se borró, rechazo de ingrediente y de serie);
- el stock (`registrarMovimiento`);
- el umbral de identidad de la boleta (`faltaIdentidadDelPagador`), que mira el total congelado;
- el pago exacto de E, que ahora se cumple por construcción;
- `descripcion` (nombre del ítem): sale del catálogo al retorno, como en el cierre de salón. No es
  plata ni dato fiscal.

Que el ítem no exista o no tenga stock deja la orden pagada sin venta, con el aviso de D. Es lo que
la decisión del owner ya dice que A no cubre.

### 4. `OnlineCallbackHandler`

Pasa `checkout.congelado` a `ventasService.crear`. El monto del pago sale de
`congelado.resultado.totales.totalFinal`.

Si la orden no trae `congelado` (una orden creada antes del deploy y resuelta después), **lanza**
un `Error`. El dispatcher deja el motivo genérico en `motivo_sin_venta` y el detalle en el log, y la
orden queda avisando como cualquier otra sin venta. No hay fallback a recalcular: sería mantener vivo el
camino de los dos "ahora". El proyecto no tiene datos productivos, y la ventana es la de un pago en
vuelo durante un deploy.

### Seguridad del congelado

- Solo el servidor escribe `metadata.checkout`: la API externa (`POST /pasarela/api/pagos`) llama a
  `iniciar` sin `metadataExtra`, y sus órdenes despachan por HTTP (`callbackModo: 'http'`), nunca al
  handler in-process.
- `metadata` no sale en ninguna respuesta (`toPublico` lo omite, también en la vista admin).
- El cliente no puede mandar `precioUnitarioResuelto` ni `precioUnitarioOrigenResuelto`: no están
  en `LineaDto` y el pipe global tiene `forbidNonWhitelisted`.

## Tests

**Unitarios**

- `online.service.spec`: `pagar` guarda un `congelado` cuyo `resultado` es el que devolvió
  `calcular`. El motor recibe `precioUnitarioResuelto` igual a la conversión y `configPrecargada`.
  Las líneas congeladas llevan origen, moneda, tasa y clasificación del ítem.
- `online-callback.handler.spec`: pasa el congelado a `crear`, y el pago es su `totalFinal`. Sin
  congelado, lanza.
- `ventas.service.spec`: con `ventaCongelada`, `calcular` y `cargarConfig` no se llaman, y los
  detalles persisten origen, moneda, tasa, clasificación y precio congelados. Un ítem o una cantidad
  que no coinciden lanzan antes de cualquier `save`.

**E2E (`tienda-dos-ahoras.e2e-spec.ts`, se da vuelta a propósito)**

- Control: igual que hoy.
- Hora, fecha, precio que sube, precio que baja, precio que baja con `permite_vuelto`, tasa: la
  orden queda `conciliada` con venta, `total_final` = autorizado, y sin `motivo_sin_venta`.
  - En la hora, la venta tiene su fila en `venta_promociones`. En la fecha, su fila en
    `venta_descuentos`. En la tasa, `venta_detalles.tasa_cambio` es la del pago (950).
- **Caso fiscal nuevo:** la tasa de un impuesto adicional del ítem cambia (`PATCH /impuestos/:id`)
  entre el pago y el retorno. La venta queda con el impuesto cobrado en `venta_impuestos`.
- Los tests que hoy fabrican la orden sin venta subiendo el precio (el reembolso manual y el aviso
  al admin con un rol que no es admin) pasan a fabricarla con lo que A no cubre: el ítem se borra
  entre el pago y el retorno.
- El título y el docblock del archivo dejan de decir que la venta se rechaza.

Se re-miden los 7 casos de la tabla y la tabla nueva va a `resueltos.md`.

## Fuera de alcance

- **`verificar`** marca hoy la orden de la tienda como pagada sin venta ("se confirmó por
  verificación"). El owner dijo que se puede revisar cuando exista A: con el congelado, crear la
  venta ahí ya no recalcularía el precio, aunque sí dependería del ítem y del stock vivos. **No se
  cambia**; se le avisa a la orquestadora.
- **"Ligar la orden pagada sin venta a una venta"**, en espera hasta después de A: no se toca.
- **Pasarela demo:** crea la venta por `POST /ventas`, que recalcula. No hay cobro real.
- **Stock en el pago:** la tienda no reserva stock al pagar; sigue así.

## Docs en el mismo commit

- La entrada sale de `pendientes.md` § 3 y va a `resueltos.md` (sección nueva arriba, con la tabla
  re-medida).
- [`tienda-online.md`](../../features/tienda-online.md): el párrafo "Lo que todavía lo deja
  abierto".
- [`ventas.md`](../../features/ventas.md): el canal `ventaCongelada`.
- [`motor-calculo-precios.md`](../../features/motor-calculo-precios.md): la tienda congela el
  resultado y la venta online no vuelve a llamar al motor.
- [ADR-009](../../adr/009-callback-pasarela-venta-por-callback.md): actualización con fecha (el
  snapshot pasa a llevar el resultado).
- `docs/ESTADO.md` si tiene fila de la tienda. El párrafo "Detenerse y preguntar" de `CLAUDE.md`
  no nombra este frente: no se toca.
