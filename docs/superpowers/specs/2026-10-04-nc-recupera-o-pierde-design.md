# Spec: la nota de crédito pregunta si lo devuelto se recupera o se pierde

**Status**: Done
**Date**: 2026-10-04
**Owner**: Cesar Matheus
**Frente**: fiscal (va solo, ADR-010). Entrada de `docs/agent/pendientes.md` § 3, *"La nota de
crédito miente distinto sobre la misma línea de receta"*.

## 1. El problema, medido en el código

La nota de crédito acredita por línea cualquier ítem vendido (desde 2026-09-04), pero el stock
solo vuelve en un caso: **producto en modo `cantidad`**. Lo decide `validarDevolucionesReembolso`
con `LEFT JOIN item_producto` sobre la **línea**: una receta o un combo no tienen fila ahí, así que
caen en `modo_inventario === null` y se tratan como un servicio. Sus ingredientes/componentes
salieron del inventario al vender y **no vuelven por ningún camino**; si alguien pide que repongan,
el 400 dice *"no maneja stock (servicio)"*, que para una receta es falso.

`cancelar` ya lo resolvió del otro lado: revierte **lo que el kardex dice que salió** por
`venta_id`. Pero el kardex no liga el movimiento a la línea, y la NC devuelve **por ítem y por
cantidad** (`devoluciones[{ itemId, cantidad }]`), no la venta entera: con dos recetas que comparten
el pan, el kardex no dice qué pan salió por cuál.

## 2. Lo que decidió el owner (pendientes.md, 2026-08-23 y 2026-09-29)

1. La NC **pregunta siempre que haya stock de por medio** —producto suelto, receta, combo— si lo
   devuelto **se recupera o se pierde**. Una sola regla, sin excepción que explicar: la botella
   puede volver rota y la hamburguesa armada no vuelve a ser pan y carne.
2. Si se recupera, **repone**. Si se pierde, **sale como merma**.
3. La causa de esa merma es **una fija, "Devolución"**, que el sistema crea en cada tenant, para que
   las devoluciones se vean aparte en el reporte de mermas sin que nadie elija nada.

Queda para esta sesión decidir si el tenant puede renombrarla o borrarla (§ 4.1).

## 3. Diseño

### 3.1 El kardex sabe de qué línea salió cada movimiento

Columna nueva, nullable: **`movimientos_inventario.venta_detalle_id`** (`uuid`, sin FK, con índice
no hace falta: se lee siempre junto a `venta_id`, que ya tiene el suyo).

- **La venta la escribe en toda salida** (`crearEnTransaccion` → paso 7f): la del producto, y por
  `ContextoConsumo` la de cada ingrediente de receta, componente de combo y opción de grupo
  (`venderIngredientesReceta`, `venderComponentesCombo`, `venderOpcionesGrupos`). Es la línea
  (`detalles[i].id`) que ya está guardada antes del paso 7f.
- **La NC la escribe en lo que revierte**: el mismo `venta_detalle_id` de la línea vendida (la
  primera línea del ítem en la venta original). Así "la línea a la que pertenece el movimiento"
  significa lo mismo en la salida y en su vuelta.
- Ventas anteriores a la columna (sin datos productivos, owner): el producto sigue andando porque
  se reconoce por `item_id`; una receta/combo vieja no tiene salidas ligadas, así que no pregunta
  ni mueve nada, como hoy.

### 3.2 Qué devuelve una línea: la misma fuente que `cancelar`, acotada

Un solo lector, `salidasPorItemVendido(ventaId)`: las salidas `venta` de la venta agrupadas por
**ítem vendido** (`COALESCE(línea.item_id, m.item_id)`) y por ítem movido, con su modo y su costo
de salida. Lo usan la emisión (bajo el lock de la venta) y el detalle (`GET /ventas/:id`), así que
la pantalla pregunta exactamente donde el servidor exige respuesta.

Para devolver `q` unidades del ítem vendido `X` (con `V` vendidas y `R` ya acreditadas por notas
anteriores —`unidadesComprometidasPorItem`—), por cada ítem movido `I` con `T` salido por las
líneas de `X`:

```
cantidad(I) = q                                   si I = X (el producto suelto: lo que volvió)
cantidad(I) = r4(T·(R+q)/V) − r4(T·R/V)           si I ≠ X (ingrediente, componente, opción)
```

La segunda forma hace que una serie de notas parciales sume **exacto** lo salido (la última se
lleva el resto), sin leer las devoluciones anteriores. Un ingrediente no bloqueante que se vendió
sin stock no tiene salida: no vuelve, igual que en `cancelar`.

### 3.3 Las dos respuestas, en el kardex

En la transacción de la nota, ordenado por ítem movido (mismo comparador que `crear`/`cancelar`):

| Respuesta | Movimientos (por ítem movido `I`, modo `cantidad`) | Costo | CPP |
|---|---|---|---|
| **Se recupera** | entrada `devolucion` | el de la salida en la venta | se recalcula (como hoy) |
| **Se pierde** | entrada `devolucion` + salida `merma` con el motivo *Devolución* | las dos, al costo de la salida | no se toca (`sinPromediar`) |

"Se pierde" deja stock neto cero y una merma que el reporte de mermas, el Inicio ("Pérdidas") y
el costo de la baja ven como cualquier otra. La entrada congela **el mismo costo de salida** que la
merma y **no promedia** (`registrarMovimiento({ sinPromediar: true })`, que además deja
`costo_informado` en falso para "rehacer la cuenta"): con el CPP de hoy en la entrada, varianza vería
el teórico en 0 unidades pero con plata; promediada, arrastraría el CPP del stock que queda. Los dos
movimientos llevan `venta_id` = la nota.

**Serie y lote** (la frontera de hoy, sin cambios): *Se recupera* se rechaza en la nota manual
(*"registrá el ingreso desde Inventario"*) y no mueve nada por el webhook; *Se pierde* no mueve
nada (la unidad ya está `vendido` y la merma rechaza serie). Un combo con un componente en lote
no se puede recuperar; perderlo mueve solo lo que es `cantidad`. Hueco declarado, enlazado a
`pendientes.md` § 6 *"Serie y lote están a medias"*.

### 3.4 El contrato (lo reusa "Generar nota")

Cada línea de `devoluciones` —en `POST /ventas/:id/notas-credito` (`DevolucionNotaCreditoDto`) y en
los dos `POST …/reembolsos` de la pasarela (`DevolucionLineaDto`)— cambia `reponerStock?: boolean`
por:

```ts
stock?: 'recupera' | 'pierde'
```

- **Obligatorio** en la línea cuyo ítem tiene stock de por medio (salidas en el kardex de esa
  venta); 400 *"Falta decir si «X» se recupera o se pierde"*.
- **Prohibido** en la que no (un servicio): 400 *"«X» no tiene stock: no se recupera ni se pierde"*.
- `reponerStock` sale de los DTO: el pipe lo rechaza (`forbidNonWhitelisted`).
- El detalle de la venta dice, por línea, qué preguntar: `devolucionStock: 'sin_stock' |
  'recuperable' | 'solo_perdida'`.

**Por la pasarela**, la respuesta se valida en tx0 (`preparar`, ADR-029) **antes de llamar a
Transbank**, junto al tope por pago y con la misma validación de la nota manual: un REFUND con una
línea sin respuesta rebota sin que salga plata. El hook post-commit **nunca** rechaza (un hecho
consumado): una línea sin respuesta —solo la `metadata` de un REFUND anterior a esto— no mueve
stock, como hasta hoy. La respuesta viaja en la `metadata` del REFUND (ya guarda `devoluciones`),
así que el aclarado por saldo y el *Salió* manual reponen o mermen igual que el aprobado directo.

### 3.5 La causa fija "Devolución"

- Fila de `motivo_baja` tipo `merma`, **`es_fijo = true`** y marcada **`es_devolucion = true`**
  (columna nueva, `boolean NOT NULL DEFAULT false`, único vivo por tenant). Se reconoce por la
  marca, no por el nombre.
- Se siembra al crear el tenant (`MOTIVOS_BAJA_FIJOS`) y en el seeder (París `…440470`, Falabella
  `…440471`). Un tenant creado antes (Railway) la recibe **al emitir la primera nota que la
  necesite** (find-or-create, como el ítem *Ajuste*): el webhook no puede perder un evento porque
  falte un dato de configuración.
- **No se elige a mano**: `POST /mermas` la rechaza con 400 y la pantalla de Mermas no la ofrece.
  Sí se lista en `GET /mermas` (es pérdida), con su nombre, que es el "aparte" del owner.

## 4. Decisiones de esta sesión

Todas consultadas a la *Sesión de esfuerzo máximo*, que las decidió el 2026-10-04 sin llevarlas al
owner, derivadas de sus decisiones (2026-08-23, 2026-09-29 y 2026-08-15).

| # | Decisión | Cómo |
|---|---|---|
| 4.1 | "Devolución" no se renombra ni se borra (`es_fijo`) y no se elige a mano en Mermas | sí; además se rechaza en anular y cancelar en la mesa (`assertMotivoActivo`) y sale de los dos selectores |
| 4.2 | "Se pierde" = entrada + merma al costo de salida | **ajustada**: la entrada congela el mismo costo de salida y no promedia (`sinPromediar`), con test de punta a punta (stock, CPP, teórico de varianza en 0 en cantidad y plata) |
| 4.3 | `venta_detalle_id` en el kardex y reparto `r4(T·(R+q)/V) − r4(T·R/V)` | sí; dos líneas personalizadas distinto se promedian (anotado); la vuelta apunta a la primera línea vendida del ítem |
| 4.4 | `stock: 'recupera' \| 'pierde'`, obligatorio con stock y prohibido sin; validado en tx0 de la pasarela | sí; la respuesta queda en la `metadata` del REFUND y nadie la vuelve a preguntar |
| 4.5 | Serie/lote: sin cambios de frontera; "se pierde" no mueve | sí; los dos huecos quedan en `pendientes.md` § 6 |
| 4.6 | Sin opción preelegida en pantalla | sí |
| 4.7 | Tenant viejo: find-or-create | **ajustada**: nunca se adopta un motivo propio; con el nombre tomado nace "Devolución (nota de crédito)" |
| 4.8 | Una receta fuera del documento (escalada a $0, porción agotada) o una serie que se pierde no dejaban huella en el contador | la nota guarda lo que devolvió (`ventas.devoluciones`) y el contador cuenta de ahí; levantado por la revisión independiente |

## 5. Fuera de alcance

- La merma de serie/lote y la reposición automática de serie/lote (§ 6 de pendientes).
- El botón "Generar nota" de un REFUND sin nota (frente siguiente; reusa este contrato).
- `cancelar` no cambia: anular no es devolver, y su checkbox de reposición sigue siendo uno solo.
- Lo que el frente paralelo del kardex cambie en la lectura de `costoPerdido` (cortesía / comida
  del personal). Las mermas *Devolución* son pérdida y tipo `merma`.

## 6. Verificación

- e2e de API: receta devuelta que se recupera (ingredientes vuelven, CPP), que se pierde (merma
  *Devolución* en `GET /mermas`, stock neto cero, CPP intacto), combo, producto suelto en las dos,
  serie de notas parciales que cierra exacto, 400 sin respuesta / con respuesta en un servicio,
  pasarela: REFUND sin respuesta rebota antes del proveedor y uno con respuesta repone/mermea;
  ingrediente compartido con una línea de producto (el contador no se mezcla); `POST /mermas`
  rechaza *Devolución*; tenant sin la causa la recibe al emitir.
- Arranque de `synchronize` sobre una base sembrada por `main`.
- Playwright de la NC y del reembolso con la pregunta.
- Mutantes que reviertan al código anterior.
