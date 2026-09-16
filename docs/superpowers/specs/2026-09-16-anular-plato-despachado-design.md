# Anular un plato ya enviado a cocina

**Fecha:** 2026-09-16 · **Tipo:** spec de diseño
**Frente:** *"Anular o reducir una línea ya enviada a cocina"*, en
[`docs/agent/pendientes.md`](../../agent/pendientes.md) § 3. Es la **parte 2** de tres.
**Decisiones del owner:** las seis del 2026-09-03, las cuatro del 2026-09-15 (las dos tandas están en
esa entrada) y las del 2026-09-16, que esta spec lista en § 2 (confirmadas por el owner ese día).

---

## 1. Dónde encaja

| Parte | Qué | Estado |
|---|---|---|
| 0 + 1 | El catálogo *Motivos de baja* con tipo (`merma`, `cortesia`, `no_elaborado`) | construida y desplegada (`b9d8af83`, `b5de5227`, `3fbb359f`, `40d18937`) |
| **2** | **Anular en el salón: el registro, el permiso, el stock, la pantalla y la precuenta** | **esta spec** |
| 3 | El reporte de anulaciones, con merma y cortesía separadas | se diseña después |

**El problema que cierra.** `quitarLinea` (`salones.service.ts`) rechaza una línea con
`cantidad_enviada > 0` y su propio mensaje manda a *"registralo como merma o cortesía"*, un camino que
no existe. El garzón que se equivocó de plato después de mandar la comanda no tiene salida y la mesa
queda trabada.

## 2. Las decisiones que la sostienen

Las de las tandas anteriores están en `pendientes.md`. Las del 2026-09-16:

| Decisión | Por qué importa |
|---|---|
| **El motor de cálculo no se toca** | Es la regla del repo (`CLAUDE.md`): va solo y con el sistema quieto. Todo el diseño se acomoda a esto |
| **La línea anulada se saca de la cuenta** (soft delete) | Es lo que permite no tocar el motor: lo que no está en `cuenta_lineas` no entra al cálculo ni al cobro. **Reemplaza** la decisión del 2026-09-03 de dejar la línea marcada en la cuenta |
| **La precuenta sí lo imprime; la boleta y la factura, no** | La precuenta es papel interno; el documento tributario es otra cosa y es materia fiscal (ADR-010) |
| **En la mesa, un aviso abajo de la cuenta**: *"1 lomo anulado — cortesía, autorizó Ana"* | Sin esto, el garzón del turno siguiente no tiene cómo saber que hubo un plato anulado |
| **El plato *no se llegó a hacer* no se imprime en la precuenta** | Nunca salió de la cocina. El rastro queda en el sistema |
| **Una anulación no se deshace**; se vuelve a pedir el plato | Como la merma. Un error se corrige con un ajuste, y quedan los dos rastros |
| **Cancelar una cuenta con algo despachado exige permiso y motivo** | Hoy pide solo `Salones:Operar`, que tiene cualquier garzón: sería la puerta de atrás del control que esta parte construye |
| **Una cuenta con todo anulado se cancela, no se cobra en $0** | Evita ventas en cero; el rastro vive en las anulaciones y en el kardex |
| **Un producto borrado del catálogo igual descuenta al anularse** | El plato salió y el stock tiene que decirlo. Obligar a restaurarlo primero deja la mesa trabada hasta que aparezca el admin |

## 3. Modelo de datos

### 3.1 `cuenta_linea_anulaciones` (tabla nueva)

Una fila por anulación; varias por línea. **Sobrevive al borrado de la línea**: es el único rastro que
queda en la cuenta.

| Columna | Tipo | Nota |
|---|---|---|
| `cuenta_linea_anulacion_id` | UUID PK, `type: 'uuid'` explícito (ADR-004) | |
| `tenant_id` | UUID | sale del token, nunca del body |
| `cuenta_id` | UUID | **también la cuenta**, no solo la línea: la línea se borra y la pantalla necesita listar por cuenta sin depender de una fila borrada |
| `cuenta_linea_id` | UUID | la línea anulada, para trazar |
| `item_id` | UUID | qué plato era |
| `item_nombre` | text | congelado: el catálogo puede renombrar o borrar el ítem después |
| `cantidad` | numeric(18,4) | cuánto se anuló en ESTA anulación, en unidad canónica |
| `motivo_baja_id` | UUID | del catálogo de la parte 1; su `tipo` decide el stock |
| `autorizado_por` | UUID | el usuario con el permiso, del token |
| `creado_el` / `actualizado_el` / `eliminado_el` | timestamptz | soft delete por convención; nada la borra hoy |

La entidad va registrada en el array `entities` de `app.module.ts` (no hay `autoLoadEntities`).

### 3.2 La línea de la cuenta

**No lleva columna nueva.** Anular n unidades baja `cantidad` **y** `cantidad_enviada` en n; si la línea
queda en cero, se borra. Así, todo lo que hoy lee `cuenta_lineas` —cobro, cálculo, comanda, stock
apartado— sigue leyendo un número que ya es el vivo, sin restar nada.

**Solo se anula lo despachado: el tope es `cantidad_enviada`.** Lo que no salió a cocina ya tiene su
camino sin motivo —bajar la cantidad o quitar la línea—, y anularlo con un motivo que descuenta movería
stock de platos que no se cocinaron. Como las dos columnas bajan lo mismo, nunca queda
`cantidad_enviada > cantidad` ni negativa.

⚠️ **No se reusa `actualizarLinea` tal cual**: rechaza bajar por debajo de `cantidad_enviada` y da 404
si el ítem está pausado o eliminado (`getItemVendibleOrThrow`). Lo que sí se comparte es el recálculo de
la presentación (`resolverCantidadLinea`, `sincronizarPresentacion`), para que `cantidad_presentacion`
no quede vieja.

**Borde que ya existía:** volver a pedir el mismo plato después de una anulación parcial lo suma a la
misma línea (la clave de merge no mira la hora), y las unidades nuevas heredan el `creado_el` viejo para
las promos por horario. Pasa hoy igual; no lo cambia esta parte.

### 3.3 Lo que NO se guarda

- **El precio**: está congelado en `cuenta_lineas.precio_unitario`; la precuenta lo imprime en $0 igual.
- **El costo**: lo fija el kardex en el movimiento, con el costo del momento.

## 4. El camino de la anulación

### 4.1 Endpoint y permiso

`POST /api/cuentas/:id/lineas/:lineaId/anular`, con `cantidad` y `motivoBajaId`. Controller `cuentas`.
La `cantidad` viaja en la unidad canónica de la línea, la misma que `cantidad_enviada`; la pantalla muestra
la presentación (500 g, no 0,5 kg), y el plan decide dónde se convierte reusando la conversión que ya
existe (`resolverCantidadLinea`).

Guard `@RequiresPermiso('Salones', 'Anular')`. La acción `Anular` existe (hoy solo emparejada con
Ventas); **falta el par con el módulo Salones**, que se siembra en `seedModuloAppPermisos` con el id
libre `550e8400-e29b-41d4-a716-446655440405` (verificado libre el 2026-09-16).

⚠️ **El rol `Salones · Encargado` del seed hoy tiene Leer, Crear y Actualizar, pero no `Operar`**, y la
pantalla del salón entra por `GET /salones/operacion`, que exige `Operar`. Para que el encargado llegue
a la mesa, ese rol recibe **`Operar` y `Anular`**. El admin puede dar `Anular` a otro rol.

No pide PIN: no es un gesto de garzón sino de alguien con permiso.

### 4.2 Qué valida, en este orden

1. La cuenta está abierta — `getCuentaAbiertaConLock` (lock pesimista sobre la cuenta; el mismo modo
   que toma `cerrarCuenta` con su propio `findOne`). Serializa dos anulaciones de la misma línea.
2. La línea existe, es de esa cuenta y está viva.
3. `cantidad > 0` y `cantidad ≤ cantidad_enviada` de la línea.
4. El motivo está activo y es del tenant — `MotivosBajaService.assertMotivoActivo`, que devuelve el `tipo`.

Que el ítem esté pausado o borrado del catálogo **no** frena la anulación. Para uno borrado es además la
única salida: la cuenta no se puede cobrar (`cerrarCuenta` rechaza ítems borrados) ni el plato quitar
(está despachado).

### 4.3 Qué escribe, todo en una transacción

- La fila de `cuenta_linea_anulaciones`.
- La línea: baja `cantidad` y `cantidad_enviada`, o se borra si no queda nada vivo.
- **Si el tipo descuenta** (`merma` o `cortesia`): los movimientos de inventario del consumo de esa
  línea, **expandiendo el snapshot de personalización congelado en ella** (extras y omitidos incluidos),
  igual que hace el cobro.

⚠️ **La expansión del consumo hoy está atada a la venta, y son cuatro caminos, no uno:**
`venderIngredientesReceta`, `venderComponentesCombo` y `venderOpcionesGrupos` en `ItemsService` exigen
`ventaId` y escriben `motivo: 'venta'`; el producto simple ni siquiera pasa por ahí, se resuelve en
`ventas.service.ts`. El plan decide cómo se comparte —parámetro de motivo con `ventaId` opcional, o un
método hermano— con el código a la vista; lo que la spec fija es que **la expansión no se duplica**.

⚠️ **No reusar el motivo `anulacion` del kardex**: significa *anular una venta*, está en
`MOTIVOS_QUE_RECALCULAN_CPP` y en `MOTIVOS_SOBRE_ITEM_ELIMINADO` porque ahí el stock **vuelve**. Acá
sale. El movimiento va con `motivo: 'merma'` y el `motivo_baja_id`; lo que separa cortesía de merma es
el **tipo del motivo**.

**Trazabilidad para la parte 3:** `movimientos_inventario` suma la columna `cuenta_linea_anulacion_id`
(UUID, nullable), para que el reporte pueda unir kardex y anulación. Arrastra: el INSERT explícito de
`registrarMovimiento`, el par de guards *"solo aplica a…"* que ya tienen los otros campos por motivo,
`startup-pos.sql`, y un test que afirme que el movimiento lleva ese id.

**Si el tipo es `no_elaborado`:** no hay movimiento. Ese stock nunca salió.

**Un producto borrado del catálogo igual descuenta** (owner, 2026-09-16). Vale para el producto de la
línea: los ingredientes, componentes y opciones borrados se siguen salteando sin movimiento, como hoy. Hoy `registrarMovimiento`
rechaza movimientos sobre un ítem eliminado salvo `anulacion`, `devolucion` y `traslado`
(`MOTIVOS_SOBRE_ITEM_ELIMINADO`), y el de la anulación va como `merma`, así que hay que habilitarlo para
este camino. El plan elige cómo —sumando el motivo a esa lista o con un parámetro explícito— **después de
listar a todos los que llaman con `motivo: 'merma'`**; hoy es `MermasService.registrar`, que ya rechaza
ítems borrados por su cuenta. Para una receta borrada no hace falta: la expansión no mira si la receta
está borrada y saltea los ingredientes borrados, igual que hace hoy con los ingredientes al cobrar.

## 5. Quién ve lo anulado, y quién no

| Consumidor | Qué pasa |
|---|---|
| `cerrarCuenta`, `lineasDeCuenta` del cálculo, `comprometidoPorItem`, comanda | **Nada que tocar**: leen `cuenta_lineas`, que ya trae el número vivo |
| Detalle de la cuenta (`armarDetalles`) | Suma un bloque `anulaciones` por cuenta, leído de la tabla nueva en **una sola query para las N cuentas** (`armarDetalles` es batch) y filtrando `eliminado_el`. Las líneas siguen saliendo como hoy |
| Pantalla del salón | Debajo de los platos, el aviso: cantidad, nombre congelado, motivo y quién autorizó. No es tocable |
| Precuenta | Imprime lo anulado **de tipo `merma` y `cortesia`** en $0, con su palabra. El `no_elaborado` no |
| Boleta / factura | **No imprime nada de esto** |

⚠️ **Precuenta y boleta arman sus ítems con la MISMA función** (`itemsParaTicket`, dos llamadas en
`salones/index.vue`). La diferencia va como parámetro explícito de esa función, no como dos caminos
distintos: son dos llamadas al mismo armado.

**El cruce por índice del ticket no se toca**, y por eso esta spec no toca el motor: al no haber líneas
omitidas ni en cero, cálculo y cuenta siguen alineados. Lo anulado se agrega al ticket **después**, desde
el bloque de anulaciones, no desde el resultado del cálculo.

## 6. Cancelar una cuenta con platos despachados

**Dos rutas**, para que el permiso siga en el guard (invariante 6 de `CLAUDE.md`): `PermisosGuard` solo
resuelve lo que declara la ruta, no un permiso que dependa del dato.

- **`POST /api/cuentas/:id/cancelar`** (`Salones:Operar`, como hoy): cancela solo si **no** hay nada
  despachado. Si hay, rechaza con 400 y un mensaje que manda a cancelar con motivo.
- **`POST /api/cuentas/:id/cancelar-con-motivo`** (`Salones:Anular`, con `motivoBajaId`): en una
  transacción, por cada línea viva con `cantidad_enviada > 0` genera una anulación **por su
  `cantidad_enviada`**, con ese motivo, y aplica el stock según el tipo. Las unidades no despachadas y las
  líneas sin nada despachado no generan fila ni movimiento. Después borra todas las líneas vivas y cancela
  la cuenta, cerrando el tramo de asignación (`cerrarTramoVigente`) como hace `cancelarCuenta`.

Ejemplo: una línea con `cantidad` 3 y `cantidad_enviada` 1 genera una anulación de 1 y mueve stock de 1;
las 2 pendientes se descartan.

**"Algo despachado"** es alguna línea viva con `cantidad_enviada > 0`. Una cuenta con todo anulado no tiene
líneas vivas: se cancela por la ruta simple.

## 7. Cuenta sin nada que cobrar

Si la última anulación deja la cuenta sin líneas vivas, **la misma operación la cancela** —cerrando el
tramo de asignación con `cerrarTramoVigente`, como `cancelarCuenta`— y devuelve la cuenta cancelada. No se pasa por `cerrarCuenta`, que rechaza una cuenta sin líneas con *"La cuenta no
tiene productos"*. La mesa queda libre y el rastro vive en las anulaciones.

## 8. Fusión de cuentas

`fusionarCuentas` mueve líneas de una cuenta a otra sumando `cantidad` y `cantidad_enviada` y borrando la
de origen. Con este diseño **no hay tercer término que mover en la línea**, porque lo anulado ya no vive
ahí. Lo que sí hay que mover son **las filas de `cuenta_linea_anulaciones` de la cuenta de origen**, que
pasan a la de destino: si no, el aviso de la pantalla y la precuenta pierden lo anulado antes de fusionar.
El comentario de `fusionarCuentas` ya avisa de esta clase de olvido para la clave de merge.

## 9. Fuera de alcance

- **El reporte** de anulaciones y su separación merma/cortesía: parte 3. Esta parte deja el dato
  trazable (§ 4.3).
- **La boleta** de una cuenta con anulaciones: no las imprime, que es el estado de hoy para lo que no se
  cobra. Cualquier cambio ahí es fiscal (ADR-010).
- **Deshacer** una anulación: decidido que no existe.
- **Líneas sin impresora:** `agruparEstacionesComanda` saltea las categorías sin impresora, así que su
  `cantidad_enviada` nunca avanza. Esos platos no se pueden anular con motivo —el tope es lo despachado— y
  se siguen quitando sin rastro. Hueco que ya existía; queda anotado.
- **El endpoint legado `POST /cuentas/:id/comanda`** (`confirmarComanda`) escribe un `cantidad_enviada`
  absoluto sin tope ni lock, y puede dejar `cantidad_enviada > cantidad`. El frontend no lo llama; queda
  anotado.
- **Anular después de cobrar:** es una nota de crédito, que ya tiene su camino.
- **El informe de Mermas** va a mostrar cortesías y platos anulados desde el día 1, porque lista todo
  movimiento con `motivo = 'merma'` y no filtra por tipo. Separarlo es la parte 3; queda anotado para que
  no se descubra como bug.

## 10. Cómo se prueba

- **Unitarios** (`salones.service.spec.ts`): rechazos de cantidad (incluido pasar lo despachado), motivo y
  estado; que la anulación parcial baje `cantidad` **y** `cantidad_enviada`; que la total borre la línea; que la
  última anulación cancele la cuenta; que cancelar con despachado exija motivo; que la expansión del
  stock use el snapshot de la línea.
- **E2E de backend:** el permiso rige de verdad (molde: `permiso-operar-salon.e2e-spec.ts`); anulación
  parcial y total; movimiento de stock solo cuando el tipo descuenta; cuenta con todo anulado que queda
  cancelada y sin venta; **fusionar una cuenta con anulaciones y ver que el aviso sobrevive**; que el
  total cobrado baje exactamente lo anulado; **anular un producto borrado del catálogo descuenta su
  stock**; `cancelar` rechaza con algo despachado y `cancelar-con-motivo` anula solo lo despachado.
- **E2E de navegador:** el encargado ve el gesto y el garzón no; el aviso aparece bajo la cuenta; la
  precuenta imprime la cortesía en $0 y no el `no_elaborado`.
- **Mutantes:** revertir el guard del permiso, el tope de cantidad, el descuento por tipo y el ajuste de
  `cantidad_enviada`; cada uno tiene que matar un test.
- **No se cubre con test de carrera:** dos encargados anulando la misma línea. Lo serializa el bloqueo de
  la cuenta.

## 11. Documentación que cambia

- `docs/features/salones-mesas.md`: el camino de anulación, el aviso en la mesa, el permiso y qué pasa al
  cancelar y al fusionar.
- `docs/features/roles-permisos.md`: `Salones:Anular`, de quién nace y qué gobierna, y las dos rutas de
  cancelar.
- `docs/features/mermas-valorizadas.md`: que un movimiento de merma puede nacer de una anulación de plato,
  y que el informe todavía no las separa.
- `docs/features/impresion-termica.md`: qué imprime la precuenta y qué no la boleta.
- `docs/PRODUCTO.md` y `docs/ESTADO.md`.
