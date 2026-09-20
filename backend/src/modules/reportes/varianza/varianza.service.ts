import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ESCALA_COSTO } from '../../../common/constants/escalas';
import { Db } from '../../../common/db/db.service';
import type { PaginatedResponse } from '../../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../../common/utils/pagination.util';
import {
  bordeFechaSql,
  bordeHastaSql,
  diaNegocioTenant,
  empujarDiaNegocio,
  requiereDiaNegocio,
  type DiaNegocio,
} from '../../../common/utils/rango-fecha.util';
import { QueryVarianzaDto } from './dto/query-varianza.dto';

/**
 * Σ por moneda, **sin convertir nunca entre monedas**.
 *
 * 📌 Se duplica respecto de `anulaciones-reporte.service.ts` a propósito: es el
 * **segundo** uso, y la convención del repo es duplicar dos veces y extraer a la
 * tercera (`CLAUDE.md`, "Archivos"). El tercer reporte que la necesite la mueve
 * a `common/`.
 */
export interface CostoPorMoneda {
  monedaId: string;
  /** Decimal serializado, a `ESCALA_COSTO`. Nunca `number`. */
  monto: string;
}

/**
 * Los dos recuentos aplicados que cierran la ventana de un (item, ubicación).
 *
 * ⛔ **El filtro se ancla en `secuencia`, no en las fechas.** El kardex
 * documenta que `creado_el` **no sirve para ordenar**: es la hora en que
 * *empezó* la transacción, y dos que compiten por el lock del mismo producto
 * pueden aplicarse en orden inverso (docblock de `secuencia` en
 * `movimiento-inventario.entity.ts`). La `secuencia` exacta la da
 * `recuento_inventario_linea.movimiento_id`.
 *
 * ⚠️ `secuenciaDesde`/`secuenciaHasta` son `null` cuando ese recuento **dio
 * justo**: un delta cero no escribe movimiento, así que no hay `movimiento_id`
 * del cual sacarla (`recuentos.service.ts`). En ese caso el borde cae de nuevo
 * en `aplicado_el` y vuelve el riesgo de orden — lo detecta la columna «Otros».
 */
export interface VentanaVarianza {
  itemId: string;
  ubicacionId: string;
  recuentoInicialId: string;
  recuentoFinalId: string;
  /** `A.aplicado_el`. Para MOSTRAR, no para filtrar. */
  desdeEl: Date;
  /** `B.aplicado_el`. Para MOSTRAR, no para filtrar. */
  hastaEl: Date;
  secuenciaDesde: string | null;
  secuenciaHasta: string | null;
}

/**
 * Una fila del reporte: un (producto, ubicación) y su ventana.
 *
 * Los números son string a escala 4 —`Decimal.js` de punta a punta, nunca
 * `number`— y vienen en `null` cuando `medible` es `false`.
 */
export interface VarianzaFila {
  itemId: string;
  itemNombre: string;
  unidadMedida: string;
  ubicacionId: string;
  ubicacionNombre: string;
  /** `false` cuando el rango no tiene dos recuentos aplicados: "falta contarlo". */
  medible: boolean;
  desdeEl: Date | null;
  hastaEl: Date | null;
  recuentoInicialId: string | null;
  recuentoFinalId: string | null;
  /** Σ salidas `venta`, MENOS entradas `anulacion` y `devolucion`: es neto. */
  teorico: string | null;
  merma: string | null;
  cortesia: string | null;
  /** Σ `recuento` con signo: salidas menos entradas. Un sobrante resta. */
  sinExplicacion: string | null;
  /**
   * El **residuo** entre las dos formas de calcular el consumo real.
   * Estructuralmente cero; es un detector, no un bucket.
   *
   * ⚠️ **Viaja siempre, incluso en `'0.0000'`.** Omitirlo cuando es cero dejaría
   * al consumidor sin poder distinguir "cerró perfecto" de "esta versión todavía
   * no lo calcula", que es justo la ambigüedad que la columna existe para
   * cerrar.
   */
  otros: string | null;
  costoSinExplicacion: CostoPorMoneda[];
  faltaCosto: boolean;
}

/** Fila cruda de la consulta de ventanas: un (item, ubicación) ya agregado. */
interface GrupoRow {
  item_id: string;
  item_nombre: string;
  unidad_medida: string;
  ubicacion_id: string;
  ubicacion_nombre: string;
  /** Cuántos recuentos APLICADOS cayeron en el rango para este grupo. */
  recuentos: number;
  recuento_inicial_id: string;
  recuento_final_id: string | null;
  desde_el: Date;
  hasta_el: Date | null;
  secuencia_desde: string | null;
  secuencia_hasta: string | null;
}

/**
 * De dónde salen los grupos: recuentos aplicados → sus líneas → el ítem y la
 * ubicación que nombran.
 *
 * ⚠️ **El `LEFT JOIN` a `movimientos_inventario` es LEFT a propósito.** Un
 * recuento cuya línea dio **delta cero no escribe movimiento**
 * (`recuentos.service.ts`), así que `rl.movimiento_id` es `NULL` y un `JOIN`
 * normal borraría esa fila entera — perdiendo justamente el conteo que salió
 * perfecto, que es el que confirma que el número es confiable. Con `LEFT`, el
 * grupo sobrevive y su `secuencia` viaja en `NULL`; el borde entonces cae en
 * `aplicado_el` (spec § 5.2).
 *
 * Solo se listan (item, ubicación) que tengan **al menos un** recuento aplicado
 * en el rango: un producto que nadie contó no tiene nada que decir, y llenar la
 * tabla con el catálogo entero en "falta contarlo" enterraría las filas que sí
 * dicen algo.
 *
 * 📌 **Dónde va cada filtro de borrado, y el que no existe.** `r`, `rl`, `i` y
 * `ub` filtran `eliminado_el IS NULL` en el `WHERE` (`buildFiltros`). El de
 * `mv` va en el **`ON` del `LEFT JOIN`, no en el `WHERE`**: ahí lo convertiría
 * en un `INNER` de hecho y volvería a perder el recuento de delta cero, que es
 * justo lo que el `LEFT` viene a salvar. Y **`item_producto` no tiene
 * `eliminado_el` ni `tenant_id`** —es la tabla de extensión de `items`, con PK
 * compartida—, así que no le falta un filtro: su alcance sale del `items` al
 * que cuelga.
 *
 * ⚠️ **Cada tabla con `tenant_id` lo filtra en su propio `ON`, aunque por la
 * cadena de FK ya esté acotada.** No es redundancia inútil: las FK del esquema
 * son simples (`item_id REFERENCES items(item_id)`), **no compuestas con
 * `tenant_id`**, así que lo único que hoy impide que una línea de recuento
 * apunte a un ítem ajeno es el camino de escritura —que lo valida, pero es
 * código, no esquema—. Filtrar acá cierra la duda sin costo y, sobre todo, es
 * el patrón que ya usa el resto del repo (`propina-reportes.service.ts` lo
 * repite en cada tabla, incluso en los `LEFT JOIN`): dos formas de hacer lo
 * mismo cuestan más que la línea que ahorran.
 *
 * Va contra `r.tenant_id` y no contra `$1` para que el `ON` se lea como lo que
 * es —"del mismo tenant que el recuento"— y no dependa de qué posición ocupa el
 * bind, que `buildFiltros` arma dinámicamente.
 */
const FROM_GRUPOS = `
  FROM recuento_inventario r
  JOIN recuento_inventario_linea rl
    ON rl.recuento_id = r.recuento_id
  JOIN items i
    ON i.item_id = rl.item_id
   AND i.tenant_id = r.tenant_id
  JOIN item_producto ip
    ON ip.item_id = i.item_id
  JOIN ubicaciones ub
    ON ub.ubicacion_id = r.ubicacion_id
   AND ub.tenant_id = r.tenant_id
  LEFT JOIN movimientos_inventario mv
    ON mv.movimiento_id = rl.movimiento_id
   AND mv.tenant_id = r.tenant_id
   AND mv.eliminado_el IS NULL`;

const GROUP_BY_GRUPOS = ` GROUP BY rl.item_id, i.nombre, ip.unidad_medida,
                                   r.ubicacion_id, ub.nombre`;

/**
 * Los bordes de la ventana, resueltos en SQL con `DISTINCT ON`-equivalente vía
 * agregación ordenada: el recuento aplicado más viejo del rango y el más nuevo,
 * con la `secuencia` del movimiento de cada uno.
 *
 * ⛔ **`secuencia` es el ancla del filtro; `aplicado_el` es solo para mostrar.**
 * El kardex documenta que `creado_el` **no sirve para ordenar** —es la hora en
 * que EMPEZÓ la transacción, y dos que compiten por el lock del mismo producto
 * pueden aplicarse en orden inverso (docblock de `secuencia` en
 * `movimiento-inventario.entity.ts`)—. Por eso las tareas siguientes filtran el
 * kardex por `secuencia > desde AND secuencia <= hasta`, no por fecha.
 *
 * `ORDER BY r.aplicado_el` dentro del agregado y no `ORDER BY mv.secuencia`:
 * cuál recuento es "el primero" lo decide **cuándo se aplicó**, y un recuento de
 * delta cero no tiene secuencia con la cual ordenarse.
 *
 * ⛔ **El desempate por `r.recuento_id` no es cosmético: sin él, un empate de
 * `aplicado_el` puede devolver un borde MEZCLADO.** Los tres valores de cada
 * borde —el id, la fecha y la secuencia— salen de **tres `array_agg`
 * independientes**, y con la misma clave de orden empatada nada garantiza que
 * los tres elijan la misma fila: podría volver el id de un recuento con la fecha
 * de otro. El `recuento_id` es único, así que el orden queda total y los tres
 * agregados coinciden siempre.
 *
 * Que el empate sea improbable —`aplicado_el` es `NOW()`, o sea el inicio de la
 * transacción del aplicar— no lo vuelve imposible, y el modo de falla es
 * silencioso: una ventana con bordes de dos recuentos distintos mide un período
 * que nunca existió.
 */
const SELECT_GRUPOS = `
  SELECT rl.item_id,
         i.nombre                AS item_nombre,
         ip.unidad_medida,
         r.ubicacion_id,
         ub.nombre               AS ubicacion_nombre,
         COUNT(DISTINCT r.recuento_id)::int AS recuentos,
         (array_agg(r.recuento_id  ORDER BY r.aplicado_el ASC, r.recuento_id ASC))[1]  AS recuento_inicial_id,
         (array_agg(r.aplicado_el  ORDER BY r.aplicado_el ASC, r.recuento_id ASC))[1]  AS desde_el,
         (array_agg(mv.secuencia   ORDER BY r.aplicado_el ASC, r.recuento_id ASC))[1]  AS secuencia_desde,
         (array_agg(r.recuento_id  ORDER BY r.aplicado_el DESC, r.recuento_id DESC))[1] AS recuento_final_id,
         (array_agg(r.aplicado_el  ORDER BY r.aplicado_el DESC, r.recuento_id DESC))[1] AS hasta_el,
         (array_agg(mv.secuencia   ORDER BY r.aplicado_el DESC, r.recuento_id DESC))[1] AS secuencia_hasta`;

/**
 * El **residuo** entre las dos formas de calcular el mismo consumo real:
 *
 * ```
 * porSaldos  = saldoDesde + abastecimiento − saldoHasta
 * porBuckets = teórico + merma + cortesía + sin explicación
 * otros      = porSaldos − porBuckets
 * ```
 *
 * ⛔ **Estructuralmente vale CERO, y por eso sirve.** Con los dos bordes
 * apoyados en conteos aplicados —donde libro y realidad coinciden por
 * construcción— las dos cuentas son la misma; la demostración está en la spec
 * § 5.4. Que dé distinto de cero significa que hubo movimientos que el reporte
 * **no supo clasificar**.
 *
 * ⛔ **QUÉ CAZA Y QUÉ NO, medido — y la primera versión de este docblock decía
 * de más.** Afirmaba que el residuo caza "un motivo conocido que empiece a
 * comportarse distinto, como una `devolucion` que empiece a reponer
 * ingredientes de receta". **Es falso por álgebra**, y lo levantó la revisión
 * independiente comprobándolo con un test: todo movimiento que cae en un bucket
 * existente mueve `porSaldos` **y** `porBuckets` por la misma cantidad, así que
 * el residuo queda en cero **por construcción**. El residuo no puede ver nada
 * que ya esté clasificado.
 *
 * Lo que SÍ caza: un movimiento que **mueve stock y no cae en ningún bucket ni
 * en `MOTIVOS_ABASTECIMIENTO`**. Hoy eso es `ajuste_manual`, escrito por
 * `PATCH /items/:id/stock`; mañana, cualquier `motivo` nuevo que alguien
 * agregue sin leer este archivo. Sigue siendo mejor que una lista de "motivos
 * que no conozco" —esa hay que acordarse de actualizarla—, pero el alcance es
 * ése y no más.
 *
 * 📌 **Y ese hallazgo destapó un bug real, ya corregido acá:** el mismo endpoint
 * acepta `motivo: 'devolucion'` **sin venta**, y el teórico restaba toda entrada
 * `devolucion`/`anulacion` sin mirar el origen — así que una devolución manual
 * bajaba el consumo teórico (o lo hacía negativo) como si hubiera revertido una
 * venta que nunca existió. Por eso esa resta ahora exige `venta_id IS NOT NULL`:
 * las tres escrituras que vienen de una venta lo llevan
 * (`VentasService.cancelarUnaVez` y las dos de nota de crédito) y
 * `ItemsService.ajustarStock` no lo pasa nunca. Con el filtro, la devolución
 * manual deja de ensuciar el teórico y cae donde corresponde: en «Otros».
 *
 * El precio es traer el saldo de los dos bordes (`SQL_SALDOS`), que sin esta
 * columna se podría ahorrar. Es lo que hace que la identidad corra **en
 * producción** y no solo en el test de e2e.
 *
 * Un saldo en `null` —un (item, ubicación) sin ningún movimiento hasta ese
 * borde— se trata como cero: no hay stock del cual partir.
 */
function residuo(
  bucket: BucketRow | undefined,
  saldo: SaldoRow | undefined,
): string {
  const d = (valor: string | null | undefined) => new Decimal(valor ?? 0);

  const porSaldos = d(saldo?.saldo_desde)
    .plus(d(bucket?.abastecimiento))
    .minus(d(saldo?.saldo_hasta));
  const porBuckets = d(bucket?.teorico)
    .plus(d(bucket?.merma))
    .plus(d(bucket?.cortesia))
    .plus(d(bucket?.sin_explicacion));

  return porSaldos.minus(porBuckets).toFixed(ESCALA_COSTO);
}

/**
 * Una fila con **menos de dos** recuentos aplicados en el rango no se puede
 * medir: sin dos bordes no hay ventana. Aparece igual —alguien contó ese
 * producto y merece saber que no alcanza— pero con todos los números en `null`,
 * que es la diferencia entre *"no se perdió nada"* y *"todavía no se puede
 * medir"*.
 */
function mapGrupo(
  r: GrupoRow,
  bucket: BucketRow | undefined,
  saldo: SaldoRow | undefined,
): VarianzaFila {
  const medible = r.recuentos >= 2;

  /**
   * ⚠️ **`toFixed(ESCALA_COSTO)` y no el string que devuelve Postgres.** Un
   * `COALESCE(SUM(...), 0)` cae en el literal entero cuando no hay filas que
   * sumar y vuelve `'0'`, no `'0.0000'` — el mismo detalle que ya mordió al
   * listado de recuentos. Y un grupo medible **sin movimientos en la ventana**
   * no vuelve en la agregación: sus números son ceros, no `null`. "No se movió
   * nada" y "no se puede medir" son respuestas distintas.
   */
  const num = (valor: string | undefined): string =>
    new Decimal(valor ?? 0).toFixed(ESCALA_COSTO);

  return {
    itemId: r.item_id,
    itemNombre: r.item_nombre,
    unidadMedida: r.unidad_medida,
    ubicacionId: r.ubicacion_id,
    ubicacionNombre: r.ubicacion_nombre,
    medible,
    desdeEl: medible ? r.desde_el : null,
    hastaEl: medible ? r.hasta_el : null,
    recuentoInicialId: medible ? r.recuento_inicial_id : null,
    recuentoFinalId: medible ? r.recuento_final_id : null,
    teorico: medible ? num(bucket?.teorico) : null,
    merma: medible ? num(bucket?.merma) : null,
    cortesia: medible ? num(bucket?.cortesia) : null,
    sinExplicacion: medible ? num(bucket?.sin_explicacion) : null,
    otros: medible ? num(residuo(bucket, saldo)) : null,
    costoSinExplicacion: [],
    faltaCosto: false,
  };
}

/** Fila cruda de la agregación de buckets, ya sumada por (item, ubicación). */
interface BucketRow {
  item_id: string;
  ubicacion_id: string;
  teorico: string;
  merma: string;
  cortesia: string;
  sin_explicacion: string;
  /** Entradas menos salidas de los motivos de ABASTECIMIENTO. No es consumo. */
  abastecimiento: string;
}

/** Fila cruda de la consulta de saldos: el stock en cada borde de la ventana. */
interface SaldoRow {
  item_id: string;
  ubicacion_id: string;
  saldo_desde: string | null;
  saldo_hasta: string | null;
}

/**
 * Los motivos que **abastecen** y por lo tanto no son consumo. Van como `text[]`
 * bindeado y no inline en el SQL, para que la lista viva en un solo lugar.
 *
 * ⛔ **Lo que NO esté acá ni en un bucket de consumo cae en «Otros», y eso es
 * exactamente lo que se quiere.** El caso vivo hoy es **`ajuste_manual`**, que
 * la API escribe por `PATCH /items/:id/stock` (`AjusteStockDto` lo acepta junto
 * con `compra`, `devolucion` e `inventario_inicial`). No es consumo ni
 * abastecimiento, pero **mueve stock**, así que corre el saldo del borde y el
 * residuo lo muestra por su cantidad exacta.
 *
 * 📌 **Consecuencia en producción, no solo en el test:** todo tenant que use
 * "Ajustar stock" dentro de una ventana va a ver «Otros» distinto de cero. Es
 * la conducta correcta —el reporte avisa que hay algo que no sabe explicar— y
 * está fijada por un e2e que lo monta con ese endpoint real.
 *
 * `ajuste_costo` no entra porque **no mueve stock**: sumarlo correría los saldos
 * sin que haya habido movimiento. `correccion_compra` tampoco mueve cantidad
 * —se escribe siempre con `tipo:'ajuste'` y `cantidad: 0`
 * (`inventario.service.ts`, `MOTIVOS_DE_VALOR`)—, así que su presencia en la
 * lista no cambia ningún número; se deja nombrado porque es de la familia de
 * abastecimiento y quien lea la lista lo va a buscar acá.
 */
const MOTIVOS_ABASTECIMIENTO = [
  'compra',
  'correccion_compra',
  'inventario_inicial',
  'traslado',
];

/**
 * El saldo de stock en cada borde de la ventana: el `stock_resultante` del
 * movimiento del recuento que la cierra, o —si ese recuento **dio justo** y no
 * escribió movimiento— el del último movimiento anterior a `aplicado_el`.
 *
 * ⚠️ **NO es `cantidad_contada`, y confundirlos es el error natural.** El
 * recuento aplica un **delta** sobre el stock vigente al aplicar, no setea el
 * valor contado: si se contaron 11.800 a las 10:00 y se vendieron 500 antes de
 * aplicar a las 14:00, el saldo al cerrar es 11.300
 * (`docs/features/recuento-inventario.md`). Tomar lo contado metería esas 500
 * en el residuo como si nadie las explicara.
 *
 * `<=` y no `<`: el saldo del borde es el de **después** de aplicar ese
 * recuento — que es el mismo instante en que arranca la ventana siguiente.
 */
const SQL_SALDOS = `
  WITH v(item_id, ubicacion_id, seq_desde, seq_hasta, desde_el, hasta_el) AS (
    SELECT * FROM unnest($2::uuid[], $3::uuid[], $4::bigint[], $5::bigint[],
                         $6::timestamptz[], $7::timestamptz[])
  )
  SELECT v.item_id,
         v.ubicacion_id,
         (SELECT m.stock_resultante
            FROM movimientos_inventario m
           WHERE m.item_id = v.item_id
             AND m.ubicacion_id = v.ubicacion_id
             AND m.tenant_id = $1
             AND m.eliminado_el IS NULL
             AND (CASE WHEN v.seq_desde IS NOT NULL THEN m.secuencia <= v.seq_desde
                       ELSE m.creado_el <= v.desde_el END)
           ORDER BY m.secuencia DESC
           LIMIT 1) AS saldo_desde,
         (SELECT m.stock_resultante
            FROM movimientos_inventario m
           WHERE m.item_id = v.item_id
             AND m.ubicacion_id = v.ubicacion_id
             AND m.tenant_id = $1
             AND m.eliminado_el IS NULL
             AND (CASE WHEN v.seq_hasta IS NOT NULL THEN m.secuencia <= v.seq_hasta
                       ELSE m.creado_el <= v.hasta_el END)
           ORDER BY m.secuencia DESC
           LIMIT 1) AS saldo_hasta
    FROM v`;

/**
 * Los cuatro números, agregados en UNA consulta para **todas** las ventanas de
 * la página. Las ventanas entran como arrays paralelos y se desarman con
 * `unnest`: una consulta por fila sería el N+1 que `docs/agent/anti-patterns.md`
 * prohíbe.
 *
 * ⛔ **El borde de cada ventana es `secuencia`, con `creado_el` como respaldo.**
 * El `CASE` no es una comodidad: cuando el recuento del borde dio **delta cero**
 * no escribió movimiento, así que no hay `secuencia` de la cual colgarse y la
 * única referencia que queda es `aplicado_el` (spec § 5.2). En ese caso vuelve
 * el riesgo de orden que el kardex documenta —dos transacciones sobre el mismo
 * producto pueden aplicarse invertidas respecto de `creado_el`—, y lo detecta la
 * columna «Otros» de la Tarea 4.
 *
 * ⚠️ **El intervalo es `(desde, hasta]`**: abierto al inicio y cerrado al final.
 * Los movimientos del recuento inicial pertenecen a la ventana ANTERIOR —son la
 * varianza que ESE conteo descubrió—, y contarlos acá los contaría dos veces.
 *
 * **Qué NO entra en ningún bucket, por criterio y no por lista:** todo lo que
 * es **abastecimiento o logística** —`compra`, `correccion_compra`,
 * `inventario_inicial`, `traslado`— y lo que **ni siquiera mueve stock**
 * (`ajuste_costo`). Los dos conteos que cierran la ventana ya los absorben. Un
 * traslado de bodega a local es **entrada del local**, y por eso medir por
 * ubicación no ensucia ninguna de las dos cuentas.
 *
 * ⚠️ **Y lo que no encaje en ningún bucket queda SIN clasificar a propósito**,
 * no se fuerza a ninguno: `ajuste_manual` —que la API escribe por
 * `PATCH /items/:id/stock`— es el caso vivo. El residuo («Otros») es el que lo
 * hace visible. Enumerar acá "los motivos excluidos" envejecería mal: uno nuevo
 * entraría en silencio y la lista seguiría pareciendo completa.
 *
 * 📌 **`motivo_baja` se lee sin filtro de `eliminado_el`, y el motivo es que el
 * caso NO EXISTE** (medido el 2026-09-20, no razonado): `MotivosBajaService.remove`
 * **impide borrar un motivo en uso** —mira `movimientos_inventario` y
 * `cuenta_linea_anulaciones` y devuelve 400—, así que ningún movimiento puede
 * quedar apuntando a un motivo borrado. Poner o no el filtro no tiene
 * consecuencia observable.
 *
 * ⚠️ Si alguna vez se afloja ese borrado, **el filtro sería lo PEOR que se
 * podría agregar acá**: `mb.tipo` saldría `NULL` y el movimiento desaparecería
 * de merma y de cortesía **a la vez**, sin caer en ningún bucket. La pregunta de
 * este `JOIN` es *"¿qué ERA esta merma cuando ocurrió?"*, y una pérdida pasada
 * no se reclasifica porque después se borró una fila de catálogo. Mismo criterio
 * que `MermasService.filtroTipoMerma`. (`anulaciones-reporte.service.ts` sí lo
 * filtra, pero ahí el `JOIN` cuelga de `cuenta_linea_anulaciones`: otra
 * pregunta.) El e2e deja esa garantía atada con un test.
 *
 * El `tenant_id` sí va: es defensa sin cambio de conducta, porque el motivo de
 * un movimiento es siempre del mismo tenant.
 */
const SQL_BUCKETS = `
  WITH v(item_id, ubicacion_id, seq_desde, seq_hasta, desde_el, hasta_el) AS (
    SELECT * FROM unnest($2::uuid[], $3::uuid[], $4::bigint[], $5::bigint[],
                         $6::timestamptz[], $7::timestamptz[])
  )
  SELECT v.item_id,
         v.ubicacion_id,
         COALESCE(SUM(mv.cantidad) FILTER (
           WHERE mv.motivo = 'venta' AND mv.tipo = 'salida'), 0)
         - COALESCE(SUM(mv.cantidad) FILTER (
           WHERE mv.motivo IN ('anulacion', 'devolucion') AND mv.tipo = 'entrada'
             AND mv.venta_id IS NOT NULL), 0)
           AS teorico,
         COALESCE(SUM(mv.cantidad) FILTER (
           WHERE mv.motivo = 'merma' AND mv.tipo = 'salida'
             AND mb.tipo = 'merma'), 0) AS merma,
         COALESCE(SUM(mv.cantidad) FILTER (
           WHERE mv.motivo = 'merma' AND mv.tipo = 'salida'
             AND mb.tipo = 'cortesia'), 0) AS cortesia,
         COALESCE(SUM(mv.cantidad) FILTER (
           WHERE mv.motivo = 'recuento' AND mv.tipo = 'salida'), 0)
         - COALESCE(SUM(mv.cantidad) FILTER (
           WHERE mv.motivo = 'recuento' AND mv.tipo = 'entrada'), 0)
           AS sin_explicacion,
         COALESCE(SUM(mv.cantidad) FILTER (
           WHERE mv.motivo = ANY($8::text[]) AND mv.tipo = 'entrada'), 0)
         - COALESCE(SUM(mv.cantidad) FILTER (
           WHERE mv.motivo = ANY($8::text[]) AND mv.tipo = 'salida'), 0)
           AS abastecimiento
    FROM v
    JOIN movimientos_inventario mv
      ON mv.item_id = v.item_id
     AND mv.ubicacion_id = v.ubicacion_id
     AND mv.tenant_id = $1
     AND mv.eliminado_el IS NULL
     AND (CASE WHEN v.seq_desde IS NOT NULL THEN mv.secuencia > v.seq_desde
               ELSE mv.creado_el > v.desde_el END)
     AND (CASE WHEN v.seq_hasta IS NOT NULL THEN mv.secuencia <= v.seq_hasta
               ELSE mv.creado_el <= v.hasta_el END)
    LEFT JOIN motivo_baja mb
      ON mb.motivo_baja_id = mv.motivo_baja_id
     AND mb.tenant_id = $1
   GROUP BY v.item_id, v.ubicacion_id`;

/** Clave de un grupo, para cruzar buckets contra filas sin recorrer arrays. */
function claveGrupo(itemId: string, ubicacionId: string): string {
  return `${itemId}|${ubicacionId}`;
}

/**
 * Reporte de varianza (AVT): consumo **teórico** —lo que las recetas dicen que
 * se consumió, dado lo vendido— contra consumo **real** entre dos conteos.
 *
 * Spec: `docs/superpowers/specs/2026-09-19-modulo-reportes-varianza-design.md`.
 *
 * 📌 **El teórico no se recalcula desde las recetas: ya está escrito.** Vender
 * una receta descuenta sus ingredientes del kardex con la receta vigente en ese
 * momento (`ItemsService.venderIngredientesReceta`), así que el consumo teórico
 * **es** el conjunto de salidas `motivo='venta'`. Recalcularlo desde
 * `receta_ingredientes` mentiría cada vez que alguien edita una receta — el repo
 * ya depende de esto para reponer stock al cancelar una venta
 * (`VentasService.cancelarUnaVez`, que lee el kardex y no las recetas).
 *
 * ⚠️ **Este service está a medio construir a propósito.** Las tareas 3 a 5 del
 * plan completan los cuatro números, «Otros» y la plata
 * (`docs/superpowers/plans/2026-09-19-modulo-reportes-varianza.md`). La Tarea 2
 * resuelve la **ventana** de cada fila; hasta que llegue la 3, los números
 * viajan en `null` incluso en las filas medibles, que es una respuesta honesta
 * —todavía no se calcularon— y no un placeholder con datos inventados.
 */
@Injectable()
export class VarianzaService {
  constructor(private readonly db: Db) {}

  async findAll(
    tenantId: string,
    query: QueryVarianzaDto,
  ): Promise<PaginatedResponse<VarianzaFila>> {
    const { page, pageSize, offset } = resolvePagination(query);
    // Solo si hay borde de fecha que expandir: ver `rango-fecha.util.ts`. Pasar
    // zona/corte cuando la consulta no los nombra hace que Postgres rechace el
    // bind y devuelva 500.
    const dia = requiereDiaNegocio(query.desde, query.hasta)
      ? await diaNegocioTenant(this.db, tenantId)
      : null;
    const { filtros, params } = this.buildFiltros(tenantId, query, dia);

    const countRows: { total: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total FROM (
         SELECT 1 ${FROM_GRUPOS} ${filtros} ${GROUP_BY_GRUPOS}
       ) g`,
      params,
    );
    const total = countRows[0]?.total ?? 0;

    const listParams = [...params, pageSize, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows: GrupoRow[] = await this.db.query(
      `${SELECT_GRUPOS} ${FROM_GRUPOS} ${filtros} ${GROUP_BY_GRUPOS}
       ORDER BY i.nombre ASC, ub.nombre ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );

    const buckets = await this.cargarBuckets(tenantId, rows);
    const saldos = await this.cargarSaldos(tenantId, rows);

    return {
      data: rows.map((r) => {
        const clave = claveGrupo(r.item_id, r.ubicacion_id);
        return mapGrupo(r, buckets.get(clave), saldos.get(clave));
      }),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  /**
   * Los cuatro números de todas las ventanas medibles de la página, en UNA
   * consulta.
   *
   * ⚠️ **Si ninguna fila es medible, no consulta.** Sin ventanas no hay nada que
   * agregar, y `unnest` de seis arrays vacíos sería un viaje a la base para
   * devolver cero filas.
   */
  private async cargarBuckets(
    tenantId: string,
    rows: GrupoRow[],
  ): Promise<Map<string, BucketRow>> {
    const medibles = rows.filter((r) => r.recuentos >= 2);
    const porGrupo = new Map<string, BucketRow>();
    if (medibles.length === 0) return porGrupo;

    const filas: BucketRow[] = await this.db.query(SQL_BUCKETS, [
      tenantId,
      medibles.map((r) => r.item_id),
      medibles.map((r) => r.ubicacion_id),
      medibles.map((r) => r.secuencia_desde),
      medibles.map((r) => r.secuencia_hasta),
      medibles.map((r) => r.desde_el),
      medibles.map((r) => r.hasta_el),
      MOTIVOS_ABASTECIMIENTO,
    ]);

    for (const f of filas) {
      porGrupo.set(claveGrupo(f.item_id, f.ubicacion_id), f);
    }
    return porGrupo;
  }

  /**
   * El saldo de stock en los dos bordes de cada ventana medible, en UNA
   * consulta. Mismo corto-circuito que `cargarBuckets`: sin ventanas no hay
   * bordes que buscar.
   */
  private async cargarSaldos(
    tenantId: string,
    rows: GrupoRow[],
  ): Promise<Map<string, SaldoRow>> {
    const medibles = rows.filter((r) => r.recuentos >= 2);
    const porGrupo = new Map<string, SaldoRow>();
    if (medibles.length === 0) return porGrupo;

    const filas: SaldoRow[] = await this.db.query(SQL_SALDOS, [
      tenantId,
      medibles.map((r) => r.item_id),
      medibles.map((r) => r.ubicacion_id),
      medibles.map((r) => r.secuencia_desde),
      medibles.map((r) => r.secuencia_hasta),
      medibles.map((r) => r.desde_el),
      medibles.map((r) => r.hasta_el),
    ]);

    for (const f of filas) {
      porGrupo.set(claveGrupo(f.item_id, f.ubicacion_id), f);
    }
    return porGrupo;
  }

  /**
   * `WHERE` compartido por el `COUNT` y por la página, para que el total no se
   * mueva sin avisar entre las dos consultas.
   *
   * ⚠️ Los bordes del rango van sobre `r.aplicado_el` —**cuándo se aplicó el
   * recuento**, no cuándo se creó la sesión—: una sesión puede tardar horas o
   * cruzar turnos, y el delta se aplica sobre el stock vigente al aplicar
   * (`docs/features/recuento-inventario.md`).
   */
  private buildFiltros(
    tenantId: string,
    query: Pick<QueryVarianzaDto, 'desde' | 'hasta' | 'ubicacionId' | 'itemId'>,
    dia: DiaNegocio | null,
  ): { filtros: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let filtros = ` WHERE r.tenant_id = $1
                      AND r.estado = 'aplicado'
                      AND r.eliminado_el IS NULL
                      AND rl.eliminado_el IS NULL
                      AND i.eliminado_el IS NULL
                      AND ub.eliminado_el IS NULL`;

    const idx = dia ? empujarDiaNegocio(params, dia) : null;

    if (query.desde) {
      params.push(query.desde);
      filtros += bordeFechaSql(
        'r.aplicado_el',
        '>=',
        query.desde,
        params.length,
        idx,
      );
    }
    if (query.hasta) {
      params.push(query.hasta);
      filtros += bordeHastaSql(
        'r.aplicado_el',
        query.hasta,
        params.length,
        idx,
      );
    }
    if (query.ubicacionId) {
      params.push(query.ubicacionId);
      filtros += ` AND r.ubicacion_id = $${params.length}`;
    }
    if (query.itemId) {
      params.push(query.itemId);
      filtros += ` AND rl.item_id = $${params.length}`;
    }

    return { filtros, params };
  }
}
