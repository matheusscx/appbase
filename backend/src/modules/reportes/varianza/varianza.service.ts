import { Injectable } from '@nestjs/common';
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
 * Una fila con **menos de dos** recuentos aplicados en el rango no se puede
 * medir: sin dos bordes no hay ventana. Aparece igual —alguien contó ese
 * producto y merece saber que no alcanza— pero con todos los números en `null`,
 * que es la diferencia entre *"no se perdió nada"* y *"todavía no se puede
 * medir"*.
 */
function mapGrupo(r: GrupoRow): VarianzaFila {
  const medible = r.recuentos >= 2;

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
    teorico: null,
    merma: null,
    cortesia: null,
    sinExplicacion: null,
    otros: null,
    costoSinExplicacion: [],
    faltaCosto: false,
  };
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

    return {
      data: rows.map((r) => mapGrupo(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
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
