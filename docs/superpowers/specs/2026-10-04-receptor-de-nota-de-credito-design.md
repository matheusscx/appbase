# La nota de crédito lleva el receptor de la venta que corrige

**Fecha:** 2026-10-04 · **Tipo:** spec de diseño · **Fiscal: frente propio** (`CLAUDE.md`, ADR-010)
**Frente:** *"La nota de crédito no lleva el receptor de la venta que corrige"* (estaba en
`pendientes.md` § 6; cerrada en [`resueltos.md`](../../agent/resueltos.md)).
**Decisiones:** el bloque "Cómo arrancarlo" de esa entrada: el owner por AskUserQuestion, con el
análisis y la investigación de la "Sesión de esfuerzo máximo".

---

## 1. El problema

En la nota de crédito (61), el SII exige `RUTRecep` y `RznSocRecep` en **toda** NC (Formato DTE
v2.5, págs. 19-21). Hoy la NC no escribe `venta_customer`: la de una Factura queda sin receptor
propio (medido: el detalle y el ticket de la NC dan `customer: null`), y la de una boleta sin
cliente no deja dicho a nombre de quién va. Quien devuelve está en el mostrador cuando se hace la
nota; después no hay cómo saber quién era (ADR-010: lo que no se congela se pierde).

## 2. Reglas

1. **La corrección copia el receptor de la venta que corrige**, en su misma transacción: todas las
   filas vivas de `venta_customer` de la venta, con todas sus columnas (`tercero_id` incluido).
   Vale para **toda** corrección —NC de Factura, de boleta con cliente y devolución interna—, la
   manual y la del webhook de la pasarela. Sin ramas por tipo.
2. **"La nota va al mismo cliente que la venta."** Si la venta tiene cliente, mandar un receptor es
   un 400: no se cambia el receptor de un documento con una NC.
3. **Venta sin cliente:** la NC acepta un `receptor` opcional con **nombre y RUT**, los dos
   obligatorios si viene. Nombre ≤ 100 sin blancos en los bordes; en Chile el RUT se valida (rango
   y DV) y se guarda normalizado, como el de la venta (`rutValido`, `normalizarRut`); en otro país,
   en pausa, se guarda como vino. Se congela como el `venta_customer` de la NC.
4. **Sin cliente y sin receptor capturado, una NC con tipo de documento** (no la devolución
   interna, que no es documento tributario) queda con **`ventas.receptor_es_emisor = true`**: "a
   nombre del propio emisor" (FAQ SII 001.380.6571.003). Se congela el hecho, no los datos del
   local: el RUT y la razón social se derivan al emitir. La nota automática de la pasarela, sin
   nadie en el mostrador, cae siempre acá o en la copia.
5. **En una venta sin cliente, la pantalla precarga el receptor de la última nota que lo capturó**
   (owner, 2026-10-04, por AskUserQuestion de la Sesión de esfuerzo máximo): si el sistema ya
   sabe quién es el comprador, usar la excepción "a nombre del emisor" va contra lo que publica el
   SII. El cajero lo puede cambiar o borrar (devuelve otra persona). Es una lectura de la serie
   para precargar; el servidor congela lo que llega en el body.

**Invariante, sobre la serie de notas de una venta:** toda NC con tipo de documento tiene receptor
(fila en `venta_customer`) **o** la marca de emisor, nunca las dos ni ninguna; y si la venta tiene
cliente, cada nota de la serie lleva exactamente ese. En una venta sin cliente, las notas de la
serie **no** tienen por qué llevar el mismo: el cajero puede cambiarlo.

## 3. Diseño

### Backend

- **`Venta.receptorEsEmisor`** (`receptor_es_emisor boolean NOT NULL DEFAULT false`, tipo
  explícito) con `@Check` que solo admite `true` en una corrección (`venta_referencia_id IS NOT
  NULL`). El default deja válidas las ventas y notas que ya existen: no hace falta backfill y
  Railway sincroniza sobre una base con ventas.
- **`CreateNotaCreditoDto.receptor?`** (`ReceptorNotaCreditoDto`: `nombre` 1..100, `rut`
  string no vacío). `@IsObject` + `@ValidateNested`, como el `customer` de la venta.
- **`crearNotaCreditoEnTransaccion`**, después del lock y antes de guardar la nota: lee las filas
  de `venta_customer` de la venta (una consulta). Con filas y `receptor` → 400. Sin filas y con
  `receptor` → lo valida (lee el país solo en este caso). Calcula `receptorEsEmisor`. Después de
  guardar la nota, guarda las copias (o el capturado) con **un** `save` del array.
- **Huella de idempotencia:** suma `receptor` (`null` si no vino). Reintentar con otro receptor es
  otra nota (422 "con otros datos").
- **`GET /ventas/:id`** devuelve `receptorEsEmisor`; en `tipoDocumento`, `rutChileno` (el país
  del tipo: la pantalla valida el RUT capturado igual que el servidor); y `receptorSugerido`
  (`{ nombre, rut }` de la última nota de la venta con `venta_customer`, solo si la venta no tiene
  cliente; una consulta).

### Frontend

- **`NotaCreditoModal`**: con la venta sin cliente (y salvo en la devolución interna, que no es
  documento tributario), un bloque "Datos del cliente (opcional)" con
  nombre y RUT, precargado con `receptorSugerido`. Si se llena uno, se exige el otro; con `rutChileno`, el RUT se valida con
  `rutValido` (`useReceptor`). Sin datos, avisa que la nota va a nombre del local. Manda
  `receptor` solo si se llenó.
- **`VentaDetalleDrawer`**: el cliente de una NC sale solo (es su `customer`); con
  `receptorEsEmisor`, muestra "A nombre del local".

### Fuera

- El ticket de la NC imprime el cliente copiado o capturado sin cambios; la marca de emisor no se
  imprime (no hay emisión todavía, ADR-010).
- No toca `venta_documentos` ni `documentarVenta`.
