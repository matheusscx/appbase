# Consumo congelado en la línea de cuenta

**Fecha:** 2026-10-11 · **Entrada:** `docs/agent/pendientes.md` § 3, *"Anular un plato devuelve lo
que se consumió al venderlo"* · **Decidido:** owner, 2026-09-29: B, congelar al vender;
2026-10-11: el cobro descuenta lo congelado aunque el ítem esté borrado.

## 1. Problema

La anulación de un plato (`ItemsService.consumirLineaAnulada`) y el cobro de la cuenta
(`ventas.service` → `venderIngredientesReceta` / `venderComponentesCombo`) expanden la línea con el
snapshot de personalización congelado, pero leen **en vivo** lo demás:

| Qué se lee en vivo | Dónde | Qué pasa si cambió |
|---|---|---|
| Ingredientes de la receta | `obtenerIngredientesReceta` | Se consume la receta nueva |
| Componentes del combo | `SELECT … combo_componentes` en `venderComponentesCombo` | Se consume el combo nuevo |
| Tipo y unidad de cada opción de grupo | `SELECT` por opción en `venderOpcionesGrupos` | Borrada → se saltea sin aviso |
| Nombre y unidad de cada extra | `catalogoDeExtras` | Borrado → se saltea con un aviso que no se guarda |

En la anulación, el reporte marca `valorizado` con un costo parcial más bajo y sin marca, y
mermas hereda ese sesgo.

## 2. Evidencia: el cobro también lee lo congelado

El cobro tiene el mismo hueco, con el mismo código. Si la anulación leyera lo congelado y el cobro
no, una línea de 2 risottos con 1 anulado descontaría dos recetas distintas. El plato se cocinó con
la receta del momento del pedido: esa es la que tiene que mostrar el kardex. Varianza ya depende de
eso, porque su teórico **es** el kardex de `venta`. **El cobro lee lo mismo que la anulación.**

La venta directa del POS y la de la tienda **no cambian**: expanden en el mismo momento en que se
venden, así que lo vivo ya es lo de ese momento.

## 3. Diseño

### 3.1 Qué se congela: la rebanada de catálogo que la expansión lee

Columna nueva `cuenta_lineas.consumo_congelado jsonb NULL` con `ConsumoCongelado`
(`common/dto/consumo-congelado.dto.ts`):

```ts
interface ConsumoCongelado {
  /** Ingredientes por receta: el plato, sus componentes receta y sus opciones receta. */
  recetas: Record<string, IngredienteCongelado[]>;
  /** Componentes del combo. `[]` si la línea es una receta. */
  componentes: ComponenteCongelado[];
  /** Tipo, nombre y unidad de stock de cada extra y cada opción de grupo. */
  items: Record<string, ItemCongelado>;
}
```

Se congela **la forma del catálogo**, no el consumo ya multiplicado. Así la expansión, con su
semántica intacta, corre sobre otra fuente: bloqueante y no bloqueante, el pre-chequeo del
componente no bloqueante, `componentesOmitidos`, la conversión de unidades y el orden de bloqueo
por id. Un consumo plano perdería esa estructura, y el cobro la necesita.

El producto simple no se congela (`NULL`): su consumo es él mismo.

### 3.2 Dónde se congela: al pedir, con la misma carga en lote

`ItemsService.congelarConsumos(manager, tenantId, lineas)` devuelve un `ConsumoCongelado | null`
por línea, con **tres consultas que no crecen con las líneas**: componentes de los combos, ítems de
extras y opciones (`LEFT JOIN item_producto`), e ingredientes de todas las recetas de los tres
orígenes. Las extrae de `consumoDeLineas`, que hoy las hace en sus pasos 2 a 5. No es una carga
nueva: es la misma, con nombre.

`SalonesService.agregarLinea` lo llama fuera de la transacción, igual que `congelarReglasDeItem`.

### 3.3 Quién lo lee

- **`venderIngredientesReceta` / `venderComponentesCombo` / `venderOpcionesGrupos`** reciben
  `consumo?: ConsumoCongelado`. Si viene, leen de ahí. Si no, leen en vivo como hoy (POS y tienda).
  El `SELECT` por opción de `venderOpcionesGrupos` pasa a ser uno en lote: era un N+1.
- **`calcularDisponibleReceta`** recibe los ingredientes ya resueltos y lee solo el stock.
- **`consumirLineaAnulada`** recibe `consumo` de la línea.
- **Cobro:** `LineaCongelada` suma `consumoCongelado`, y `ventas.service` se lo pasa a la expansión.
- **`consumoDeLineas`** (la reserva al pedir y `comprometidoPorItem`): `LineaConsumo` suma
  `consumo?`. Las líneas que lo traen no se recargan, y lo que reserva una mesa abierta es lo
  mismo que va a descontar al cobrar.

Una receta que falta en `recetas` es un congelado roto, no "sin ingredientes": se lanza un error.

### 3.4 Línea sin congelado

Una receta o un combo con `consumo_congelado NULL` usa lo vivo, que es la conducta de hoy. El
proyecto no tiene datos productivos (no hay backfill), pero el código no puede romper con una
línea así.

### 3.5 Ítem borrado después de pedir (owner, 2026-10-11, opción 1)

Lo congelado puede nombrar un ingrediente u opción que después se borró: primero se saca de la
receta o del grupo y después se borra el ítem. Esos dos pasos ya están permitidos.

- **Anulación:** ya funciona. `merma` sobre un eliminado está en `MOTIVOS_SOBRE_ITEM_ELIMINADO`.
- **Cobro:** `RegistrarMovimientoParams` suma `consumoDePlatoPedido?: true`. El guard del
  eliminado acepta `venta` **solo** con esa marca. La marca exige `motivo: 'venta'` y
  `ventaDetalleId`, y la pasa únicamente la expansión que lee de un `ConsumoCongelado`. Un producto
  borrado vendido directo en el POS sigue rechazado, y un test lo cubre. El porqué va escrito en el
  guard.

### 3.6 Identidad de la línea

Dos pedidos del mismo plato con distinto consumo congelado son **dos líneas**, igual que con el
precio o las reglas. Es el cuarto término del merge en `agregarLinea` y en `fusionarCuentas`.
`hashConsumoCongelado` serializa con `estable` sin los nombres: renombrar un ingrediente no mueve
nada.

`actualizarLinea` (subir la cantidad) reusa el congelado de la línea. Las unidades nuevas de una
línea existente consumen lo que la línea congeló. Es un límite conocido y se documenta.

## 4. Fuera de alcance

Motor de precios, impuestos y lo fiscal. `modo_inventario`. El reporte de anulaciones no cambia de
código: con la expansión completa, su costo sale completo.

## 5. Tests

e2e propio (`salones-consumo-congelado.e2e-spec.ts`), con fixture propio y garzón propio. Primero
rojo contra el código de hoy y después verde:

1. **Extra borrado:** se mide si el borrado está bloqueado (rama `'cuenta'` de `obtenerUsoItem`).
   Si lo está, la escena no es alcanzable y se corrige la entrada.
2. **Opción de grupo** sacada del grupo y borrada → la anulación la descuenta, y el reporte da el
   costo completo.
3. **Receta editada** → la anulación consume la receta pedida.
4. **Combo editado** → la anulación consume el componente pedido.
5. **Cobro** con la receta editada y un ingrediente borrado → la venta descuenta lo pedido.
6. **POS** vendiendo un producto borrado → sigue en 400.
7. **Identidad:** pedir antes y después de editar la receta da dos líneas.

Mutante: que la expansión ignore `consumo` → rojo.
