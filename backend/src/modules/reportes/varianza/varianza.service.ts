import { BadRequestException, Injectable } from '@nestjs/common';
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
import { ResumenVarianzaDto } from './dto/resumen-varianza.dto';

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
  /** `items.moneda_id`. Una fila es un ítem, así que es una sola moneda. */
  moneda_id: string;
  /** Neto de recuento en cantidad. Lo calcula `SQL_COSTO_LATERAL`, que ordena. */
  sin_explicacion: string;
  /** La misma cantidad, valorizada. `'0'` cuando la ventana está vacía. */
  monto: string;
  /** `bool_or` sobre cero movimientos vuelve `NULL`: se lee con `=== true`. */
  falta_costo: boolean | null;
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

/**
 * `i.moneda_id` entra al `GROUP BY` sin agregar ni una fila: una fila del
 * reporte es **un ítem**, y `items.moneda_id` es `NOT NULL`, así que el grupo ya
 * tenía una sola moneda posible. Va acá para que la plata de la fila salga de la
 * misma consulta —sin un `JOIN` extra ni una segunda vuelta a `items`— y para
 * que `CostoPorMoneda[]` se arme con la moneda correcta y no con una supuesta.
 */
const GROUP_BY_GRUPOS = ` GROUP BY rl.item_id, i.nombre, ip.unidad_medida,
                                   r.ubicacion_id, ub.nombre, i.moneda_id`;

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
         i.moneda_id,
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
  sinExplicacion: string | null | undefined,
): string {
  const d = (valor: string | null | undefined) => new Decimal(valor ?? 0);

  const porSaldos = d(saldo?.saldo_desde)
    .plus(d(bucket?.abastecimiento))
    .minus(d(saldo?.saldo_hasta));
  const porBuckets = d(bucket?.teorico)
    .plus(d(bucket?.merma))
    .plus(d(bucket?.cortesia))
    .plus(d(sinExplicacion));

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
   * ⛔ **Con un solo movimiento sin costo, la fila va SIN cifra.** Es el criterio
   * que el repo ya fijó en el reporte de anulaciones (`resolverCosto`): una suma
   * parcial se lee como completa, y nadie tiene cómo saber que le falta un
   * pedazo. El booleano dice que falta; la lista vacía evita el número que
   * mentiría. La cantidad, en cambio, sigue viajando: esa no depende del costo.
   *
   * El caso llega por la API real —un producto creado sin costo queda con
   * `costo_actual` en `NULL`, y el recuento congela ese `NULL`—, no es un estado
   * que haya que montar por SQL.
   */
  const faltaCosto = medible && r.falta_costo === true;

  /**
   * ⚠️ **`toFixed(ESCALA_COSTO)` y no el string que devuelve Postgres.** Un
   * `COALESCE(SUM(...), 0)` cae en el literal entero cuando no hay filas que
   * sumar y vuelve `'0'`, no `'0.0000'` — el mismo detalle que ya mordió al
   * listado de recuentos. Y un grupo medible **sin movimientos en la ventana**
   * no vuelve en la agregación: sus números son ceros, no `null`. "No se movió
   * nada" y "no se puede medir" son respuestas distintas.
   */
  const num = (valor: string | null | undefined): string =>
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
    sinExplicacion: medible ? num(r.sin_explicacion) : null,
    otros: medible ? num(residuo(bucket, saldo, r.sin_explicacion)) : null,
    // ⚠️ Una fila medible que cerró justo viaja con `[{ moneda, '0.0000' }]`, no
    // con `[]`. Diverge del molde de anulaciones —que devuelve lista vacía
    // cuando no hay grupos— y es a propósito: acá el cero es un resultado
    // medido ("no faltó nada"), no la ausencia de dato que la lista vacía
    // significa en las otras dos ramas (no medible, o sin costo). El e2e lo
    // fija para que no se "corrija" a `[]` por parecerse más al molde.
    costoSinExplicacion:
      medible && !faltaCosto
        ? [{ monedaId: r.moneda_id, monto: num(r.monto) }]
        : [],
    faltaCosto,
  };
}

/** Fila cruda de la agregación de buckets, ya sumada por (item, ubicación). */
interface BucketRow {
  item_id: string;
  ubicacion_id: string;
  teorico: string;
  merma: string;
  cortesia: string;
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
 * El predicado de la ventana `(desde, hasta]`, **compartido** por la agregación
 * de buckets y por el `LATERAL` que ordena la página.
 *
 * ⛔ **Se comparte porque las dos consultas TIENEN que mirar exactamente los
 * mismos movimientos.** Si una tomara el borde inferior como `>=` y la otra como
 * `>`, el reporte ordenaría por una plata calculada sobre una ventana y mostraría
 * una cantidad calculada sobre otra: dos números que no se contradicen en ningún
 * test porque cada uno, por separado, está bien.
 *
 * `alias` es la tabla que trae los bordes —la CTE `v` de los buckets o la
 * subconsulta `g` de la página—; el movimiento siempre se llama `mv`.
 */
const ventanaSql = (alias: string): string => `
     AND (CASE WHEN ${alias}.secuencia_desde IS NOT NULL THEN mv.secuencia > ${alias}.secuencia_desde
               ELSE mv.creado_el > ${alias}.desde_el END)
     AND (CASE WHEN ${alias}.secuencia_hasta IS NOT NULL THEN mv.secuencia <= ${alias}.secuencia_hasta
               ELSE mv.creado_el <= ${alias}.hasta_el END)`;

/**
 * **Qué movimiento cae en cada balde, en un solo lugar.**
 *
 * ⛔ **Se comparten entre la agregación de CANTIDADES (`SQL_BUCKETS`, la tabla) y
 * la de PLATA (`SQL_MONTOS`, el resumen), y ese es todo el punto.** Declarar los
 * mismos criterios dos veces deja que un balde signifique una cosa en la tabla y
 * otra en el total de arriba: los dos números serían internamente consistentes,
 * ninguno de los dos tests fallaría, y la pantalla mostraría una merma de 6 kilos
 * valorizada como si fueran 9. Es la misma razón por la que `ventanaSql` y
 * `NETO_RECUENTO` viven fuera de las consultas.
 *
 * El `mb` que nombran `MERMA` y `CORTESIA` es el `LEFT JOIN motivo_baja`: las dos
 * escriben el mismo `motivo='merma'` en el kardex y solo las separa
 * `motivo_baja.tipo`, así que **toda consulta que use estos dos predicados tiene
 * que traer ese JOIN**.
 */
const P = {
  TEORICO_SALIDA: `mv.motivo = 'venta' AND mv.tipo = 'salida'`,
  TEORICO_ENTRADA: `mv.motivo IN ('anulacion', 'devolucion') AND mv.tipo = 'entrada'
             AND mv.venta_id IS NOT NULL`,
  MERMA: `mv.motivo = 'merma' AND mv.tipo = 'salida' AND mb.tipo = 'merma'`,
  CORTESIA: `mv.motivo = 'merma' AND mv.tipo = 'salida' AND mb.tipo = 'cortesia'`,
  RECUENTO_SALIDA: `mv.motivo = 'recuento' AND mv.tipo = 'salida'`,
  RECUENTO_ENTRADA: `mv.motivo = 'recuento' AND mv.tipo = 'entrada'`,
} as const;

/**
 * El predicado de abastecimiento es **función del número de bind**, no una
 * constante: la lista de motivos va bindeada y su posición depende de la
 * consulta —en `SQL_BUCKETS` es fija, y en el resumen la decide `buildFiltros`,
 * que arma el `WHERE` dinámicamente—. Clavarle un `$8` la ataba a una sola
 * consulta sin que nada lo dijera.
 */
const pAbastecimiento = (idx: number, tipo: 'entrada' | 'salida'): string =>
  `mv.motivo = ANY($${idx}::text[]) AND mv.tipo = '${tipo}'`;

/**
 * "Sin explicación" en cantidad: Σ `recuento` con signo, salidas menos entradas.
 * Un sobrante entra como entrada y por eso **resta**.
 *
 * ⛔ **Vive en una sola constante y se usa en un solo lugar a la vez.** Hasta la
 * Tarea 5 este número se calculaba en `SQL_BUCKETS`; ahora lo calcula el
 * `LATERAL` de la página, porque es el que ordena y el que filtra
 * `soloConVarianza`. Tenerlo en los dos lados —aunque fuera el mismo texto—
 * dejaría dos caminos que pueden derivar, y el modo de falla sería silencioso:
 * la fila mostraría un número y la página se habría ordenado por otro.
 */
const NETO_RECUENTO = `COALESCE(SUM(mv.cantidad) FILTER (
           WHERE ${P.RECUENTO_SALIDA}), 0)
         - COALESCE(SUM(mv.cantidad) FILTER (
           WHERE ${P.RECUENTO_ENTRADA}), 0)`;

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
  WITH v(item_id, ubicacion_id, secuencia_desde, secuencia_hasta, desde_el, hasta_el) AS (
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
             AND (CASE WHEN v.secuencia_desde IS NOT NULL THEN m.secuencia <= v.secuencia_desde
                       ELSE m.creado_el <= v.desde_el END)
           ORDER BY m.secuencia DESC
           LIMIT 1) AS saldo_desde,
         (SELECT m.stock_resultante
            FROM movimientos_inventario m
           WHERE m.item_id = v.item_id
             AND m.ubicacion_id = v.ubicacion_id
             AND m.tenant_id = $1
             AND m.eliminado_el IS NULL
             AND (CASE WHEN v.secuencia_hasta IS NOT NULL THEN m.secuencia <= v.secuencia_hasta
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
  WITH v(item_id, ubicacion_id, secuencia_desde, secuencia_hasta, desde_el, hasta_el) AS (
    SELECT * FROM unnest($2::uuid[], $3::uuid[], $4::bigint[], $5::bigint[],
                         $6::timestamptz[], $7::timestamptz[])
  )
  SELECT v.item_id,
         v.ubicacion_id,
         COALESCE(SUM(mv.cantidad) FILTER (WHERE ${P.TEORICO_SALIDA}), 0)
         - COALESCE(SUM(mv.cantidad) FILTER (WHERE ${P.TEORICO_ENTRADA}), 0)
           AS teorico,
         COALESCE(SUM(mv.cantidad) FILTER (WHERE ${P.MERMA}), 0)    AS merma,
         COALESCE(SUM(mv.cantidad) FILTER (WHERE ${P.CORTESIA}), 0) AS cortesia,
         COALESCE(SUM(mv.cantidad) FILTER (WHERE ${pAbastecimiento(8, 'entrada')}), 0)
         - COALESCE(SUM(mv.cantidad) FILTER (WHERE ${pAbastecimiento(8, 'salida')}), 0)
           AS abastecimiento
    FROM v
    JOIN movimientos_inventario mv
      ON mv.item_id = v.item_id
     AND mv.ubicacion_id = v.ubicacion_id
     AND mv.tenant_id = $1
     AND mv.eliminado_el IS NULL
     ${ventanaSql('v')}
    LEFT JOIN motivo_baja mb
      ON mb.motivo_baja_id = mv.motivo_baja_id
     AND mb.tenant_id = $1
   GROUP BY v.item_id, v.ubicacion_id`;

/**
 * La plata de "sin explicación" y su cantidad, por grupo, dentro de la consulta
 * que pagina.
 *
 * ⛔ **Acá y no en una segunda consulta, porque esta plata ORDENA.** La spec
 * § 7.1 pide la página ordenada por plata perdida desc. Una consulta que corre
 * DESPUÉS de `LIMIT/OFFSET` solo puede ordenar las filas ya elegidas: la
 * página 1 traería las 15 primeras alfabéticamente, ordenadas entre sí, y no las
 * 15 que más plata perdieron — con el agravante de que la pantalla se vería
 * perfectamente ordenada. Lo mismo vale para `soloConVarianza`, que filtra por
 * una cantidad que antes solo existía en la agregación de buckets.
 *
 * ⛔ **`LATERAL` correlacionado y NO agregación de conjunto, y el porqué se mide
 * con la tabla grande.** La forma de conjunto —un `CTE` con
 * `GROUP BY`, como la que usa `SQL_BUCKETS`— parece la natural y con la base
 * sembrada gana por buffers. Se probaron las dos con `EXPLAIN (ANALYZE, BUFFERS)`
 * inflando el kardex a **198.293 movimientos** en la tabla (198.290 del tenant) (2026-09-20,
 * dentro de una transacción revertida):
 *
 * | | plan | tiempo en esta máquina |
 * |---|---|---|
 * | conjunto, sin filtros (30 grupos) | `Seq Scan` de 198.290 filas | ~37 ms |
 * | conjunto, filtrando un `itemId` (1 grupo) | `Bitmap Index Scan` | ~0,5 ms |
 * | `LATERAL`, sin filtros | `Bitmap Index Scan`, `loops=30` | ~7 ms |
 *
 * ⚠️ **Los milisegundos dependen de la máquina y del caché; lo que reproduce es
 * la FORMA del plan y la relación** (~5× entre la primera fila y la tercera, que
 * son las dos que se comparan: conjunto contra `LATERAL`, las dos sin filtros).
 * Si al remedir salen otros dígitos no hay nada roto: lo que hay que mirar es si
 * apareció un `Seq Scan` donde antes había índice.
 *
 * ⚠️ **El motivo NO es que la clave del `CTE` no se pueda empujar a un índice**
 * —se puede, y la segunda fila lo muestra—: es que **la forma de conjunto cambia
 * de plan según cuántos grupos sobrevivan**. Con uno, Postgres arma un nested
 * loop y entra por el índice; con treinta, estima que le conviene barrer la
 * tabla y barre 198.290 filas. Y la vista por defecto del reporte —sin filtrar
 * un producto— es justamente el caso de muchos grupos. El `LATERAL` no cambia de
 * forma: entra por `idx_movimientos_inventario_item_secuencia` una vez por
 * grupo, con filtros o sin ellos.
 *
 * ⚠️ **Y `SQL_BUCKETS` no es el precedente que parece.** Aquel agrega sobre las
 * ventanas de **la página** —15, pasadas como arrays a `unnest`—; este tiene que
 * cubrir **todos** los grupos del rango para poder ordenar. Es otro problema, y
 * por eso la respuesta es otra forma.
 *
 * ⛔ **`Σ ROUND(...)`, nunca `ROUND(Σ ...)`** — la regla que ya fijó el reporte
 * de anulaciones: se redondea el costo de cada movimiento y después se suman,
 * porque es cada movimiento el que tiene un costo, no la suma.
 *
 * El signo sigue al de la cantidad: un **sobrante** entra como `entrada` y resta,
 * igual que en `NETO_RECUENTO`. El costo de un movimiento de recuento es el CPP
 * congelado en el momento —lo que valía ese kilo cuando se descubrió que
 * faltaba—, porque el recuento no trae costo propio y el kardex le pone
 * `costoActualPrevio` (`inventario.service.ts`).
 *
 * 📌 **No agrupa por moneda y no le hace falta:** corre por grupo, un grupo es un
 * ítem y `items.moneda_id` es `NOT NULL`. La moneda viaja con el grupo
 * (`GROUP_BY_GRUPOS`). El array de `CostoPorMoneda` existe porque el `/resumen`
 * sí suma monedas distintas, no porque una fila pueda tener dos.
 *
 * ⚠️ **Un agregado sin `GROUP BY` devuelve SIEMPRE una fila**, también cuando la
 * ventana está vacía o la fila no es medible. Por eso `sin_explicacion` vuelve
 * `0` y nunca `NULL` —y el `WHERE` de `soloConVarianza` no necesita guarda—,
 * mientras que `falta_costo` es `bool_or` sobre cero filas y sí vuelve `NULL`:
 * el mapeo lo lee con `=== true`.
 *
 * ⚠️ **Lo que la Tarea 9 tiene que medir, y el índice que NO es la respuesta.**
 * Ordenar por un agregado obliga a evaluarlo en **todos** los grupos del rango
 * —no se puede saber cuáles son los 15 que más perdieron sin calcularlos a
 * todos—, así que la página paga ese barrido siempre, con filtro o sin él, y con
 * `soloConVarianza` se paga dos veces (el `COUNT` hace el suyo).
 *
 * Cada vuelta lee `rows=678` del kardex de ese ítem y el `Filter` descarta 677.
 * El candidato obvio, `(item_id, ubicacion_id, secuencia)`, **se creó y se midió:
 * 7,28 ms → 8,20 ms, o sea nada** (mismos `Heap Blocks`). Motivo: de las 677
 * filas descartadas, `ubicacion_id` saca 34; las otras las sacan los bordes de la
 * ventana, que van adentro de un `CASE` y **ningún índice puede servir un `CASE`
 * como `Index Cond`**.
 *
 * ⚠️ **La palanca es ese `CASE`, y los dos aplanados posibles NO son lo mismo**
 * (medido). El **equivalente** —`OR` con guarda de `IS NOT NULL`— devuelve los
 * mismos 30 resultados, pero su `Index Cond` **sigue siendo solo `item_id`**: no
 * desbloquea nada, y la diferencia de tiempo contra el `CASE` queda dentro del
 * ruido entre corridas. El **no equivalente** —comparar `secuencia` a secas—
 * mete los dos bordes en el `Index Cond` y la consulta pasa de ~7 ms a menos de
 * 1, pero **cambia el resultado de 9 de los 30 grupos**, que caen a cero porque
 * pierden el respaldo por `creado_el` del recuento de delta cero. La mejora
 * existe y su precio es exactamente ese: decisión de la Tarea 9, no un arreglo
 * gratis.
 *
 * 📌 **Cómo se infló el kardex, para que esto se pueda repetir:** copiando los
 * movimientos del tenant ×250 dentro de una transacción revertida. Se probaron
 * las dos variantes —copias con `creado_el` corrido unos segundos y copias en
 * `now()`— y dan lo mismo: 678 filas leídas y 677 descartadas por vuelta. O sea
 * que el número **no** depende de esa elección.
 *
 * ⚠️ **Y la distribución del seed es parte de esta medición:** de los 30 grupos,
 * **17 tienen `secuencia_desde` en `NULL`** y 8 `secuencia_hasta`, o sea que
 * buena parte de lo medido arriba pasa por la rama de respaldo `creado_el` y no
 * por la de `secuencia`. Un seed donde todos los recuentos escriban movimiento
 * ejercita la otra rama y puede dar otro número.
 */
const SQL_COSTO_LATERAL = `
      SELECT ${NETO_RECUENTO} AS sin_explicacion,
             COALESCE(SUM(ROUND(mv.cantidad * mv.costo_unitario, ${ESCALA_COSTO})) FILTER (
               WHERE mv.motivo = 'recuento' AND mv.tipo = 'salida'), 0)
             - COALESCE(SUM(ROUND(mv.cantidad * mv.costo_unitario, ${ESCALA_COSTO})) FILTER (
               WHERE mv.motivo = 'recuento' AND mv.tipo = 'entrada'), 0)
               AS monto,
             bool_or(mv.costo_unitario IS NULL) FILTER (
               WHERE mv.motivo = 'recuento')                        AS falta_costo
        FROM movimientos_inventario mv
       WHERE mv.item_id = g.item_id
         AND mv.ubicacion_id = g.ubicacion_id
         AND mv.tenant_id = $1
         AND mv.eliminado_el IS NULL
         ${ventanaSql('g')}`;

/**
 * La plata de UN movimiento: cantidad por su costo congelado, **ya redondeada**.
 *
 * ⛔ **`Σ ROUND(...)`, nunca `ROUND(Σ ...)`** — la regla que fijó el reporte de
 * anulaciones: el costo lo tiene cada movimiento, no la suma. Vive en una
 * constante para que las dos agregaciones que la usan no puedan redondear en
 * momentos distintos.
 */
const MONTO = `ROUND(mv.cantidad * mv.costo_unitario, ${ESCALA_COSTO})`;

/** Un producto nombrado, para las listas del aviso y del faltante de conteo. */
export interface ItemBreve {
  itemId: string;
  nombre: string;
}

/** `GET /reportes/varianza/resumen` (spec § 7.2). */
export interface ResumenVarianza {
  /**
   * ⚠️ **Los totales van SOLO en plata, nunca en cantidad.** Sumar los kilos de
   * la harina con los litros del aceite no significa nada; la plata es lo único
   * comparable entre productos, y por eso es también lo que ordena el listado.
   * La cantidad se lee por fila, en la tabla.
   */
  totales: {
    teorico: CostoPorMoneda[];
    merma: CostoPorMoneda[];
    cortesia: CostoPorMoneda[];
    sinExplicacion: CostoPorMoneda[];
    otros: CostoPorMoneda[];
  };
  /** Top 10 por plata perdida, ya ordenado desc. Es lo que dibuja la gráfica. */
  top: {
    itemId: string;
    itemNombre: string;
    merma: string;
    cortesia: string;
    sinExplicacion: string;
    monedaId: string;
  }[];
  /** Cuántos productos con pérdida quedaron afuera del top. */
  fueraDelTop: number;
  /** `true` si algún movimiento del rango no tenía costo: los totales están cortos. */
  faltaCosto: boolean;
  /**
   * Lo que **no se puede medir**, abierto en dos por decisión del owner
   * (2026-09-20): al primero le falta **empezar** a contarse, al segundo le falta
   * **cerrar** el conteo. Los dos conjuntos son disjuntos por construcción —cero
   * recuentos contra exactamente uno—, y un test lo fija.
   */
  sinConteo: {
    nuncaContado: { total: number; items: ItemBreve[] };
    contadoUnaSolaVez: { total: number; items: ItemBreve[] };
  };
}

/** Fila cruda de la agregación de plata: un (item, ubicación) ya valorizado. */
interface MontoRow {
  item_id: string;
  item_nombre: string;
  moneda_id: string;
  teorico: string;
  merma: string;
  cortesia: string;
  sin_explicacion: string;
  /** Σ con signo de consumo (salidas − entradas) sobre **todos** los movimientos. */
  consumo_total: string;
  abastecimiento: string;
  falta_costo: boolean | null;
}

/**
 * La plata de cada balde, por (item, ubicación), para el resumen.
 *
 * ⛔ **«Otros» NO se enumera: se despeja.** Es la decisión que sostiene esta
 * consulta, y el porqué tiene que vivir acá para que nadie la "mejore". Un
 * residuo no tiene costo unitario —no hay nada que multiplicar—, así que su plata
 * es la de los movimientos que no cayeron en ningún balde. Se podría listar esos
 * motivos (`ajuste_manual` hoy) y sumarlos… y esa lista envejecería **en
 * silencio** el día que alguien agregue un motivo nuevo: el total seguiría
 * cerrando contra sí mismo, y la plata del motivo nuevo simplemente no estaría en
 * ninguna parte. Despejándolo de la resta, un motivo nuevo cae solo en «Otros»
 * —que es justo lo que «Otros» significa— sin que nadie toque este archivo.
 *
 * ```
 * consumo_total = teórico + merma + cortesía + sin explicación + otros − abastecimiento
 * otros         = consumo_total − teórico − merma − cortesía − sin explicación + abastecimiento
 * ```
 *
 * `consumo_total` suma **todos** los movimientos de la ventana con signo de
 * consumo (salidas menos entradas), y por eso el abastecimiento entra ahí con
 * signo negativo: sumárselo de vuelta es lo que lo cancela.
 *
 * ⚠️ **Los baldes usan los MISMOS predicados que la tabla** (`P`, arriba). Si
 * esta consulta los declarara por su cuenta, una merma podría ser de 6 kilos
 * abajo y valorizarse como 9 arriba, con los dos números internamente
 * consistentes y ningún test en rojo.
 *
 * ⚠️ **Un movimiento sin `costo_unitario` no suma y `falta_costo` lo delata.**
 * `SUM` ignora los `NULL`, así que sin esa bandera el total saldría corto y
 * parecería completo — el mismo criterio que la fila del listado.
 */
const sqlMontosPorGrupo = (idxMotivos: number): string => `
      SELECT COALESCE(SUM(${MONTO}) FILTER (WHERE ${P.TEORICO_SALIDA}), 0)
             - COALESCE(SUM(${MONTO}) FILTER (WHERE ${P.TEORICO_ENTRADA}), 0)
               AS teorico,
             COALESCE(SUM(${MONTO}) FILTER (WHERE ${P.MERMA}), 0)    AS merma,
             COALESCE(SUM(${MONTO}) FILTER (WHERE ${P.CORTESIA}), 0) AS cortesia,
             COALESCE(SUM(${MONTO}) FILTER (WHERE ${P.RECUENTO_SALIDA}), 0)
             - COALESCE(SUM(${MONTO}) FILTER (WHERE ${P.RECUENTO_ENTRADA}), 0)
               AS sin_explicacion,
             COALESCE(SUM(${MONTO}) FILTER (WHERE mv.tipo = 'salida'), 0)
             - COALESCE(SUM(${MONTO}) FILTER (WHERE mv.tipo = 'entrada'), 0)
               AS consumo_total,
             COALESCE(SUM(${MONTO}) FILTER (
               WHERE ${pAbastecimiento(idxMotivos, 'entrada')}), 0)
             - COALESCE(SUM(${MONTO}) FILTER (
               WHERE ${pAbastecimiento(idxMotivos, 'salida')}), 0)
               AS abastecimiento,
             bool_or(mv.costo_unitario IS NULL)                      AS falta_costo
        FROM movimientos_inventario mv
        LEFT JOIN motivo_baja mb
          ON mb.motivo_baja_id = mv.motivo_baja_id
         AND mb.tenant_id = $1
       WHERE mv.item_id = g.item_id
         AND mv.ubicacion_id = g.ubicacion_id
         AND mv.tenant_id = $1
         AND mv.eliminado_el IS NULL
         ${ventanaSql('g')}`;

/**
 * Tope del rango del resumen: 366 días de DIFERENCIA entre `desde` y `hasta`.
 * Mismo número y mismo motivo que el resumen de anulaciones y el de propinas —
 * consultas sin `LIMIT` sobre todo el rango.
 */
const TOPE_RANGO_RESUMEN_MS = 366 * 24 * 60 * 60 * 1000;

/** Cuántos productos entran en la gráfica. El resto se cuenta en `fueraDelTop`. */
const TOP_N = 10;

/** Fila cruda del faltante de conteo: un producto activo y cuántas veces se contó. */
interface ConteoRow {
  item_id: string;
  nombre: string;
  recuentos: number;
}

/**
 * Suma las filas valorizadas: los totales por moneda, el top para la gráfica y
 * cuántos quedaron afuera.
 *
 * ⛔ **Acá se despeja «Otros», y por eso no hay ninguna lista de motivos.** Ver
 * el docblock de `sqlMontosPorGrupo`: un motivo nuevo cae solo en «Otros», que
 * es lo que «Otros» significa, sin que nadie tenga que acordarse de este archivo.
 *
 * ⚠️ **Se suma con `Decimal`, no con `number`.** Son montos: el `+` nativo sobre
 * cuatro decimales acumula error y el reporte existe justamente para que los
 * números cierren.
 *
 * 📌 **El top es por ÍTEM, no por (ítem, ubicación).** Al encargado le importa
 * qué producto está perdiendo plata, no en qué depósito; las filas del mismo
 * ítem en distintas ubicaciones se suman, y su moneda es la misma porque
 * `items.moneda_id` es una sola por ítem.
 *
 * ⚠️ **"Plata perdida" es merma + cortesía + sin explicación, sin el teórico.**
 * El teórico es el consumo que las recetas explican: es lo que el local
 * **gastó**, no lo que perdió. Meterlo en el ranking pondría primeros a los
 * productos que más se venden.
 */
function agregarMontos(
  filas: MontoRow[],
): Pick<ResumenVarianza, 'totales' | 'top' | 'fueraDelTop' | 'faltaCosto'> {
  const d = (valor: string | null | undefined): Decimal =>
    new Decimal(valor ?? 0);

  const totales = {
    teorico: new Map<string, Decimal>(),
    merma: new Map<string, Decimal>(),
    cortesia: new Map<string, Decimal>(),
    sinExplicacion: new Map<string, Decimal>(),
    otros: new Map<string, Decimal>(),
  };
  const acumular = (
    mapa: Map<string, Decimal>,
    monedaId: string,
    monto: Decimal,
  ): void => {
    mapa.set(monedaId, (mapa.get(monedaId) ?? new Decimal(0)).plus(monto));
  };

  interface Acumulado {
    nombre: string;
    monedaId: string;
    merma: Decimal;
    cortesia: Decimal;
    sinExplicacion: Decimal;
  }
  const porItem = new Map<string, Acumulado>();
  let faltaCosto = false;

  for (const f of filas) {
    if (f.falta_costo === true) faltaCosto = true;

    const teorico = d(f.teorico);
    const merma = d(f.merma);
    const cortesia = d(f.cortesia);
    const sinExplicacion = d(f.sin_explicacion);
    const otros = d(f.consumo_total)
      .minus(teorico)
      .minus(merma)
      .minus(cortesia)
      .minus(sinExplicacion)
      .plus(d(f.abastecimiento));

    acumular(totales.teorico, f.moneda_id, teorico);
    acumular(totales.merma, f.moneda_id, merma);
    acumular(totales.cortesia, f.moneda_id, cortesia);
    acumular(totales.sinExplicacion, f.moneda_id, sinExplicacion);
    acumular(totales.otros, f.moneda_id, otros);

    const acc = porItem.get(f.item_id) ?? {
      nombre: f.item_nombre,
      monedaId: f.moneda_id,
      merma: new Decimal(0),
      cortesia: new Decimal(0),
      sinExplicacion: new Decimal(0),
    };
    acc.merma = acc.merma.plus(merma);
    acc.cortesia = acc.cortesia.plus(cortesia);
    acc.sinExplicacion = acc.sinExplicacion.plus(sinExplicacion);
    porItem.set(f.item_id, acc);
  }

  const perdida = (a: Acumulado): Decimal =>
    a.merma.plus(a.cortesia).plus(a.sinExplicacion);

  const conPerdida = [...porItem.entries()].filter(
    ([, a]) => !perdida(a).isZero(),
  );
  conPerdida.sort(
    ([, a], [, b]) =>
      perdida(b).comparedTo(perdida(a)) || a.nombre.localeCompare(b.nombre),
  );

  return {
    totales: {
      teorico: porMoneda(totales.teorico),
      merma: porMoneda(totales.merma),
      cortesia: porMoneda(totales.cortesia),
      sinExplicacion: porMoneda(totales.sinExplicacion),
      otros: porMoneda(totales.otros),
    },
    top: conPerdida.slice(0, TOP_N).map(([itemId, a]) => ({
      itemId,
      itemNombre: a.nombre,
      merma: a.merma.toFixed(ESCALA_COSTO),
      cortesia: a.cortesia.toFixed(ESCALA_COSTO),
      sinExplicacion: a.sinExplicacion.toFixed(ESCALA_COSTO),
      monedaId: a.monedaId,
    })),
    fueraDelTop: Math.max(0, conPerdida.length - TOP_N),
    faltaCosto,
  };
}

/**
 * Un mapa de montos por moneda, serializado. **Nunca se suma entre monedas ni se
 * convierte**: cada una viaja por separado, y el orden por `monedaId` hace que
 * la respuesta sea estable entre llamadas.
 */
function porMoneda(mapa: Map<string, Decimal>): CostoPorMoneda[] {
  return [...mapa.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monedaId, monto]) => ({
      monedaId,
      monto: monto.toFixed(ESCALA_COSTO),
    }));
}

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
 * 📌 **Este service resuelve el LISTADO paginado y nada más.** El `/resumen`
 * —totales, top 10 y aviso de teórico incompleto— y la pantalla son otras tareas
 * del plan `docs/superpowers/plans/2026-09-19-modulo-reportes-varianza.md`, que
 * es donde está al día qué falta; enumerarlo acá sería un conteo que envejece
 * solo y que hace que el próximo deje de mirar el plan.
 *
 * ⚠️ **Un `null` en los números NO es un placeholder**: sale cuando la fila no es
 * medible, y es la diferencia entre *"no se perdió nada"* y *"todavía no se puede
 * medir"* — que es justo lo que el reporte existe para distinguir.
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

    const soloConVarianza = query.soloConVarianza === true;
    const grupos = `${SELECT_GRUPOS} ${FROM_GRUPOS} ${filtros} ${GROUP_BY_GRUPOS}`;
    const uneCosto = ` FROM (${grupos}) g
         LEFT JOIN LATERAL (${SQL_COSTO_LATERAL}) c ON TRUE`;

    /**
     * ⛔ **`soloConVarianza` esconde TAMBIÉN las filas que no se pueden medir, y
     * es una decisión del owner (2026-09-20), no un efecto del `COALESCE`.**
     *
     * Una fila con un solo recuento en el rango tiene ventana vacía, así que su
     * `sin_explicacion` agrega a `0` — cae por el mismo lado que la que cerró
     * justa. (Con un solo recuento los dos bordes son el mismo: el predicado
     * queda `> S AND <= S`, que no deja pasar nada.) La escena que se decidió: el encargado
     * tilda "mostrar solo lo que tiene diferencia" sobre 40 productos, de los
     * cuales 12 tienen diferencia, 20 cerraron justos y 8 se contaron una sola
     * vez. **Ve los 12.** Prefiere la lista corta que va derecho a lo que perdió
     * plata, y lo que falta contar no es una diferencia.
     *
     * ⚠️ **El precio, y no hay otro lugar donde se pague.** Quien tilde el filtro
     * no se entera de esos 8 — y **no los cubre ningún otro número del módulo**:
     * el `sinConteo` del `/resumen` (Tarea 6) y la spec § 5.7 cuentan los
     * productos con **cero** recuentos en el rango, no los que se contaron una
     * sola vez. Un producto contado una vez, con el filtro tildado, no aparece en
     * ninguna parte. El owner decidió con ese costo a la vista, y la pregunta
     * quedó escrita en el docblock del campo `sinConteo` de la Tarea 6 del plan,
     * que es donde se decide si ese conteo se abre en "nunca contado" y "contado
     * una sola vez".
     *
     * Si algún día se quiere que aparezcan marcados, el cambio es en esta
     * condición, agregándole `g.recuentos >= 2` como discriminante. El e2e lo
     * fija.
     */
    const dondeVarianza = soloConVarianza
      ? ' WHERE c.sin_explicacion <> 0'
      : '';

    // Sin `soloConVarianza` el COUNT usa la forma barata —`SELECT 1` y el
    // `GROUP BY`—, que cuenta exactamente los mismos grupos: un agregado sin
    // `GROUP BY` devuelve siempre una fila, así que el `LATERAL` no puede sumar
    // ni restar ninguna. Con el filtro puesto hay que pagar la agregación,
    // porque es ella la que decide quién entra. Las dos formas tienen que contar
    // lo mismo que trae la página, y eso lo fija el e2e con un mutante propio.
    const countRows: { total: number }[] = await this.db.query(
      soloConVarianza
        ? `SELECT COUNT(*)::int AS total ${uneCosto} ${dondeVarianza}`
        : `SELECT COUNT(*)::int AS total FROM (
             SELECT 1 ${FROM_GRUPOS} ${filtros} ${GROUP_BY_GRUPOS}
           ) g`,
      params,
    );
    const total = countRows[0]?.total ?? 0;

    const listParams = [...params, pageSize, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    /**
     * ⛔ **El orden sale de esta consulta, antes del `LIMIT`.** Ordenar por plata
     * después de elegir la página ordena solo esas 15 filas — y se ve igual de
     * prolijo en pantalla, que es lo que lo vuelve peligroso.
     *
     * ⚠️ **Entre monedas distintas, `monto` se compara como número y eso NO es
     * una comparación de valor.** No se convierte —la invariante lo prohíbe y
     * convertir con la tasa de hoy reescribiría el pasado—, así que cualquier
     * orden total entre monedas es una convención. Esta es la que acierta en el
     * caso real (todas las filas en la moneda del local) y es determinista en el
     * otro.
     *
     * ⛔ **El orden cierra con los dos IDs, y sin ellos la paginación puede
     * repetir o saltear una fila.** Una fila de este reporte es un
     * **(ítem, ubicación)**, y los nombres no identifican a ninguno de los dos:
     * `items.nombre` no es único por tenant —no hay índice ni validación que lo
     * impida—, y el de `ubicaciones` hoy sí lo es, pero por un índice único que
     * vive en el seeder y no en la entidad, así que no es algo en lo que este
     * `ORDER BY` deba apoyarse. Con `item_id` y `ubicacion_id` al final, el orden
     * es total **por la clave del grupo**, sin depender de ningún índice de otro
     * módulo. (Es el mismo desempate que ya llevan los `array_agg` de
     * `SELECT_GRUPOS`, y por el mismo motivo.)
     *
     * `monto` nunca es `NULL` —los `COALESCE` de adentro del `LATERAL` lo
     * garantizan—, así que no lleva `NULLS LAST`: un grupo sin movimientos en su
     * ventana ordena con `0`, entre los que no perdieron nada.
     *
     * ⚠️ **Una fila con `faltaCosto` se ordena por una suma que NO muestra.**
     * `SUM` ignora los `NULL`, así que el `monto` de esa fila es solo la parte
     * que tenía costo — y si ningún movimiento lo tenía, es `0` y la fila queda
     * entre las que no perdieron nada (por encima de los sobrantes, que tienen
     * monto negativo). Es justo el producto al que le falta cargar el precio. Se
     * deja así porque la alternativa —inventarle una posición— sería peor, pero
     * está anotado como cuarta entrada del backlog en el Paso 3 de la Tarea 10: la
     * salida candidata es que la pantalla lo marque, no que el orden lo simule,
     * pero eso lo decide el owner.
     */
    const rows: GrupoRow[] = await this.db.query(
      `SELECT g.*, c.sin_explicacion, c.monto, c.falta_costo
         ${uneCosto}
        ${dondeVarianza}
        ORDER BY c.monto DESC, g.item_nombre ASC,
                 g.ubicacion_nombre ASC, g.item_id ASC, g.ubicacion_id ASC
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
   * `GET /reportes/varianza/resumen` (spec § 7.2): los totales por moneda, el top
   * 10 para la gráfica, el aviso de teórico incompleto y el faltante de conteo.
   *
   * ⛔ **Corre SIN `LIMIT` sobre todo el rango**, y por eso `desde`/`hasta` son
   * obligatorios y tienen tope. Son **dos consultas fijas**, no una por
   * producto: la plata por grupo y el faltante de conteo.
   *
   * 📌 **No trae el aviso de "teórico incompleto" que la spec § 5.6 preveía, y
   * es una decisión del owner (2026-09-20) tomada sobre una medición.** Los dos
   * casos que el aviso iba a nombrar **no los deja producir la API**: una receta
   * exige al menos un ingrediente al crearse y al editarse
   * (`ItemsService`, las dos guardas de "Las recetas requieren al menos un
   * ingrediente"), y un ingrediente de receta tiene que ser `tipo='ingrediente'`
   * — tipo que **siempre** recibe fila en `item_producto` al crearse—. O sea que
   * el aviso habría sido una consulta que devuelve vacío siempre y un cartel que
   * no se ve nunca, sin forma de probarlo salvo escribiendo en la base a mano.
   *
   * ⚠️ **Si alguna vez se afloja cualquiera de esas dos guardas, este reporte
   * deja de avisar que sus números están cortos** — y no va a haber nada que lo
   * señale. El caso que sí ocurre es el tercero de § 5.6 (se vendió sin un insumo
   * no bloqueante), y ese **no se persiste**: el dato viaja en la respuesta HTTP
   * y se pierde. Es frente propio, no de acá.
   */
  async resumen(
    tenantId: string,
    query: ResumenVarianzaDto,
  ): Promise<ResumenVarianza> {
    this.validarRangoResumen(query.desde, query.hasta);

    const dia = requiereDiaNegocio(query.desde, query.hasta)
      ? await diaNegocioTenant(this.db, tenantId)
      : null;
    const { filtros, params } = this.buildFiltros(tenantId, query, dia);

    const montos: MontoRow[] = await this.db.query(
      `SELECT g.item_id, g.item_nombre, g.moneda_id,
              c.teorico, c.merma, c.cortesia, c.sin_explicacion,
              c.consumo_total, c.abastecimiento, c.falta_costo
         FROM (${SELECT_GRUPOS} ${FROM_GRUPOS} ${filtros} ${GROUP_BY_GRUPOS}) g
         LEFT JOIN LATERAL (${sqlMontosPorGrupo(params.length + 1)}) c ON TRUE`,
      [...params, MOTIVOS_ABASTECIMIENTO],
    );

    const sinConteo = await this.cargarSinConteo(tenantId, query, dia);

    return { ...agregarMontos(montos), sinConteo };
  }

  /**
   * El rango del resumen: `hasta` no puede ser anterior a `desde`, y la
   * DIFERENCIA entre los dos no puede pasar de 366 días. Corre ANTES de cualquier
   * consulta.
   *
   * ⚠️ **366 días de diferencia no son 366 días calendario cubiertos.** Con fecha
   * pura y `hasta` inclusivo —que le suma un día antes de comparar, igual que el
   * listado—, el rango efectivo llega a 367 días. Es la diferencia LITERAL entre
   * los dos valores la que tiene tope, y así lo dice el mensaje del 400. Mismo
   * criterio y mismo texto que `AnulacionesReporteService.validarRangoResumen`.
   *
   * ⚠️ **Vive acá y no en un decorator del DTO** para poder probarlo sin pasar
   * por el `ValidationPipe`: un test que arma el DTO a mano no ejercita los
   * pipes, así que una validación que viva solo ahí queda sin cubrir.
   */
  private validarRangoResumen(desde: string, hasta: string): void {
    const desdeMs = Date.parse(desde);
    const hastaMs = Date.parse(hasta);
    if (!Number.isFinite(desdeMs) || !Number.isFinite(hastaMs)) {
      throw new BadRequestException('desde/hasta deben ser fechas válidas');
    }
    if (hastaMs < desdeMs) {
      throw new BadRequestException('hasta no puede ser anterior a desde');
    }
    if (hastaMs - desdeMs > TOPE_RANGO_RESUMEN_MS) {
      throw new BadRequestException(
        'La diferencia entre desde y hasta no puede superar 366 días',
      );
    }
  }

  /**
   * Lo que **no se puede medir**, en UNA consulta y abierto en dos: los productos
   * activos sin ningún recuento aplicado en el rango, y los que tienen
   * exactamente uno.
   *
   * ⛔ **Sale de una agregación, no de traer el catálogo y restar en memoria.**
   * Restar en memoria es un N+1 de manual sobre una tabla que crece, y además
   * haría que el total y el detalle salgan por caminos distintos — que es justo
   * lo que no puede pasar acá: si la línea dice 43, 43 tiene que ser lo que
   * aparece al abrirla.
   *
   * ⛔ **El universo son los ítems `activo = true`, no el catálogo entero**
   * (decisión del owner, 2026-09-20): si un producto ya no se vende, lo correcto
   * es archivarlo, no inventar una regla en el reporte para esconderlo. El
   * catálogo entero daría un número que nunca baja; "solo lo que tuvo
   * movimiento" dejaría invisible al producto activo sin un solo movimiento, que
   * es exactamente el caso del robo completo.
   *
   * ⚠️ **Arista aceptada a sabiendas** (mismo día): pausar un ítem que todavía
   * tiene stock lo saca del reporte con existencias adentro. Pausar es "no lo
   * vendo más", no "no lo tengo más". No se arregla en este frente.
   *
   * ⚠️ **Los filtros de rango y de ubicación van en el `ON` del `LEFT JOIN`, no
   * en el `WHERE`.** En el `WHERE` convertirían el `LEFT` en un `INNER` de hecho
   * y se llevarían puestos justamente a los que nunca se contaron, que son los
   * que esta consulta viene a encontrar.
   */
  private async cargarSinConteo(
    tenantId: string,
    query: ResumenVarianzaDto,
    dia: DiaNegocio | null,
  ): Promise<ResumenVarianza['sinConteo']> {
    const params: unknown[] = [tenantId];
    const idx = dia ? empujarDiaNegocio(params, dia) : null;

    params.push(query.desde);
    let onRecuento = bordeFechaSql(
      'r.aplicado_el',
      '>=',
      query.desde,
      params.length,
      idx,
    );
    params.push(query.hasta);
    onRecuento += bordeHastaSql(
      'r.aplicado_el',
      query.hasta,
      params.length,
      idx,
    );
    if (query.ubicacionId) {
      params.push(query.ubicacionId);
      onRecuento += ` AND r.ubicacion_id = $${params.length}`;
    }
    // ⚠️ Un recuento aplicado en una ubicación **borrada** no cuenta como
    // conteo: el listado ya descarta esas filas (`buildFiltros` filtra
    // `ub.eliminado_el IS NULL`), así que sin esto el faltante y la tabla
    // describirían universos distintos — un producto podría no aparecer en el
    // faltante "porque se contó", y no estar en la tabla porque ese conteo se
    // descartó. Va como `EXISTS` y no como `JOIN` para no romper el `LEFT`:
    // los que nunca se contaron tienen que sobrevivir.
    onRecuento += ` AND EXISTS (
              SELECT 1 FROM ubicaciones ub
               WHERE ub.ubicacion_id = r.ubicacion_id
                 AND ub.tenant_id = i.tenant_id
                 AND ub.eliminado_el IS NULL)`;

    let filtroItem = '';
    if (query.itemId) {
      params.push(query.itemId);
      filtroItem = ` AND i.item_id = $${params.length}`;
    }

    /**
     * ⛔ **Se cuenta por (ítem, ubicación) y después se toma el MÁXIMO, no se
     * suma el ítem entero.** La tabla mide por (ítem, ubicación): un producto es
     * medible cuando ALGUNA ubicación tiene dos conteos. Sumando el ítem entero,
     * uno contado una vez en el local y una vez en la bodega daba 2 y
     * desaparecía de las dos listas del faltante — pero en la tabla aparece dos
     * veces y ninguna se puede medir. Con el máximo, "no llegó a dos en ninguna
     * parte" es exactamente lo que el faltante dice.
     */
    const filas: ConteoRow[] = await this.db.query(
      `SELECT q.item_id, q.nombre, MAX(q.recuentos)::int AS recuentos
         FROM (
       SELECT i.item_id, i.nombre, r.ubicacion_id,
              COUNT(DISTINCT r.recuento_id)::int AS recuentos
         FROM items i
         JOIN item_producto ip ON ip.item_id = i.item_id
         LEFT JOIN recuento_inventario_linea rl
           ON rl.item_id = i.item_id
          AND rl.tenant_id = i.tenant_id
          AND rl.eliminado_el IS NULL
         LEFT JOIN recuento_inventario r
           ON r.recuento_id = rl.recuento_id
          AND r.tenant_id = i.tenant_id
          AND r.estado = 'aplicado'
          AND r.eliminado_el IS NULL
          ${onRecuento}
        WHERE i.tenant_id = $1
          AND i.eliminado_el IS NULL
          AND i.activo = TRUE
          ${filtroItem}
        GROUP BY i.item_id, i.nombre, r.ubicacion_id
         ) q
        GROUP BY q.item_id, q.nombre
       HAVING MAX(q.recuentos) <= 1
        ORDER BY q.nombre ASC`,
      params,
    );

    const breve = (f: ConteoRow): ItemBreve => ({
      itemId: f.item_id,
      nombre: f.nombre,
    });
    const nunca = filas.filter((f) => f.recuentos === 0).map(breve);
    const unaVez = filas.filter((f) => f.recuentos === 1).map(breve);

    return {
      nuncaContado: { total: nunca.length, items: nunca },
      contadoUnaSolaVez: { total: unaVez.length, items: unaVez },
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
