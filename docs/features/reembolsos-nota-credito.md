# Feature: Reembolsos — visibilidad en ventas + Nota de Crédito interna

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-07-11

---

## Overview

### What is it?

Al reembolsar una orden de pasarela (total o parcial) desde el drawer de Órdenes,
el admin puede opcionalmente:

- **Generar una nota de crédito interna** (documento sin emisión SII) por el monto
  reembolsado, que referencia la venta original.
- **Devolver ítems a stock** (independiente de la NC): selecciona cantidades por
  línea. Sin nota de crédito de por medio ese camino solo mueve inventario, así
  que **exige que toda línea reponga** (`modo_inventario = 'cantidad'`); con nota
  de crédito, en cambio, cualquier ítem vendido se acredita y la reposición es
  una elección por línea (2026-09-04).

Además, el módulo de Ventas ahora **muestra los reembolsos siempre** (haya o no NC):
sección "Reembolsos" y "Documentos relacionados" en el detalle de la venta, y badges
derivados "Reemb. parcial" / "Reembolsada" / "NC" en el listado.

### Why does it exist?

Antes, el reembolso vivía solo en el módulo pasarela: la venta y sus pagos no se
enteraban, y los reportes seguían mostrando el total cobrado completo. La NC es el
tratamiento contable estándar (en Chile anula/corrige boletas y facturas) y queda
lista para el día en que se integre facturación electrónica.

### Scope

- Incluido: NC interna elegible en el reembolso; devolución de stock elegible
  (modo `cantidad`); **acreditación por línea de cualquier ítem vendido, reponga
  o no el stock (2026-09-04)**; visibilidad de reembolsos en detalle/listado de
  ventas;
  badges derivados (no son estados nuevos en BD); **NC manual desde el detalle
  de venta con egreso de caja elegible (2026-07-11)**.
- NO incluido (futuro): emisión tributaria real (SII/folios); **la REPOSICIÓN**
  en modos `serie`/`lote` (requiere elegir unidades/lote — se hace manual desde
  Inventario); egreso en el ledger de `pagos`; devolución de dinero por el
  método de pago original (el egreso es efectivo de caja).

  ⚠️ **Ojo con el primero:** desde el 2026-09-04 un ítem `serie`/`lote` **sí se
  acredita por línea**. Lo único que sigue afuera es que vuelva al stock.

---

## API Endpoints

### Reembolso extendido (existente, campos nuevos opcionales)

```
POST /api/pasarela/admin/ordenes/:id/reembolsos
Authorization: Bearer <JWT>   (permiso Pasarelas:Reembolsar)

Request:
{
  "monto": "1100",
  "generarNotaCredito": true,                          // opcional, default false
  "devoluciones": [                                    // opcional, independiente de la NC
    { "itemId": "uuid", "cantidad": "2" }
  ]
}

Response (200): orden pública + extras
{
  ..., "reembolsoAprobado": true,
  "notaCreditoId": "uuid",        // si se generó NC
  "warning": "..."                // si el reembolso se procesó pero la NC/devolución falló
}
```

- Si la NC/devolución falla después de un reembolso aprobado, **el reembolso NO se
  revierte** (la plata ya volvió por el proveedor): la respuesta trae `warning` y
  el error queda en logs.
- Los flags sin venta vinculada (`orden.venta_id` null) responden `warning`
  informativo y no hacen nada.

### GET /ventas/:id (campos nuevos)

- `ventaReferenciaId`, `tipoDocumento {id, codigo, nombre}`.
- `detalles[]`: + `itemId`, `modoInventario` (`null` = servicio), `cantidadDevuelta`.
- `reembolsos[]`: REFUNDs de las órdenes de pasarela vinculadas
  (`{id, monto, estado, fecha, ordenId, codigoOrden}`).
- `notasCredito[]`: NCs hijas (`{id, totalFinal, fecha, comentario}`).
- `disponibleNotaCredito` (2026-09-04): `{ total, porPorcion: [{clasificacion,
  monto}] }` — cuánto queda por acreditar, en total y por porción fiscal, **en
  cero cuando el documento no admite nota de crédito**. Detalle y su porqué en
  [`ventas.md`](ventas.md).

### GET /ventas (listado)

- `totalReembolsado` (Σ REFUND aprobados de órdenes vinculadas) y `esNotaCredito`.
- `GET /ventas/resumen` **excluye** las NCs de los KPIs.

---

## Backend

- **Nota de crédito** = venta con `tipo_documento_id` = la fila "Nota de Crédito"
  **del país del tenant** (`activo: false`, para que no aparezca en el selector
  del POS), `venta_referencia_id` → venta original, estado `pagada`,
  caja/canal/moneda copiados de la original. **La venta original nunca cambia de
  estado.**
- **La NC se compone: tiene líneas, neto e IVA** (2026-09-04). Dejó de ser un
  monto suelto con los totales copiados. Sigue sin pasar por el motor de precios
  —no hay precio que calcular, hay plata que ya se devolvió— pero **todo se
  deriva del documento que corrige**:

  | | De dónde sale |
  |---|---|
  | Línea de devolución | el ítem devuelto, valuado a **lo que costó en esa boleta** (`Σ total_linea / Σ cantidad` del ítem), no al precio de lista: `total_linea` ya lleva adentro el descuento de línea, el recargo y el prorrateo del descuento de venta |
  | Línea de ajuste | el resto del monto, en el ítem de sistema **"Ajuste"**, partido en una línea afecta y una exenta según la proporción del **remanente** (original − NCs previas − lo que esta misma nota devuelve) |
  | Neto e IVA de cada línea | la **tasa efectiva** de esa porción en la venta original (`Σ impuesto / Σ neto`), y el impuesto **por resta** para que `neto + impuesto = bruto` cierre exacto |
  | Totales de la cabecera | `total_bruto = Σ subtotal` (el neto, como en una venta normal), `total_impuestos = Σ impuesto`, `total_final = monto`, y las dos `base_ventas_*` como en `crear` |
  | Filas de `ventas_impuestos` | los impuestos que esa porción llevaba en el original, con el importe repartido entre ellos a prorrata |

  **La tasa se deriva de importes congelados y no se lee del catálogo** porque
  `item_impuestos` es por ítem: dos líneas afectas de la misma venta pueden
  llevar impuestos distintos y no existe "la tasa" que leer. La NC corrige aquel
  documento, así que hereda su criterio — el mismo principio que el redondeo.

  **Cualquier ítem vendido se acredita por línea, reponga o no el stock**
  (2026-09-04). `devoluciones` dejó de significar *"ítems a devolver a stock"* y
  significa *"ítems que se acreditan"*; la reposición es una propiedad de cada
  línea (`reponerStock`, ausente = repone si el ítem puede). Antes, nombrar un
  ítem exigía `modo_inventario = 'cantidad'`, así que recetas, combos y
  servicios no se podían acreditar por línea: caían al balde de ajuste y la nota
  decía *"Ajuste"* en vez del nombre del plato. **La razón de ese corte era el
  inventario**, así que hoy dispara según lo que el camino pida del stock:

  | Camino | Política ante una línea que no repone |
  |---|---|
  | Nota manual (`POST /ventas/:id/notas-credito`) | rechaza **solo si se PIDIÓ** reponer algo que no puede; lo que no repone se acredita igual |
  | Nota por el webhook de reembolso | **nunca rechaza**: el hook corre después del commit y un throw pierde el evento (`cobros.service.ts` lo traga como warning). Se acredita y no se repone |
  | Devolución sin documento (`registrarDevolucionesPorReembolso`) | **exige que toda línea reponga**: ese camino solo mueve inventario y no hay documento que acredite lo que no vuelve |

  **Acreditar menos de lo que vale la mercadería se acepta, y las líneas se
  escalan** (2026-09-04). Es un caso real —cargo por reposición, producto que
  vuelve dañado, un monto acordado en el mostrador— y hasta ese día se rechazaba
  con 400 en el camino manual. Se revirtió tras la investigación de mercado: ni
  el SII lo prohíbe (cantidad y precio unitario son **condicionales** en la Zona
  Detalle de una NC) ni el mercado lo rechaza (de 11 productos relevados, uno
  solo). Las líneas se bajan a prorrata con `repartirProporcional` para sumar
  exactamente el monto —no dividiendo línea por línea, que con un factor que no
  divide exacto deja la suma corrida— y **la que queda en cero no se escribe**,
  misma regla que el reparto del ajuste.

  - **El motivo pasa a ser obligatorio** cuando eso ocurre: es lo único que va a
    explicar, en el documento, por qué la línea vale menos que la mercadería. Es
    el patrón de Square y Toast —donde el monto es libre, el motivo es
    obligatorio— y reemplaza a la confirmación modal, que ninguno de los 11
    productos usa. Viaja **pegado al nombre del ítem** en la línea (*"Empanada ·
    Volvieron abiertas"*), no en su lugar: el documento tiene que decir las dos
    cosas.
  - **El precio unitario de una línea escalada sale de su propio importe**
    (`bruto / cantidad`), no del valor congelado: si no, la pantalla afirmaría
    `7 × $1.190 = $368`. La línea **no** escalada conserva el valor de la boleta
    — derivarlo también ahí movería el número persistido en más de la mitad de
    las líneas y volvería el precio unitario una propiedad de cada nota.
  - **Lo que se escala es la plata, no las unidades.** El movimiento de
    inventario sigue siendo por lo que físicamente volvió.
  - ⚠️ **Lo que se pierde, dicho de frente:** con las líneas escaladas el
    documento deja de decir cuánto valía la mercadería. Square guarda los dos
    números en campos distintos y nosotros no podemos, porque nuestras líneas
    tienen que sumar `total_final` — **exigencia nuestra, no requisito fiscal**.
    El dato no se pierde del todo: la cantidad devuelta queda en
    `movimientos_inventario` con su costo congelado, atada a la nota.

  **Lo que la propia nota devuelve deja de atraer ajuste.** El remanente
  descuenta las NCs previas *y* las líneas de devolución de esta misma nota. Sin
  eso, el ajuste puede acreditar de una porción más de lo que esa porción tenía
  y la nota siguiente arranca con remanente negativo: una línea de nota de
  crédito con importe e impuesto en negativo. El piso en cero que sigue al
  descuento es red, no regla.

  **Ninguna porción fiscal se acredita más de una vez, y por eso hay un segundo
  tope.** El tope global (`Σ NCs ≤ total_final`) mira el bruto y no ve la
  porción: una nota por monto libre se come capacidad afecta, y la devolución
  siguiente —valuada a su valor congelado— la vuelve a usar. Cada documento
  cierra bien por separado y **la serie acredita más IVA del que la venta
  cobró**. Medido: venta de 8.330 afecto (IVA 1.330) + 3.000 exento, una nota
  libre de 1.000 y otra que devuelve las 7 unidades ⇒ 1.447 de IVA acreditado
  contra 1.330 cobrado. Por eso una devolución cuya porción ya está acreditada
  se rechaza con 400 (camino manual) o queda fuera del documento (webhook), con
  el stock volviendo igual.

  📌 **Es el único rechazo de los ANTERIORES que sobrevive** —el frente agregó
  dos propios: motivo faltante al escalar, y pedir reponer lo que no puede— y
  sobrevive porque es invariante
  fiscal y no preferencia de producto: el error no se ve en el documento, se ve
  sumando la serie. Y **se evalúa sobre las líneas ya escaladas**: sobre los
  valores crudos rechazaría casos que el escalado deja perfectamente adentro
  —devolver 2.380 acreditando 500 asigna 500 a la porción afecta, no 2.380—.

  ⚠️ **El corte cierra el bruto, no el último peso del IVA.** El bruto acreditado
  por porción nunca pasa el original (medido: 0 violaciones en 16.000 secuencias
  de hasta 4 notas), pero cada nota descompone su propio bruto y cuantiza a la
  escala de la moneda, así que partir un bruto en varios documentos acumula
  residuo: **12,15 % de las series multi-nota acredita 1 o 2 minor units de IVA
  de más, con 2 como techo** (100.000 series). No escala con el monto. Sacarlo
  exigiría derivar el neto de cada nota contra el remanente de la serie: es
  decisión del owner, no está tomada.

  ⚠️ **Costo del corte, en el mostrador:** la última unidad de un ítem cuyo valor
  unitario no divide exacto puede no entrar. Con `total_linea` 1.001 en 3
  unidades cada una vale 334, y la tercera pide 334 contra 333 que quedan. Es 1
  minor unit y la mercadería vuelve igual desde Inventario; por eso el mensaje
  del 400 **no** lo atribuye solo a notas anteriores. La devolución se rechaza
  **completa**, no a medias: dejar la porción exenta adentro y la afecta afuera
  partiría el documento sin decírselo a nadie.

  **El movimiento de inventario corre solo sobre las líneas de devolución que
  reponen.** La de ajuste cuelga de un `servicio` y `registrarMovimiento` rechaza
  con 400 todo lo que no sea producto: sin ese corte, agregar la línea de ajuste
  haría fallar el reembolso entero. Desde el 2026-09-04 se agrega el filtro por
  `reponeStock`, porque una línea se puede acreditar sin volver al stock.

  ⚠️ **Y por eso el tope por cantidad dejó de contar solo movimientos.** Mientras
  toda línea aceptada movía stock, el movimiento ERA el rastro de la unidad; con
  líneas que se acreditan sin reponer, ese contador se quedaba ciego y dos notas
  seguidas podían acreditar la misma receta —el documento afirmando que volvieron
  2 unidades de una venta de 1—. El tope por porción no lo tapa: mira plata, no
  cantidad. Hoy `unidadesComprometidasPorItem` toma, **por documento**, el mayor
  entre lo acreditado en líneas y lo movido en stock (mayor y no suma: la línea
  que repone deja las dos huellas).
- **El ítem de sistema "Ajuste"** (`items.es_ajuste_nota_credito`, único vivo por
  tenant vía índice parcial): `venta_detalles.item_id` es NOT NULL, así que la
  línea de ajuste necesita colgar de algún ítem, y tiene que ser un `servicio`
  porque solo `tipo='producto'` tiene stock. Se siembra al crear el tenant, se
  excluye de todos los listados del catálogo y `remove()` lo rechaza. La NC lo
  pide con **find-or-create**: el webhook de reembolso no puede perder un evento
  ya consumado porque falte un dato de configuración.
- La aritmética vive aparte, pura y testeable sin Postgres:
  `ventas/nota-credito-composicion.ts`.
- `VentasService.crearNotaCredito` / `registrarDevolucionesPorReembolso`
  (`ventas.service.ts`): transacción propia con `FOR UPDATE` sobre la venta
  original (serializa NCs concurrentes). Validaciones: Σ(NCs) ≤ `total_final`;
  cantidad devuelta ≤ vendida − ya devuelta —contando lo acreditado por las notas
  hijas y no solo los movimientos de stock, porque desde el 2026-09-04 una línea
  se puede acreditar sin reponer—; y la política de reposición del camino
  (`validarDevolucionesReembolso`): la nota manual rechaza solo si se PIDE
  reponer lo que no puede, la nota por webhook nunca rechaza (un throw pierde el
  evento) y la devolución sin documento exige que toda línea reponga.
- **Borde de módulos**: `ReembolsoCallbackRegistry` en pasarela (mismo patrón §13
  que `PagoCallbackRegistry`); `VentasReembolsoHandler` (módulo ventas) se
  registra en `onModuleInit`. La pasarela nunca importa ventas.
- **Hook post-commit**: `CobrosService.reembolsar` dispara el handler DESPUÉS del
  commit de la transacción del reembolso (dentro se auto-bloquearía con el
  `FOR UPDATE` de la orden y un fallo de la NC revertiría un reembolso ya
  ejecutado por el proveedor).
- Índices nuevos: `pasarela_ordenes(venta_id)`, `pasarela_transacciones(orden_id)`
  (para el agregado de REFUNDs del listado de ventas).

## Cuál fila es la nota de crédito la dice el catálogo, no el código (2026-09-03)

`tipos_documento_tributario` lleva **`es_nota_credito`**, y el flujo de reembolso
resuelve `tenant → provincia → país → la fila marcada de ese país`. Sin ese tipo,
el reembolso se rechaza con 400: una NC sin marcar dejaría de encontrarse a sí
misma, porque **el tope de reembolso la busca por ese id**.

**El bug que esto cierra.** Hasta esa fecha el id salía de una constante
`TIPO_DOCUMENTO_NC_ID` con la fila **chilena código 61**, y se usaba sin mirar el
país: una devolución en un tenant argentino congelaba un documento chileno.
[ADR-010](../adr/010-preparacion-sii-datos-fiscales.md) es explícito en que lo
que se congela en la transacción es justo lo que después no se corrige.

**Qué se sembró y qué no.** Chile mantiene sus documentos de verdad (39/33/61).
De Argentina, Colombia y México se sembró **solo la nota de crédito interna** —sin
código tributario, `activo: false`, sin emisión—, que no es un documento
tributario sino el marcador que el reembolso necesita. Qué emite un local en esos
países entra cuando abra el frente fiscal de cada uno, que el owner decidió que va
a ser **progresivo** (2026-09-03). Relevamiento de las cuatro autoridades:
[`agent/investigaciones/2026-09-03-facturacion-electronica-latam.md`](../agent/investigaciones/2026-09-03-facturacion-electronica-latam.md).

⚠️ **El resumen de KPIs excluye las NC, y ese filtro se cae ENTERO si el país no
tiene el tipo.** No se compara contra `null`: un `IS DISTINCT FROM NULL` dejaría
afuera toda venta **sin** tipo de documento —que son la mayoría— y los KPIs darían
casi cero. Hay un test que lo fija.

## Redondeo: la NC hereda el criterio del documento que corrige (2026-08-21)

**La regla.** Una NC no redondea con las preferencias vigentes del tenant: lee el
`config_calculo` **congelado en la venta original** —escala de la moneda y modo de
redondeo— y cuantiza con ése. Después **congela el suyo propio**, copiando ese mismo
snapshot en la NC, para que pueda leerse sola sin ir a buscar la venta que corrige.

**Por qué.** La NC corrige *aquel* documento. Si el admin cambió el `modo_redondeo` de
`FLOOR` a `HALF_UP` entremedio, una NC que use el criterio de hoy puede no cuadrar contra
la venta que dice anular. El congelado es la misma idea de
[ADR-010](../adr/010-preparacion-sii-datos-fiscales.md) aplicada al redondeo, y usa la
misma función `cuantizar()` del motor de precios — no una fórmula propia, que derivaría en
silencio el día que el helper cambie.

### La excepción del webhook: un hecho consumado se registra, no se rechaza

Desde el frente de redondeo, la plata que **una persona** ingresa por API se **rechaza con
400** si trae más decimales de los que la moneda admite (ver
[backend.md](../patterns/backend.md)). **El callback de reembolso de la pasarela queda
afuera de esa regla, a propósito.**

| | Camino manual (`POST /ventas/:id/notas-credito`) | Callback de la pasarela |
|---|---|---|
| Qué es el monto | Una **intención** que se puede corregir | Un **hecho consumado**: la plata ya volvió al cliente |
| Decimales de más | **400** — el cajero corrige y reintenta | **Se cuantiza** y se sigue |
| Sin `config_calculo` en la venta | **400 ruidoso** — algo se rompió aguas arriba | Se persiste sin cuantizar antes que perder el evento |
| Traza | El error mismo | `logger.warn` con el **número original** que informó la pasarela |

**Rechazar el callback no deshace el cobro: solo pierde el evento.** El reembolso ya
ocurrió del lado del proveedor, así que un 400 dejaría el sistema sin registro de plata que
sí se movió, y sin NC que la explique. Por eso se cuantiza —con el criterio congelado en la
venta, no con el vigente— y se deja en el log el valor exacto que llegó, para poder
reconstruirlo después. Si el monto ya venía bien no se loguea nada.

⚠️ Esto es también por qué el guard de `config_calculo` faltante vive **detrás** de
`validarVentaElegible`: ese flag solo lo manda el camino manual. Un guard incondicional
haría que el webhook perdiera exactamente el evento que esta excepción protege.

Dónde vive: `VentasReembolsoHandler.cuantizarMontoReembolso`
(`ventas/reembolso-callback.handler.ts`) y el cierre de línea de
`VentasService.crearNotaCredito`.

## Frontend

- `ordenes/ReembolsoModal.vue`: prop `ventaId`; con venta vinculada muestra
  checkbox "Generar nota de crédito" y la lista de líneas (inputs decimales
  string; máximo = vendida − ya devuelta). Respuesta con `warning` → toast
  warning.
  ⚠️ **La lista es compartida con la NC y su modo depende del checkbox**
  (2026-09-04), porque el camino del backend depende de él: con la nota tildada
  se acredita cualquier ítem y hay switch de reponer por fila; **sin** ella las
  líneas van al camino que solo mueve stock, que exige que todas repongan, así
  que las de serie/lote/servicio quedan deshabilitadas. Al destildarlo se
  normalizan las filas —la que el operador había apagado con el switch vuelve a
  reponer, la que no puede pierde la cantidad—: ese `false` quedaba invisible
  porque el switch desaparece del DOM, y su 400 llega **después** del commit del
  reembolso.
- `ventas/VentaDetalleDrawer.vue`: badges "Nota de Crédito" y
  "Reembolsada parcial/totalmente" (derivados); cards "Reembolsos" y
  "Documentos relacionados" (links venta original ↔ NCs vía `/ventas?venta=<id>`).
  **Sobre una nota de crédito** (2026-09-04): el rótulo de la tabla dice "Líneas
  de la nota" y cada línea muestra su **porción fiscal** (`afecto` / `exento`) en
  un badge. No es cosmética: las dos líneas de ajuste llevan la misma glosa —la
  que escribió el operador— y sin la porción el documento muestra dos filas
  idénticas con importes distintos. El resto del drawer ya servía sin tocarlo:
  la tabla de líneas con sus reglas congeladas y la fila "Impuestos" de los
  totales existían desde antes.
- `ventas/NotaCreditoModal.vue` (2026-09-04): muestra el **disponible por porción
  fiscal** debajo del total —solo si hay más de una: en una venta toda afecta
  repetir el total es ruido—, un **switch de reponer por fila** (deshabilitado
  con su nota en lo que no puede volver al stock) y **pide el motivo** cuando lo
  marcado vale `≥` el monto.
  ⚠️ **Pide, nunca bloquea.** Esa cuenta es aproximada: el backend valúa cada
  línea y la **cuantiza con el `modo_redondeo` congelado de esa venta**, y
  replicar ese cuantizador acá sería el tercer hogar de una regla de plata. Se
  probó sin cuantizar y quedaba peor: con 3 unidades de 1.000 el botón se
  deshabilitaba para una nota que el backend acepta, mostrando "vale $333, más
  que los $333". Por eso se compara con `≥` y no con `>` —pedirlo un peso antes
  de tiempo no molesta— y **queda una ventana de hasta un minor unit por línea**
  donde el 400 llega igual. Anotado en `pendientes.md`.
- `pages/ventas/index.vue`: badges "NC" / "Reemb. parcial" / "Reembolsada" junto
  al estado.

## NC manual desde el detalle de venta (2026-07-11)

```
POST /api/ventas/:id/notas-credito
Authorization: Bearer <JWT>   (permiso dedicado Ventas:Nota de crédito)

Request:  { "monto": "5000", "comentario": "...", "devolverDinero": true,
            "devoluciones": [{ "itemId": "uuid", "cantidad": "1" }] }
Response 201: { "id": "<uuid NC>", "totalFinal": "5000.0000",
                "movimientoCajaId": "<uuid>" | null }
```

- Elegibilidad: venta `pagada`/`pagada_parcial` de cualquier canal, nunca sobre
  otra NC. La venta original no cambia de estado.
- `devolverDinero`: movimiento `salida` ("Devolución · Nota de crédito") en la
  caja física abierta del usuario, en la **misma transacción** que la NC
  (todo-o-nada; valida saldo suficiente). Sin caja o sin saldo → 422.
- **Tope de la devolución en efectivo (2026-07-27):** `Σ(pagos en efectivo aplicados
  a la venta) − Σ(ya devuelto en efectivo por NCs anteriores)`. El saldo global de la
  caja no alcanza como control: viene de otras ventas, así que sin este tope se puede
  sacar plata que esta venta nunca ingresó, y dar billetes por una compra con tarjeta.
  Excederlo → 422.
  **Acota el dinero, no el documento.** La NC puede seguir emitiéndose por el total
  (tope `total_final − Σ NCs previas`, regla dura del SII): anular una venta cobrada a
  medias es legítimo —borra la cuenta por cobrar—, devolver efectivo que nunca entró no.
  La devolución por el medio de pago original (tarjeta vía Transbank) ya existe en el
  módulo `pasarela` y **no pasa por este camino**; componer ambas patas en una sola
  operación es tema abierto:
  `docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md` §6.
- Backend: `VentasService.crearNotaCreditoDesdeVenta` → `crearNotaCredito` con
  flags `validarVentaElegible`/`devolverDinero`; el flujo de reembolsos de
  pasarela llama sin flags y no cambia.
- Frontend: botón "Nota de crédito" en `VentaDetalleDrawer` +
  `ventas/NotaCreditoModal.vue` (checkbox de dinero deshabilitado sin caja
  abierta — `GET /caja/activa`; devolución de stock igual al `ReembolsoModal`).
- La lógica de devolución a inventario compartida entre `NotaCreditoModal` y
  `ReembolsoModal` vive en `composables/useDevolucionInventario.ts` (helpers
  puros con spec Vitest: agrupación por ítem, validación, payload) + el
  componente presentacional `components/DevolucionInventarioLista.vue`.
- Spec: `docs/superpowers/specs/2026-07-11-nota-credito-pos-design.md`.

## Testing

- `ventas.service.spec.ts`: crearNotaCredito (composición por monto libre y con
  devoluciones, validaciones de monto/cantidades/modo/tenant, la original no se
  toca), devoluciones sin NC, findOne/listar/resumen con los campos nuevos.
- `nota-credito-composicion.spec.ts`: la aritmética sola —tasa efectiva,
  descomposición por resta, reparto del ajuste y **el escalado de las líneas de
  devolución**— con `decimalesMoneda: 0`, que es la escala que más residuo
  produce.
- `nota-credito-composicion.e2e-spec.ts`: el camino de la app sobre una venta
  mixta real — dos líneas y totales derivados, el corte de inventario en la línea
  de ajuste, la proporción tomada del remanente con una NC previa, el
  find-or-create del ítem de sistema y, desde el 2026-09-04: **la receta
  acreditada por línea sin mover inventario**, `reponerStock: false`, el
  **escalado** con su motivo obligatorio, la línea que queda en cero y no se
  escribe, el tope por porción sobre las líneas ya escaladas, y el disponible por
  porción —también sobre un documento que no admite nota—.
- `nota-credito-por-pais.e2e-spec.ts`: la forma del catálogo de documentos.
- `reembolso-callback.handler.spec.ts`: registro en el registry y delegación.
- `cobros.service.spec.ts`: hook post-commit (evento completo, warning sin
  revertir, rechazado no dispara, sin venta vinculada, regresión sin flags).
- `create-reembolso.dto.spec.ts`: validación anidada del DTO.

## Referencias

- Spec: `docs/superpowers/specs/2026-07-10-reembolso-nc-visibilidad-design.md`
- Plan: `docs/superpowers/plans/2026-07-10-reembolso-nc-visibilidad.md`
