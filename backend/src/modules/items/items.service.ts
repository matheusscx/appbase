import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import { ESCALA_COSTO } from '../../common/constants/escalas';
import { NivelRegla } from '../../common/enums/reglas.enums';
import { Item } from './entities/item.entity';
import { ItemServicio } from './entities/item-servicio.entity';
import {
  CreateItemDto,
  RecetaIngredienteInputDto,
  RecetaExtraInputDto,
  ComboComponenteInputDto,
  ItemGrupoModificadorInputDto,
  ItemGrupoOpcionOverrideInputDto,
} from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { AjusteStockDto } from './dto/ajuste-stock.dto';
import { QueryItemsDto } from './dto/query-items.dto';
import { InventarioService } from '../inventario/inventario.service';
import { CatalogService } from '../catalog/catalog.service';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';
import {
  assertCostoNoColapsaACero,
  convertirCostoUnitario,
} from '../../common/utils/costo-conversion-unidad.util';
import { unwrap } from '../../common/utils/pg-returning.util';
import {
  PersonalizacionRecetaDto,
  PersonalizacionGrupoInputDto,
  type PersonalizacionRecetaSnapshot,
  type SnapshotGrupo,
} from '../../common/dto/personalizacion-receta.dto';

interface ItemRow {
  item_id: string;
  nombre: string;
  descripcion: string | null;
  tipo: string;
  activo: boolean;
  clasificacion_tributaria: string | null;
  precio_base: string;
  precio_incluye_impuesto: boolean;
  moneda_id: string;
  moneda_codigo: string;
  moneda_simbolo: string | null;
  categoria_id: string | null;
  categoria_nombre: string | null;
  creado_el: Date;
  stock: string | null;
  unidad_medida: string | null;
  fecha_elaboracion: Date | null;
  fecha_vencimiento: Date | null;
  modo_inventario: string | null;
  costo_actual: string | null;
  duracion_estimada: number | null;
  requiere_cita: boolean | null;
  frecuencia: string | null;
}

type GrupoDetalle = {
  grupoModificadorId: string;
  nombre: string;
  min: number;
  max: number;
  orden: number;
  opciones: {
    grupoOpcionId: string;
    itemId: string;
    itemNombre: string;
    tipo: string;
    cantidad: string | null;
    cantidadDefault: string | null;
    unidadCodigo: string | null;
    precioExtra: string;
    orden: number;
    stock: string | null;
    /** `stock` menos lo que las cuentas abiertas ya apartaron. Ver `findOne`. */
    stockDisponible: string | null;
    esPendiente: boolean;
  }[];
};

/**
 * Lo que de una fila con stock propio **todavía se puede pedir**: su `stock`
 * físico menos lo que las cuentas abiertas del tenant ya apartaron.
 *
 * Existe porque `GET /items/:id` devuelve `ip.stock` pelado en cuatro lugares
 * anidados —ingredientes de la receta, extras permitidos, componentes del combo
 * y opciones de grupo— y el drawer de personalización decidía "sin stock" con
 * ese número, o sea ofrecía lo que otra mesa ya se había llevado y recién lo
 * rechazaba al confirmar. La grilla del catálogo ya leía el descontado
 * (`calcularDisponibilidadBatch`); esto le da a las cuatro el mismo criterio en
 * un solo lugar, para que no puedan discrepar.
 *
 * `stock === null` (el ítem no lleva stock: un servicio como opción de grupo)
 * sale `null`, no `0`: la ausencia de stock no es falta de stock.
 *
 * `toFixed(4)` y no la escala de la moneda: es una CANTIDAD en la escala del
 * kardex (`numeric(18,4)`), la misma en la que viaja `stock`, para que las dos
 * se puedan comparar sin reformatear. Y **puede dar negativo**, igual que el
 * `stockDisponible` de `GET /items`: lo no bloqueante suma al comprometido sin
 * frenar al pedir (spec § 4.2), así que clamplear a 0 escondería justo el caso
 * que el encargado necesita ver.
 */
function disponibleDe(
  comprometido: Map<string, Decimal>,
  itemId: string,
  stock: string | null,
): string | null {
  if (stock === null) return null;
  return new Decimal(stock).minus(comprometido.get(itemId) ?? 0).toFixed(4);
}

export interface IngredienteReceta {
  ingredienteItemId: string;
  ingredienteNombre: string;
  ingredienteUnidadMedida: string;
  cantidad: string;
  unidadCodigo: string;
  bloqueante: boolean;
}

export interface ExtraPermitido {
  ingredienteItemId: string;
  ingredienteNombre: string;
  ingredienteUnidadMedida: string;
  cantidad: string;
  unidadCodigo: string;
  precioExtra: string;
}

export interface ComponenteCombo {
  componente_item_id: string;
  nombre: string;
  cantidad: string;
}

/**
 * Los catálogos que `resolverPersonalizacionReceta`/`…Combo` leerían por su
 * cuenta, precargados por lote para varias líneas. Ver
 * `cargarCatalogosPersonalizacion`.
 */
export interface CatalogosPersonalizacion {
  ingredientes: Map<string, IngredienteReceta[]>;
  extras: Map<string, ExtraPermitido[]>;
  grupos: Map<string, CatalogoGrupos>;
  componentesCombo: Map<string, ComponenteCombo[]>;
}

/**
 * Catálogo de grupos de modificadores de UN item: qué grupos tiene asociados y
 * qué opciones ofrece cada uno, con el override por `item_grupo_id` ya aplicado.
 * Es lo único que `resolverGruposDeItem` necesita leer de la base, y por eso se
 * puede precargar por lote: un combo resuelve la misma elección para cada unidad
 * de cada componente, y sin esto releía el catálogo entero una vez por unidad.
 */
interface CatalogoGrupos {
  asociados: {
    grupo_modificador_id: string;
    item_grupo_id: string;
    nombre: string;
    min: number;
    max: number;
  }[];
  opcionesPorGrupo: Map<
    string,
    {
      grupo_modificador_id: string;
      item_id: string;
      nombre: string;
      cantidad: string | null;
      unidad_codigo: string | null;
      precio_extra: string;
    }[]
  >;
}

export interface DesfaseInsumoDto {
  itemId: string;
  nombre: string;
  costoActual: string | null;
}

export interface DesfaseItemDto {
  itemId: string;
  tipo: 'receta' | 'combo';
  nombre: string;
  costoActual: string;
  costoPropuesto: string;
  deltaCosto: string;
  precioBase: string;
  margenPctActual: string | null;
  margenPctPropuesto: string | null;
  precioSugerido: string | null;
  afectados: DesfaseInsumoDto[];
}

/**
 * Conversor de unidades con el catálogo ya cargado
 * (`CatalogService.crearConversor`). Se pasa por parámetro para que el catálogo
 * se lea UNA vez por operación en vez de una por iteración; la conversión sigue
 * ocurriendo en el mismo punto del loop, así que no mueve ningún error de lugar
 * ni cambia cuál se lanza primero.
 */
export type ConvertirUnidad = (
  cantidad: string,
  desde: string,
  hacia: string,
) => string;

/**
 * Una línea ya pedida, tal como la mira `consumoDeLineas`: qué se pidió, cuánto
 * y con qué personalización. **Nunca cuánto vale** — el precio no es asunto de
 * esta pregunta.
 *
 * `cantidad` va en la unidad base del ítem (la `cantidadCanonica` que resuelve
 * `ventas.service.ts` antes de tocar stock), no en la de presentación.
 */
export interface LineaConsumo {
  itemId: string;
  cantidad: string;
  personalizacion: PersonalizacionRecetaSnapshot | null;
}

/**
 * Lo que un conjunto de líneas consume de UN ingrediente o producto, en la
 * unidad de stock de ese ítem.
 *
 * **Son DOS cantidades y no una cantidad + un flag, y esa es la corrección de
 * la revisión final de rama (2026-09-02).** El mismo `itemId` puede entrar por
 * caminos con distinto `bloqueante` —el caso canónico: "extra queso" sobre una
 * receta que YA lleva queso, que `expandirIngredientesPersonalizados` devuelve
 * dos veces, la base con su flag real y el extra siempre en `false`—, y
 * mientras hubo un solo flag por ítem se mergeaba con AND: una sola ocurrencia
 * no bloqueante apagaba el tope para TODO el consumo del ítem, la base
 * incluida. La venta, en cambio, enforcea **por ocurrencia**
 * (`venderIngredientesReceta` procesa la entrada base y esa sí frena), así que
 * el pedido entraba con `201`, se despachaba, y reventaba al cobrar con "Stock
 * insuficiente para la salida" dejando la mesa trabada — el bug que este frente
 * vino a eliminar, reintroducido por el camino que lo cierra.
 *
 * - `cantidad` — el total. Es lo que OCUPA, y lo que lee `comprometidoPorItem`:
 *   lo no bloqueante también aparta (spec § 4.2, decisión 4 del owner).
 * - `cantidadBloqueante` — solo las ocurrencias que frenan. Es lo que TOPEA, y
 *   lo único que mira `validarStockAlPedir`.
 *
 * `nombre` existe para que el rechazo al pedir pueda decir **qué** faltó
 * (`validarStockAlPedir`): "no hay stock" manda al garzón a adivinar cuál de
 * los seis ingredientes del plato es el que falta. Sale de las mismas
 * consultas que ya hace la expansión —ninguna consulta de más—, y por eso es
 * el nombre del ítem **consumido**, no el del plato que lo pidió.
 */
export interface ConsumoDeItem {
  cantidad: Decimal;
  cantidadBloqueante: Decimal;
  nombre: string;
}

/**
 * Clases de uso que devuelve `GET /items/:id/uso`.
 *
 * ⚠️ Duplicado a mano en el frontend (`pages/configuracion/items.vue`, tipo
 * `UsoItemTipoBloqueante` + el mapa `ETIQUETA_USO`), sin enlace de compilación
 * entre los dos lados: agregar una clase acá y no allá renderiza la viñeta con
 * la etiqueta vacía en vez de romper el build. Al tocar esta unión, tocar
 * también el `.vue`. La partición es parte del contrato: `'extra'` siempre cae
 * en `advertencias` y nunca en `bloqueos`.
 */
export type UsoItemTipo =
  | 'ingrediente'
  | 'combo'
  | 'opcion'
  | 'cuenta'
  | 'extra';

export interface UsoItemRef {
  tipo: UsoItemTipo;
  nombre: string;
}

export interface UsoItem {
  bloqueos: UsoItemRef[];
  advertencias: UsoItemRef[];
}

@Injectable()
export class ItemsService {
  constructor(
    @InjectRepository(Item)
    private readonly itemRepo: Repository<Item>,
    @InjectRepository(ItemServicio)
    private readonly itemServicioRepo: Repository<ItemServicio>,
    private readonly db: Db,
    private readonly inventarioService: InventarioService,
    private readonly catalogService: CatalogService,
  ) {}

  private readonly BASE_QUERY = `
    SELECT
      i.item_id, i.nombre, i.descripcion, i.tipo, i.activo,
      i.precio_base, i.precio_incluye_impuesto,
      i.clasificacion_tributaria,
      i.moneda_id, i.categoria_id, i.creado_el,
      m.codigo_iso AS moneda_codigo, m.simbolo AS moneda_simbolo,
      c.nombre AS categoria_nombre,
      ip.stock, ip.unidad_medida, ip.fecha_elaboracion, ip.fecha_vencimiento,
      ip.modo_inventario,
      COALESCE(ip.costo_actual, ir.costo_actual, icb.costo_actual) AS costo_actual,
      isr.duracion_estimada, isr.requiere_cita,
      isu.frecuencia
    FROM items i
    LEFT JOIN moneda m ON m.moneda_id = i.moneda_id AND m.eliminado_el IS NULL
    LEFT JOIN categorias c ON c.categoria_id = i.categoria_id AND c.eliminado_el IS NULL
    LEFT JOIN item_producto ip ON ip.item_id = i.item_id
    LEFT JOIN item_servicio isr ON isr.item_id = i.item_id
    LEFT JOIN item_suscripcion isu ON isu.item_id = i.item_id
    LEFT JOIN item_receta ir ON ir.item_id = i.item_id
    LEFT JOIN item_combo icb ON icb.item_id = i.item_id
  `;

  private mapRow(r: ItemRow) {
    return {
      id: r.item_id,
      nombre: r.nombre,
      descripcion: r.descripcion,
      tipo: r.tipo,
      activo: r.activo,
      precioBase: r.precio_base,
      precioIncluyeImpuesto: r.precio_incluye_impuesto,
      clasificacionTributaria: r.clasificacion_tributaria,
      monedaId: r.moneda_id,
      monedaCodigo: r.moneda_codigo,
      monedaSimbolo: r.moneda_simbolo,
      categoriaId: r.categoria_id,
      categoriaNombre: r.categoria_nombre,
      creadoEl: r.creado_el,
      stock: r.stock,
      unidadMedida: r.unidad_medida,
      fechaElaboracion: r.fecha_elaboracion,
      fechaVencimiento: r.fecha_vencimiento,
      modoInventario: r.modo_inventario,
      costoActual: r.costo_actual,
      duracionEstimada: r.duracion_estimada,
      requiereCita: r.requiere_cita,
      frecuencia: r.frecuencia,
    };
  }

  private buildFindAllFilters(
    tenantId: string,
    query: QueryItemsDto,
  ): { where: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let idx = 2;
    // Papelera: `incluirEliminados` trae vivos Y borrados en el mismo
    // listado (igual que categorías/causas de merma); sin el flag, el
    // filtro de siempre. Entre los borrados, solo los que borró una
    // persona: `eliminado_por IS NULL` es un borrado del sistema (seeder,
    // `remapImpuestosOficialesDuplicados`), no restaurable ni visible —
    // decisión del owner, ver docs/features/papelera.md.
    let where = query.incluirEliminados
      ? ` WHERE i.tenant_id = $1 AND (i.eliminado_el IS NULL OR i.eliminado_por IS NOT NULL)`
      : ` WHERE i.tenant_id = $1 AND i.eliminado_el IS NULL`;

    if (query.tipo) {
      where += ` AND i.tipo = $${idx++}`;
      params.push(query.tipo);
    }
    if (query.categoriaId) {
      where += ` AND i.categoria_id = $${idx++}`;
      params.push(query.categoriaId);
    }
    if (query.search) {
      where += ` AND (i.nombre ILIKE $${idx} OR i.descripcion ILIKE $${idx})`;
      params.push(`%${query.search}%`);
      idx++;
    }
    // ⚠️ `!== undefined`, no un `if (query.activo)`: `false` es un filtro
    // válido —"mostrame los pausados"— y con la forma corta sería
    // indistinguible de no filtrar.
    //
    // Las cuatro pantallas de venta piden `activo=true`. Antes traían todo y
    // descartaban los pausados en el cliente, lo que no era equivalente: el
    // pausado igual ocupaba uno de los `pageSize` lugares pedidos, así que en
    // un catálogo grande cada ítem pausado empujaba fuera del POS a uno
    // vendible.
    if (query.activo !== undefined) {
      where += ` AND i.activo = $${idx++}`;
      params.push(query.activo);
    }
    // Regla 5 de docs/superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md:
    // vista de conjunto de los ítems sin costo. Este `where` alimenta DOS
    // queries (el COUNT sin JOIN de `findAll` y el `BASE_QUERY` con los LEFT
    // JOIN de ip/ir/icb) — no puede referenciar esos alias directamente o
    // rompe el COUNT con `42P01`. Subconsultas correlacionadas por `i.item_id`
    // en su lugar, sobre las MISMAS tres tablas que arma
    // `COALESCE(ip.costo_actual, ir.costo_actual, icb.costo_actual)` en
    // `BASE_QUERY` (arriba), para que el filtro signifique exactamente lo
    // mismo que la columna `costoActual` que muestra la fila. Ninguna de las
    // tres tiene `eliminado_el` (el borrado vive en `items`, ya filtrado
    // arriba), así que no se les agrega ese filtro.
    if (query.sinCosto) {
      where += ` AND i.tipo IN ('producto','ingrediente')
                 AND COALESCE(
                       (SELECT ip2.costo_actual  FROM item_producto ip2  WHERE ip2.item_id = i.item_id),
                       (SELECT ir2.costo_actual  FROM item_receta   ir2  WHERE ir2.item_id = i.item_id),
                       (SELECT icb2.costo_actual FROM item_combo    icb2 WHERE icb2.item_id = i.item_id)
                     ) IS NULL`;
    }

    return { where, params };
  }

  async findAll(
    tenantId: string,
    query: QueryItemsDto,
  ): Promise<
    PaginatedResponse<
      ReturnType<typeof this.mapRow> & {
        /**
         * Receta y combo: **cuántas porciones se pueden armar** (entero), ya
         * descontado lo que las cuentas abiertas comprometieron. `null` para
         * todo lo demás — no cambió de significado ni de tipo.
         */
        disponible: number | null;
        /**
         * Producto e ingrediente: **cuánto queda por pedir**, en la unidad y la
         * escala de `stock` (string, 4 decimales). `null` para todo lo demás.
         *
         * Campo propio y no un valor más dentro de `disponible` (decisión del
         * owner, 2026-09-01): son dos preguntas distintas —"cuántas porciones
         * armo" es un conteo entero, "cuánto queda" es una cantidad que puede
         * ser 1,5 kg— y meterlas en un mismo nombre las confunde. String y no
         * `number` porque es una cantidad, y una cantidad no viaja en un float
         * (el frontend además hace `.floor()` sobre `disponible`, que dejaría
         * 1,5 kg en 1).
         */
        stockDisponible: string | null;
        // Solo se completan con `incluirEliminados`: el listado normal no
        // trae estas columnas, así que el tipo las deja opcionales en vez de
        // forzar `null` en cada fila de la ruta de siempre.
        eliminadoEl?: string | null;
        eliminadoPor?: string | null;
        eliminadoPorNombre?: string | null;
      }
    >
  > {
    const { page, pageSize, offset } = resolvePagination(query);
    const { where, params } = this.buildFindAllFilters(tenantId, query);

    const countRows: { total: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total FROM items i${where}`,
      params,
    );
    const total = countRows[0]?.total ?? 0;

    const listParams = [...params, pageSize, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows: ItemRow[] = await this.db.query(
      this.BASE_QUERY +
        where +
        ` ORDER BY i.nombre ASC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );

    // Los combo ids con grupos se cargan de una sola vez para no disparar
    // N queries extra (una por combo) al calcular disponibleCondicional.
    let comboIdsConGrupos = new Set<string>();
    if (rows.some((r) => r.tipo === 'combo')) {
      const grupoItemRows: { item_id: string }[] = await this.db.query(
        `SELECT DISTINCT item_id FROM item_grupos_modificadores
         WHERE tenant_id = $1 AND eliminado_el IS NULL
         UNION
         SELECT DISTINCT cc.combo_item_id AS item_id
         FROM combo_componentes cc
         JOIN item_grupos_modificadores igm ON igm.item_id = cc.componente_item_id
           AND igm.tenant_id = cc.tenant_id AND igm.eliminado_el IS NULL
         WHERE cc.tenant_id = $1 AND cc.eliminado_el IS NULL`,
        [tenantId],
      );
      comboIdsConGrupos = new Set(grupoItemRows.map((r) => r.item_id));
    }

    // Disponibilidad de recetas/combos/productos en un nº CONSTANTE de queries
    // (batch), no una por fila (N+1).
    const recetaIds = rows
      .filter((r) => r.tipo === 'receta')
      .map((r) => r.item_id);
    const comboIds = rows
      .filter((r) => r.tipo === 'combo')
      .map((r) => r.item_id);
    // `producto` e `ingrediente` son los dos tipos con fila en `item_producto`,
    // o sea los dos que tienen stock propio del que descontar. El `stock` ya
    // viene en la fila (`BASE_QUERY`), así que sumarlos al batch no cuesta una
    // query más.
    const productos = rows
      .filter((r) => r.tipo === 'producto' || r.tipo === 'ingrediente')
      .map((r) => ({ itemId: r.item_id, stock: r.stock }));
    const { disponible: dispPorId, stockDisponible: stockDispPorId } =
      await this.calcularDisponibilidadBatch(
        tenantId,
        recetaIds,
        comboIds,
        productos,
      );

    // Papelera: nombre de quien borró por JOIN en UNA query batch acotada a
    // los ids de esta página (no N+1). Sin filtrar el `eliminado_el` de
    // `usuarios` a propósito: el autor de un borrado es un hecho histórico
    // que no debe desaparecer solo porque ese usuario se dio de baja después
    // (docs/patterns/backend.md, mismo criterio que categorias.service.ts).
    let auditoriaPorId = new Map<
      string,
      {
        eliminado_el: string | null;
        eliminado_por: string | null;
        eliminado_por_nombre: string | null;
      }
    >();
    if (query.incluirEliminados && rows.length) {
      const auditRows: {
        item_id: string;
        eliminado_el: string | null;
        eliminado_por: string | null;
        eliminado_por_nombre: string | null;
      }[] = await this.db.query(
        `SELECT i.item_id, i.eliminado_el, i.eliminado_por,
                u.nombre_usuario AS eliminado_por_nombre
           FROM items i
           LEFT JOIN usuarios u ON u.usuario_id = i.eliminado_por
          WHERE i.item_id = ANY($1) AND i.tenant_id = $2`,
        [rows.map((r) => r.item_id), tenantId],
      );
      auditoriaPorId = new Map(auditRows.map((a) => [a.item_id, a]));
    }

    const data = rows.map((r) => {
      const base = this.mapRow(r);
      // Sin ramificar por tipo acá: cada `Map` trae clave solo para los tipos
      // que le corresponden (porciones para receta/combo, cantidad para
      // producto/ingrediente), así que un servicio o una suscripción no está en
      // ninguno de los dos y sigue dando `null` en ambos.
      const disponible = dispPorId.get(base.id) ?? null;
      const stockDisponible = stockDispPorId.get(base.id) ?? null;
      const disponibleCondicional =
        base.tipo === 'combo' && comboIdsConGrupos.has(base.id);
      if (!query.incluirEliminados) {
        return { ...base, disponible, stockDisponible, disponibleCondicional };
      }
      const audit = auditoriaPorId.get(r.item_id);
      return {
        ...base,
        disponible,
        stockDisponible,
        disponibleCondicional,
        eliminadoEl: audit?.eliminado_el ?? null,
        eliminadoPor: audit?.eliminado_por ?? null,
        eliminadoPorNombre: audit?.eliminado_por_nombre ?? null,
      };
    });

    return {
      data,
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  /**
   * Carga los grupos de modificadores (con opciones y override efectivo) de un
   * conjunto de items, en un nº constante de queries (batch, sin N+1). Devuelve
   * un Map itemId → grupos con la MISMA forma que el `grupos[]` de findOne.
   *
   * `comprometido` viene de afuera —lo calcula `findOne` una sola vez para toda
   * la respuesta— y no se consulta acá: esta función corre dos veces por ítem
   * (los grupos del combo y los de cada componente receta), así que pedirlo
   * adentro duplicaría la consulta sin cambiar el resultado.
   */
  private async cargarGruposPorItem(
    tenantId: string,
    itemIds: string[],
    comprometido: Map<string, Decimal>,
  ): Promise<Map<string, GrupoDetalle[]>> {
    const out = new Map<string, GrupoDetalle[]>();
    if (!itemIds.length) return out;

    const asoc: {
      item_id: string;
      grupo_modificador_id: string;
      item_grupo_id: string;
      nombre: string;
      min: number;
      max: number;
      orden: number;
    }[] = await this.db.query(
      `SELECT igm.item_id, igm.grupo_modificador_id, igm.item_grupo_id,
              g.nombre, igm.min, igm.max, igm.orden
       FROM item_grupos_modificadores igm
       JOIN grupos_modificadores g ON g.grupo_modificador_id = igm.grupo_modificador_id
         AND g.eliminado_el IS NULL
       WHERE igm.item_id = ANY($1) AND igm.tenant_id = $2 AND igm.eliminado_el IS NULL
       ORDER BY igm.orden ASC`,
      [itemIds, tenantId],
    );
    if (!asoc.length) return out;

    const itemGrupoIds = asoc.map((a) => a.item_grupo_id);
    const ops: {
      item_grupo_id: string;
      grupo_opcion_id: string;
      item_id: string;
      item_nombre: string;
      tipo: string;
      cantidad_efectiva: string | null;
      cantidad_default: string | null;
      unidad_codigo: string | null;
      precio_extra: string;
      orden: number;
      stock: string | null;
    }[] = await this.db.query(
      `SELECT igm.item_grupo_id, o.grupo_opcion_id, o.item_id, i.nombre AS item_nombre, i.tipo,
              COALESCE(ovr.cantidad, o.cantidad) AS cantidad_efectiva,
              o.cantidad AS cantidad_default,
              COALESCE(ovr.unidad_codigo, o.unidad_codigo) AS unidad_codigo,
              COALESCE(ovr.precio_extra, o.precio_extra) AS precio_extra,
              o.orden, ip.stock
       FROM item_grupos_modificadores igm
       JOIN grupo_modificador_opciones o ON o.grupo_modificador_id = igm.grupo_modificador_id
         AND o.tenant_id = igm.tenant_id AND o.eliminado_el IS NULL
       JOIN items i ON i.item_id = o.item_id AND i.eliminado_el IS NULL
       LEFT JOIN item_producto ip ON ip.item_id = o.item_id
       LEFT JOIN item_grupo_modificador_opciones ovr
         ON ovr.grupo_opcion_id = o.grupo_opcion_id
        AND ovr.item_grupo_id = igm.item_grupo_id
        AND ovr.eliminado_el IS NULL
       WHERE igm.item_grupo_id = ANY($1) AND igm.tenant_id = $2 AND igm.eliminado_el IS NULL
       ORDER BY o.orden ASC`,
      [itemGrupoIds, tenantId],
    );
    const opsPorItemGrupo = new Map<string, typeof ops>();
    for (const o of ops) {
      const arr = opsPorItemGrupo.get(o.item_grupo_id) ?? [];
      arr.push(o);
      opsPorItemGrupo.set(o.item_grupo_id, arr);
    }

    for (const a of asoc) {
      const arr = out.get(a.item_id) ?? [];
      arr.push({
        grupoModificadorId: a.grupo_modificador_id,
        nombre: a.nombre,
        min: a.min,
        max: a.max,
        orden: a.orden,
        opciones: (opsPorItemGrupo.get(a.item_grupo_id) ?? []).map((r) => ({
          grupoOpcionId: r.grupo_opcion_id,
          itemId: r.item_id,
          itemNombre: r.item_nombre,
          tipo: r.tipo,
          cantidad: r.cantidad_efectiva,
          cantidadDefault: r.cantidad_default,
          unidadCodigo: r.unidad_codigo,
          precioExtra: r.precio_extra,
          orden: r.orden,
          stock: r.stock,
          stockDisponible: disponibleDe(comprometido, r.item_id, r.stock),
          esPendiente: r.cantidad_efectiva == null,
        })),
      });
      out.set(a.item_id, arr);
    }
    return out;
  }

  /**
   * Fila base de varios ítems en UNA sola query, indexada por `itemId`.
   *
   * Existe para el camino caliente del POS: `crearEnTransaccion` necesita solo
   * `tipo`, `nombre`, `precioBase`, `monedaId`, `unidadMedida` y
   * `clasificacionTributaria` de cada línea del carrito — nada de impuestos,
   * recargos, descuentos, ingredientes, componentes ni grupos. Resolverlo con
   * `findOne` por línea disparaba 4+ queries por ítem para construir colecciones
   * que la venta descarta.
   *
   * Lanza `NotFoundException` si algún id no existe o no es del tenant, igual
   * que `findOne`, para no cambiar el comportamiento de sus llamadores.
   */
  async cargarBasePorIds(
    tenantId: string,
    itemIds: string[],
  ): Promise<Map<string, ReturnType<ItemsService['mapRow']>>> {
    const unicos = [...new Set(itemIds.map((id) => id.toLowerCase()))];
    if (unicos.length === 0) return new Map();

    const rows: ItemRow[] = await this.db.query(
      this.BASE_QUERY +
        ` WHERE i.item_id = ANY($1::uuid[]) AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
      [unicos, tenantId],
    );

    const porId = new Map(rows.map((r) => [r.item_id, this.mapRow(r)]));
    const faltante = unicos.find((id) => !porId.has(id));
    if (faltante) throw new NotFoundException('Item no encontrado');
    return this.aliasarCasingDeIds(porId, itemIds);
  }

  /**
   * Alias de casing para los mapas indexados por `itemId`.
   *
   * `@IsUUID('4')` acepta el UUID en mayúsculas y Postgres castea igual, pero la
   * BD lo devuelve en su forma canónica minúscula. Los mapas se arman con lo que
   * devuelve la BD, así que un id en mayúsculas no los encontraba: daba
   * `404 Item no encontrado` en los tres call sites que batchean (venta,
   * `/calculo-precios/calcular` y checkout online).
   *
   * ⛔ Arreglar solo el 404 de `cargarBasePorIds` habría dejado algo PEOR que el
   * 404: con la fila base encontrada, `cargarReglasPorIds` seguía sin match y sus
   * llamadores hacen `?? []`, así que el ítem se cobraba **sin sus impuestos ni
   * descuentos**, en silencio. Por eso el alias se aplica a los dos mapas.
   *
   * Se indexa por la forma canónica y se agrega el alias con la forma que mandó
   * el cliente, para que el `get(linea.itemId)` de los llamadores siga sirviendo
   * con cualquier casing sin tener que normalizar en cada uno.
   *
   * ⚠️ El precio de eso: cuando el cliente manda mayúsculas, el mapa queda con
   * DOS claves para la misma fila. Estos mapas son **solo para `.get()`** — hoy
   * los tres llamadores hacen exactamente eso. No cuentes ni recorras: `.size`,
   * `for…of`, `.values()` u `Object.fromEntries` verían la fila duplicada. Si
   * hace falta iterarlos, filtrá por la forma canónica.
   */
  private aliasarCasingDeIds<T>(
    mapa: Map<string, T>,
    itemIds: string[],
  ): Map<string, T> {
    for (const id of itemIds) {
      const canonico = id.toLowerCase();
      if (id === canonico) continue;
      const entrada = mapa.get(canonico);
      if (entrada !== undefined) mapa.set(id, entrada);
    }
    return mapa;
  }

  /**
   * Ids de impuestos/descuentos/recargos asociados a varios ítems, en UNA sola
   * query, indexados por `itemId`. Compañero de `cargarBasePorIds` para el
   * camino del motor de precios, que necesita la fila base **y** estas tres
   * listas: resolverlo con `findOne` por línea costaba 4+ queries por ítem para
   * construir además ingredientes, componentes y grupos que el motor descarta.
   *
   * Un ítem sin reglas no aparece en el mapa (el llamador usa `?? []`).
   *
   * **El orden de esta lista ya no decide el total.** Desde el 2026-08-11 el
   * criterio lo impone el motor —`ordenarReglas` en `calculo-precios.engine.ts`
   * pone los porcentajes antes que los montos fijos, decisión del owner— y no
   * el `ORDER BY` de acá. Se hizo ahí a propósito: esta query es uno de los
   * tres caminos que arman listas de reglas, y una regla de negocio que dependa
   * de que los tres se acuerden del mismo `ORDER BY` es una regla que se rompe
   * sola.
   *
   * El `ORDER BY` de abajo sigue valiendo como **desempate determinista** entre
   * reglas del mismo modo, donde el orden no cambia el total (dos porcentajes
   * componen multiplicativamente, dos fijos suman). El sort del motor es
   * estable, así que lo preserva.
   */
  async cargarReglasPorIds(
    tenantId: string,
    itemIds: string[],
  ): Promise<
    Map<
      string,
      { impuestosIds: string[]; descuentosIds: string[]; recargosIds: string[] }
    >
  > {
    const unicos = [...new Set(itemIds.map((id) => id.toLowerCase()))];
    if (unicos.length === 0) return new Map();

    // El JOIN a `items` acota por tenant además de por id: el llamador ya
    // validó pertenencia con `cargarBasePorIds`, pero las tablas puente no
    // tienen `tenant_id` propio y dejar la lectura sin acotar es la defensa
    // que ya faltó en otros lados de este archivo.
    const rows: { clase: string; item_id: string; regla_id: string }[] =
      await this.db.query(
        `SELECT 'impuesto' AS clase, ii.item_id, ii.impuesto_id AS regla_id
           FROM item_impuestos ii
           JOIN items i ON i.item_id = ii.item_id
            AND i.tenant_id = $2 AND i.eliminado_el IS NULL
          WHERE ii.item_id = ANY($1::uuid[])
         UNION ALL
         SELECT 'descuento', idd.item_id, idd.descuento_id
           FROM item_descuentos idd
           JOIN items i ON i.item_id = idd.item_id
            AND i.tenant_id = $2 AND i.eliminado_el IS NULL
          WHERE idd.item_id = ANY($1::uuid[])
         UNION ALL
         SELECT 'recargo', ir.item_id, ir.recargo_id
           FROM item_recargos ir
           JOIN items i ON i.item_id = ir.item_id
            AND i.tenant_id = $2 AND i.eliminado_el IS NULL
          WHERE ir.item_id = ANY($1::uuid[])
          ORDER BY item_id, clase, regla_id`,
        [unicos, tenantId],
      );

    const porId = new Map<
      string,
      { impuestosIds: string[]; descuentosIds: string[]; recargosIds: string[] }
    >();
    for (const r of rows) {
      let entrada = porId.get(r.item_id);
      if (!entrada) {
        entrada = { impuestosIds: [], descuentosIds: [], recargosIds: [] };
        porId.set(r.item_id, entrada);
      }
      if (r.clase === 'impuesto') entrada.impuestosIds.push(r.regla_id);
      else if (r.clase === 'descuento') entrada.descuentosIds.push(r.regla_id);
      else entrada.recargosIds.push(r.regla_id);
    }
    return this.aliasarCasingDeIds(porId, itemIds);
  }

  async findOne(tenantId: string, itemId: string) {
    const rows: ItemRow[] = await this.db.query(
      this.BASE_QUERY +
        ` WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
      [itemId, tenantId],
    );
    if (!rows.length) throw new NotFoundException('Item no encontrado');

    const impuestosRows: { impuesto_id: string }[] = await this.db.query(
      `SELECT impuesto_id FROM item_impuestos WHERE item_id = $1`,
      [itemId],
    );
    const recargosRows: { recargo_id: string }[] = await this.db.query(
      `SELECT recargo_id FROM item_recargos WHERE item_id = $1`,
      [itemId],
    );
    const descuentosRows: { descuento_id: string }[] = await this.db.query(
      `SELECT descuento_id FROM item_descuentos WHERE item_id = $1`,
      [itemId],
    );

    // Lo que las cuentas abiertas ya apartaron, UNA sola vez para todas las
    // filas anidadas de la respuesta (ingredientes, extras, componentes y
    // opciones de grupo) — **nunca una consulta por fila**. Con el salón vacío
    // es UNA consulta que corta ahí; con cuentas abiertas se suman las de
    // `consumoDeLineas`, que son constantes en la cantidad de líneas (tipos,
    // combos, opciones, ingredientes, extras), no una por línea.
    //
    // Solo la paga `receta` y `combo`: los demás tipos no cargan ninguna fila
    // anidada, así que `disponibleDe` ni llega a correr. ⚠️ Pero la condición
    // es el TIPO, no quién pregunta: el form de edición de
    // `configuracion/items.vue` y el restore de la papelera también la pagan
    // sobre una receta, aunque no lean el número.
    const comprometido =
      rows[0].tipo === 'receta' || rows[0].tipo === 'combo'
        ? await this.comprometidoPorItem(tenantId)
        : new Map<string, Decimal>();

    let ingredientes: {
      ingredienteItemId: string;
      ingredienteNombre: string;
      cantidad: string;
      unidadCodigo: string;
      bloqueante: boolean;
      stock: string;
      stockDisponible: string | null;
    }[] = [];
    let extrasPermitidos: {
      ingredienteItemId: string;
      ingredienteNombre: string;
      cantidad: string;
      unidadCodigo: string;
      precioExtra: string;
      stock: string;
      stockDisponible: string | null;
    }[] = [];
    let componentes: {
      componenteItemId: string;
      componenteNombre: string;
      tipo: string;
      cantidad: string;
      bloqueante: boolean;
      stock: string | null;
      stockDisponible: string | null;
      grupos: GrupoDetalle[];
    }[] = [];
    if (rows[0].tipo === 'receta') {
      const ingRows: {
        ingrediente_item_id: string;
        ingrediente_nombre: string;
        cantidad: string;
        unidad_codigo: string;
        bloqueante: boolean;
        stock: string;
      }[] = await this.db.query(
        `SELECT ri.ingrediente_item_id, i.nombre AS ingrediente_nombre,
                ri.cantidad, ri.unidad_codigo, ri.bloqueante, ip.stock
         FROM receta_ingredientes ri
         JOIN items i ON i.item_id = ri.ingrediente_item_id AND i.eliminado_el IS NULL
         JOIN item_producto ip ON ip.item_id = ri.ingrediente_item_id
         WHERE ri.receta_item_id = $1 AND ri.tenant_id = $2 AND ri.eliminado_el IS NULL`,
        [itemId, tenantId],
      );
      ingredientes = ingRows.map((r) => ({
        ingredienteItemId: r.ingrediente_item_id,
        ingredienteNombre: r.ingrediente_nombre,
        cantidad: r.cantidad,
        unidadCodigo: r.unidad_codigo,
        bloqueante: r.bloqueante,
        stock: r.stock,
        stockDisponible: disponibleDe(
          comprometido,
          r.ingrediente_item_id,
          r.stock,
        ),
      }));

      const extraRows: {
        ingrediente_item_id: string;
        ingrediente_nombre: string;
        cantidad: string;
        unidad_codigo: string;
        precio_extra: string;
        stock: string;
      }[] = await this.db.query(
        `SELECT re.ingrediente_item_id, i.nombre AS ingrediente_nombre,
                re.cantidad, re.unidad_codigo, re.precio_extra, ip.stock
         FROM receta_extras_permitidos re
         JOIN items i ON i.item_id = re.ingrediente_item_id AND i.eliminado_el IS NULL
         JOIN item_producto ip ON ip.item_id = re.ingrediente_item_id
         WHERE re.receta_item_id = $1 AND re.tenant_id = $2 AND re.eliminado_el IS NULL`,
        [itemId, tenantId],
      );
      extrasPermitidos = extraRows.map((r) => ({
        ingredienteItemId: r.ingrediente_item_id,
        ingredienteNombre: r.ingrediente_nombre,
        cantidad: r.cantidad,
        unidadCodigo: r.unidad_codigo,
        precioExtra: r.precio_extra,
        stock: r.stock,
        stockDisponible: disponibleDe(
          comprometido,
          r.ingrediente_item_id,
          r.stock,
        ),
      }));
    }

    if (rows[0].tipo === 'combo') {
      const compRows: {
        componente_item_id: string;
        componente_nombre: string;
        tipo: string;
        cantidad: string;
        bloqueante: boolean;
        stock: string | null;
      }[] = await this.db.query(
        `SELECT cc.componente_item_id, i.nombre AS componente_nombre, i.tipo,
                cc.cantidad, cc.bloqueante, ip.stock
         FROM combo_componentes cc
         JOIN items i ON i.item_id = cc.componente_item_id AND i.eliminado_el IS NULL
         LEFT JOIN item_producto ip ON ip.item_id = cc.componente_item_id
         WHERE cc.combo_item_id = $1 AND cc.tenant_id = $2 AND cc.eliminado_el IS NULL`,
        [itemId, tenantId],
      );
      const gruposPorComp = await this.cargarGruposPorItem(
        tenantId,
        compRows
          .filter((r) => r.tipo === 'receta')
          .map((r) => r.componente_item_id),
        comprometido,
      );
      componentes = compRows.map((r) => ({
        componenteItemId: r.componente_item_id,
        componenteNombre: r.componente_nombre,
        tipo: r.tipo,
        cantidad: r.cantidad,
        bloqueante: r.bloqueante,
        stock: r.stock,
        stockDisponible: disponibleDe(
          comprometido,
          r.componente_item_id,
          r.stock,
        ),
        grupos: gruposPorComp.get(r.componente_item_id) ?? [],
      }));
    }

    // Los grupos del propio ítem salen de la misma función batcheada que ya se
    // usa arriba para los componentes de un combo: 2 queries fijas en vez de 1
    // por los grupos + 1 de opciones POR CADA grupo. Con `[]` no consulta nada,
    // así que un ítem sin grupos sigue costando cero.
    const grupos: GrupoDetalle[] =
      rows[0].tipo === 'combo' || rows[0].tipo === 'receta'
        ? ((
            await this.cargarGruposPorItem(tenantId, [itemId], comprometido)
          ).get(itemId) ?? [])
        : [];

    return {
      ...this.mapRow(rows[0]),
      impuestosIds: impuestosRows.map((r) => r.impuesto_id),
      recargosIds: recargosRows.map((r) => r.recargo_id),
      descuentosIds: descuentosRows.map((r) => r.descuento_id),
      ingredientes,
      extrasPermitidos,
      componentes,
      grupos,
      disponibleCondicional:
        rows[0].tipo === 'combo' &&
        (grupos.length > 0 ||
          componentes.some((c) => (c.grupos?.length ?? 0) > 0)),
    };
  }

  async create(tenantId: string, usuarioId: string, dto: CreateItemDto) {
    if (dto.tipo === 'suscripcion' && !dto.frecuencia) {
      throw new BadRequestException(
        'Los items de suscripción requieren frecuencia',
      );
    }
    if (dto.tipo !== 'suscripcion' && dto.frecuencia) {
      throw new BadRequestException(
        'La frecuencia solo aplica a items de suscripción',
      );
    }
    if (dto.tipo === 'receta' && !dto.ingredientes?.length) {
      throw new BadRequestException(
        'Las recetas requieren al menos un ingrediente',
      );
    }
    if (
      dto.tipo === 'combo' &&
      !dto.componentes?.length &&
      !dto.gruposModificadores?.length
    ) {
      throw new BadRequestException(
        'Los combos requieren al menos un componente o un grupo de modificadores',
      );
    }
    if (dto.tipo === 'ingrediente') {
      if (dto.clasificacionTributaria !== undefined) {
        throw new BadRequestException(
          'Un ingrediente no tiene clasificación tributaria: no se vende',
        );
      }
      if (
        dto.impuestosIds?.length ||
        dto.recargosIds?.length ||
        dto.descuentosIds?.length
      ) {
        throw new BadRequestException(
          'Los ingredientes no admiten impuestos, recargos ni descuentos',
        );
      }
      if (dto.series?.length || dto.lote) {
        throw new BadRequestException(
          'Los ingredientes solo admiten modo de inventario "cantidad"',
        );
      }
      if (dto.modoInventario && dto.modoInventario !== 'cantidad') {
        throw new BadRequestException(
          'Los ingredientes solo admiten modo de inventario "cantidad"',
        );
      }
    }
    if (dto.costo != null) {
      this.validarCostoNoNegativo(dto.costo);
    }
    // Respuesta armada con RETURNING + valores ya conocidos en la mutación
    // (sin findOne post-write = sin refetch en el servidor).
    return this.db.transaccion(async (manager) => {
      const moneda = await this.validarMoneda(manager, tenantId, dto.monedaId);
      const categoriaNombre = dto.categoriaId
        ? await this.validarCategoria(manager, tenantId, dto.categoriaId)
        : null;
      if (dto.impuestosIds?.length) {
        await this.validarImpuestos(manager, tenantId, dto.impuestosIds);
      }
      if (dto.recargosIds?.length) {
        await this.validarReglas(
          manager,
          tenantId,
          dto.recargosIds,
          'recargos',
          'recargo_id',
        );
      }
      if (dto.descuentosIds?.length) {
        await this.validarReglas(
          manager,
          tenantId,
          dto.descuentosIds,
          'descuentos',
          'descuento_id',
        );
      }

      const precioBasePersistido =
        dto.tipo === 'ingrediente' ? '0' : dto.precioBase;

      const itemRows: {
        item_id: string;
        creado_el: Date;
      }[] = await manager.query(
        `INSERT INTO items
           (tenant_id, moneda_id, categoria_id, nombre, descripcion,
            precio_base, precio_incluye_impuesto, activo, tipo, clasificacion_tributaria)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING item_id, creado_el`,
        [
          tenantId,
          dto.monedaId,
          dto.categoriaId ?? null,
          dto.nombre,
          dto.descripcion ?? null,
          precioBasePersistido,
          dto.precioIncluyeImpuesto ?? false,
          dto.activo ?? true,
          dto.tipo,
          // El `?? 'afecto'` NO es redundante con el `DEFAULT 'afecto'` de la
          // columna, aunque lo parezca: este `INSERT` lista
          // `clasificacion_tributaria` explícitamente en sus columnas, así
          // que el `DEFAULT` de Postgres nunca se activa por este camino —
          // si se omitiera el `?? 'afecto'` y `dto.clasificacionTributaria`
          // llegara `undefined`, se insertaría `NULL` de verdad. El DTO
          // (`create-item.dto.ts`, `@ValidateIf`) ya rechaza un `null`
          // explícito en el payload; este `??` es lo que cubre el caso
          // legítimo de "no lo mandaron" para los tipos que sí se venden.
          // No borrar esta línea "limpiando" el default de la columna: son
          // dos protecciones de caminos distintos.
          dto.tipo === 'ingrediente'
            ? null
            : (dto.clasificacionTributaria ?? 'afecto'),
        ],
      );
      const itemId = itemRows[0].item_id;

      let stock: string | null = null;
      let unidadMedida: string | null = null;
      let fechaElaboracion: string | null = null;
      let fechaVencimiento: string | null = null;
      let modoInventario: string | null = null;
      let costoActual: string | null = null;
      let duracionEstimada: number | null = null;
      let requiereCita: boolean | null = null;
      let frecuencia: string | null = null;
      let ingredientes: {
        ingredienteItemId: string;
        ingredienteNombre: string;
        cantidad: string;
        unidadCodigo: string;
        bloqueante: boolean;
      }[] = [];
      let extrasPermitidos: {
        ingredienteItemId: string;
        ingredienteNombre: string;
        cantidad: string;
        unidadCodigo: string;
        precioExtra: string;
      }[] = [];
      let componentes: {
        componenteItemId: string;
        componenteNombre: string;
        tipo: string;
        cantidad: string;
        bloqueante: boolean;
      }[] = [];

      if (dto.tipo === 'producto' || dto.tipo === 'ingrediente') {
        if (dto.unidadMedida !== undefined) {
          await this.validarUnidadMedida(dto.unidadMedida);
        }

        const modo =
          dto.tipo === 'ingrediente'
            ? 'cantidad'
            : (dto.modoInventario ?? 'cantidad');
        unidadMedida = dto.unidadMedida ?? 'unidad';
        fechaElaboracion =
          dto.tipo === 'ingrediente' ? null : (dto.fechaElaboracion ?? null);
        fechaVencimiento =
          dto.tipo === 'ingrediente' ? null : (dto.fechaVencimiento ?? null);
        modoInventario = modo;
        costoActual = dto.costo ?? null;
        stock = '0';

        await manager.query(
          `INSERT INTO item_producto
             (item_id, stock, unidad_medida, fecha_elaboracion, fecha_vencimiento, modo_inventario, costo_actual)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            itemId,
            '0',
            unidadMedida,
            fechaElaboracion,
            fechaVencimiento,
            modo,
            costoActual,
          ],
        );

        if (modo === 'cantidad') {
          const stockInicial = new Decimal(dto.stock ?? '0');
          if (stockInicial.greaterThan(0)) {
            const mov = await this.inventarioService.registrarMovimiento(
              manager,
              {
                tenantId,
                itemId,
                usuarioId,
                tipo: 'entrada',
                motivo: 'inventario_inicial',
                cantidad: stockInicial.toString(),
                comentario: 'Stock inicial',
              },
            );
            stock = mov.stockResultante;
          }
        } else if (
          dto.tipo === 'producto' &&
          modo === 'serie' &&
          dto.series?.length
        ) {
          const mov = await this.inventarioService.registrarMovimiento(
            manager,
            {
              tenantId,
              itemId,
              usuarioId,
              tipo: 'entrada',
              motivo: 'inventario_inicial',
              cantidad: dto.series.length.toString(),
              comentario: 'Stock inicial (series)',
              series: dto.series,
            },
          );
          stock = mov.stockResultante;
        } else if (
          dto.tipo === 'producto' &&
          modo === 'lote' &&
          dto.lote &&
          dto.stock
        ) {
          const stockInicial = new Decimal(dto.stock);
          if (stockInicial.greaterThan(0)) {
            const mov = await this.inventarioService.registrarMovimiento(
              manager,
              {
                tenantId,
                itemId,
                usuarioId,
                tipo: 'entrada',
                motivo: 'inventario_inicial',
                cantidad: stockInicial.toString(),
                comentario: 'Stock inicial (lote)',
                lote: dto.lote,
              },
            );
            stock = mov.stockResultante;
          }
        }
      } else if (dto.tipo === 'servicio') {
        duracionEstimada = dto.duracionEstimada ?? null;
        requiereCita = dto.requiereCita ?? false;
        await manager.query(
          `INSERT INTO item_servicio (item_id, duracion_estimada, requiere_cita)
           VALUES ($1,$2,$3)`,
          [itemId, duracionEstimada, requiereCita],
        );
      } else if (dto.tipo === 'receta') {
        const costeo = await this.validarYCostearIngredientes(
          manager,
          tenantId,
          dto.ingredientes!,
        );
        costoActual = costeo.costoActual;
        ingredientes = costeo.ingredientes;
        await manager.query(
          `INSERT INTO item_receta (item_id, costo_actual) VALUES ($1,$2)`,
          [itemId, costoActual],
        );
        for (const ing of dto.ingredientes!) {
          await manager.query(
            `INSERT INTO receta_ingredientes
               (tenant_id, receta_item_id, ingrediente_item_id, cantidad, unidad_codigo, bloqueante)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              tenantId,
              itemId,
              ing.ingredienteItemId,
              ing.cantidad,
              ing.unidadCodigo,
              ing.bloqueante ?? true,
            ],
          );
        }
        if (dto.extrasPermitidos?.length) {
          const extrasValidados = await this.validarExtrasPermitidos(
            manager,
            tenantId,
            dto.extrasPermitidos,
          );
          extrasPermitidos = extrasValidados;
          for (const extra of dto.extrasPermitidos) {
            await manager.query(
              `INSERT INTO receta_extras_permitidos
                 (tenant_id, receta_item_id, ingrediente_item_id, cantidad, unidad_codigo, precio_extra)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [
                tenantId,
                itemId,
                extra.ingredienteItemId,
                extra.cantidad,
                extra.unidadCodigo,
                extra.precioExtra,
              ],
            );
          }
        }
      } else if (dto.tipo === 'combo') {
        if (dto.componentes?.length) {
          const costeo = await this.validarYCostearComponentes(
            manager,
            tenantId,
            dto.componentes,
          );
          costoActual = costeo.costoActual;
          componentes = costeo.componentes;
          await manager.query(
            `INSERT INTO item_combo (item_id, costo_actual) VALUES ($1,$2)`,
            [itemId, costoActual],
          );
          for (const comp of dto.componentes) {
            await manager.query(
              `INSERT INTO combo_componentes
                 (tenant_id, combo_item_id, componente_item_id, cantidad, bloqueante)
               VALUES ($1,$2,$3,$4,$5)`,
              [
                tenantId,
                itemId,
                comp.componenteItemId,
                comp.cantidad,
                comp.bloqueante ?? true,
              ],
            );
          }
        } else {
          // Combo solo-grupos: sin componentes fijos, el costo se realiza al
          // vender vía el movimiento de inventario de la opción elegida.
          costoActual = '0';
          await manager.query(
            `INSERT INTO item_combo (item_id, costo_actual) VALUES ($1, '0')`,
            [itemId],
          );
        }
      } else {
        frecuencia = dto.frecuencia ?? null;
        await manager.query(
          `INSERT INTO item_suscripcion (item_id, frecuencia) VALUES ($1,$2)`,
          [itemId, dto.frecuencia],
        );
      }

      await this.insertarRelaciones(
        manager,
        itemId,
        dto.impuestosIds ?? [],
        dto.recargosIds ?? [],
        dto.descuentosIds ?? [],
      );

      if (
        (dto.tipo === 'combo' || dto.tipo === 'receta') &&
        dto.gruposModificadores?.length
      ) {
        await this.asociarGruposModificadores(
          manager,
          tenantId,
          itemId,
          dto.gruposModificadores,
        );
      }

      return {
        id: itemId,
        nombre: dto.nombre,
        descripcion: dto.descripcion ?? null,
        tipo: dto.tipo,
        activo: dto.activo ?? true,
        precioBase: precioBasePersistido,
        precioIncluyeImpuesto: dto.precioIncluyeImpuesto ?? false,
        // Mismo valor que se persistió en el INSERT de arriba — ver el
        // comentario ahí sobre por qué el `?? 'afecto'` no es redundante con
        // el DEFAULT de la columna.
        clasificacionTributaria:
          dto.tipo === 'ingrediente'
            ? null
            : (dto.clasificacionTributaria ?? 'afecto'),
        monedaId: dto.monedaId,
        monedaCodigo: moneda.codigo,
        monedaSimbolo: moneda.simbolo,
        categoriaId: dto.categoriaId ?? null,
        categoriaNombre,
        creadoEl: itemRows[0].creado_el,
        stock,
        unidadMedida,
        fechaElaboracion,
        fechaVencimiento,
        modoInventario,
        costoActual,
        duracionEstimada,
        requiereCita,
        frecuencia,
        impuestosIds: dto.impuestosIds ?? [],
        recargosIds: dto.recargosIds ?? [],
        descuentosIds: dto.descuentosIds ?? [],
        ingredientes,
        extrasPermitidos,
        componentes,
      };
    });
  }

  async update(
    tenantId: string,
    usuarioId: string,
    itemId: string,
    dto: UpdateItemDto,
  ) {
    // Patch mergeable: solo campos tocados + RETURNING de columnas UPDATE.
    // El front hace `{ ...prev, ...saved }` — sin findOne post-write.
    return this.db.transaccion(async (manager) => {
      const existingRows: { item_id: string; tipo: string }[] =
        await manager.query(
          `SELECT item_id, tipo FROM items
           WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
          [itemId, tenantId],
        );
      if (!existingRows.length)
        throw new NotFoundException('Item no encontrado');
      const tipo = existingRows[0].tipo;

      if (dto.frecuencia !== undefined && tipo !== 'suscripcion') {
        throw new BadRequestException(
          'La frecuencia solo aplica a items de suscripción',
        );
      }

      if (tipo === 'ingrediente') {
        if (
          dto.impuestosIds?.length ||
          dto.recargosIds?.length ||
          dto.descuentosIds?.length
        ) {
          throw new BadRequestException(
            'Los ingredientes no admiten impuestos, recargos ni descuentos',
          );
        }
        if (dto.modoInventario && dto.modoInventario !== 'cantidad') {
          throw new BadRequestException(
            'Los ingredientes solo admiten modo de inventario "cantidad"',
          );
        }
      }

      const patch: Record<string, unknown> = { id: itemId, tipo };

      if (dto.monedaId) {
        const moneda = await this.validarMoneda(
          manager,
          tenantId,
          dto.monedaId,
        );
        patch.monedaId = dto.monedaId;
        patch.monedaCodigo = moneda.codigo;
        patch.monedaSimbolo = moneda.simbolo;
      }
      if (dto.categoriaId) {
        patch.categoriaId = dto.categoriaId;
        patch.categoriaNombre = await this.validarCategoria(
          manager,
          tenantId,
          dto.categoriaId,
        );
      }
      if (dto.impuestosIds?.length) {
        await this.validarImpuestos(manager, tenantId, dto.impuestosIds);
      }
      if (dto.recargosIds?.length) {
        await this.validarReglas(
          manager,
          tenantId,
          dto.recargosIds,
          'recargos',
          'recargo_id',
        );
      }
      if (dto.descuentosIds?.length) {
        await this.validarReglas(
          manager,
          tenantId,
          dto.descuentosIds,
          'descuentos',
          'descuento_id',
        );
      }

      const setClauses: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (dto.nombre !== undefined) {
        setClauses.push(`nombre = $${idx++}`);
        params.push(dto.nombre);
        patch.nombre = dto.nombre;
      }
      if (dto.descripcion !== undefined) {
        setClauses.push(`descripcion = $${idx++}`);
        params.push(dto.descripcion);
        patch.descripcion = dto.descripcion;
      }
      if (dto.precioBase !== undefined) {
        const precioBase = tipo === 'ingrediente' ? '0' : dto.precioBase;
        setClauses.push(`precio_base = $${idx++}`);
        params.push(precioBase);
        patch.precioBase = precioBase;
      }
      if (dto.monedaId !== undefined) {
        setClauses.push(`moneda_id = $${idx++}`);
        params.push(dto.monedaId);
      }
      if (dto.categoriaId !== undefined) {
        setClauses.push(`categoria_id = $${idx++}`);
        params.push(dto.categoriaId);
        patch.categoriaId = dto.categoriaId;
      }
      if (dto.precioIncluyeImpuesto !== undefined) {
        setClauses.push(`precio_incluye_impuesto = $${idx++}`);
        params.push(dto.precioIncluyeImpuesto);
        patch.precioIncluyeImpuesto = dto.precioIncluyeImpuesto;
      }
      if (dto.activo !== undefined) {
        setClauses.push(`activo = $${idx++}`);
        params.push(dto.activo);
        patch.activo = dto.activo;
      }
      if (dto.clasificacionTributaria !== undefined) {
        if (tipo === 'ingrediente') {
          throw new BadRequestException(
            'Un ingrediente no tiene clasificación tributaria: no se vende',
          );
        }
        setClauses.push(`clasificacion_tributaria = $${idx++}`);
        params.push(dto.clasificacionTributaria);
        patch.clasificacionTributaria = dto.clasificacionTributaria;
      }

      // El lock de la receta va acá y no junto al costeo de más abajo, aunque
      // sea ahí donde se usa: el `UPDATE items` que sigue toma lock sobre
      // `items`, y `aplicarDesfases` bloquea al revés —primero `item_receta`,
      // después `items` para el precio—. Tomarlos en orden inverso cierra el
      // ciclo A→B / B→A y las dos transacciones se abrazan (`40P01`), con un
      // PATCH de receta normal —nombre + ingredientes— corriendo contra un
      // "aplicar desfase con actualizar precio". Los dos caminos tienen que
      // tomar `item_receta` antes que `items`.
      if (tipo === 'receta' && dto.ingredientes !== undefined) {
        await manager.query(
          `SELECT item_id FROM item_receta WHERE item_id = $1 FOR UPDATE`,
          [itemId],
        );
      } else if (tipo === 'combo' && dto.componentes !== undefined) {
        // Gemelo del lock de arriba, por el otro ciclo: `aplicarDesfases`
        // bloquea `item_combo` y después escribe `items` (el precio). El
        // `UPDATE items` que sigue toma lock sobre `items`, así que sin este
        // lock los dos caminos se toman las filas en orden inverso y se
        // abrazan (40P01) — con un PATCH de combo (nombre + componentes)
        // corriendo contra un "aplicar desfase con actualizar precio".
        await manager.query(
          `SELECT item_id FROM item_combo WHERE item_id = $1 FOR UPDATE`,
          [itemId],
        );
      }

      if (setClauses.length) {
        setClauses.push(`actualizado_el = NOW()`);
        params.push(itemId, tenantId);
        await manager.query(
          `UPDATE items SET ${setClauses.join(', ')}
           WHERE item_id = $${idx++} AND tenant_id = $${idx++}
           RETURNING item_id`,
          params,
        );
      }

      // Cambio de unidad con costo vigente: hay que reconvertir el costo (ver
      // más abajo). Se resuelve después del UPDATE, pero el valor previo se
      // lee antes; este par lo cruza.
      let costoAReconvertir: {
        desde: string;
        hacia: string;
        costo: string;
      } | null = null;

      if (tipo === 'producto' || tipo === 'ingrediente') {
        // El frontend reenvía modoInventario/unidadMedida en toda edición.
        // Solo se rechaza si el valor cambia de verdad y ya hay movimientos.
        if (
          dto.modoInventario !== undefined ||
          dto.unidadMedida !== undefined
        ) {
          if (dto.unidadMedida !== undefined) {
            await this.validarUnidadMedida(dto.unidadMedida);
          }

          const prodRows: {
            modo_inventario: string;
            unidad_medida: string;
            costo_actual: string | null;
          }[] = await manager.query(
            // `FOR UPDATE` para serializar con `registrarMovimiento`, que toma
            // el mismo lock sobre esta fila (`inventario.service.ts`). Sin él
            // los dos leen a la vez y el guard de "no cambiar `modo_inventario`
            // con movimientos existentes" decide sobre un kardex que otra
            // transacción está escribiendo: el modo cambia y el movimiento
            // recién escrito queda bajo un modo que nunca lo admitió.
            `SELECT modo_inventario, unidad_medida, costo_actual
               FROM item_producto WHERE item_id = $1 FOR UPDATE`,
            [itemId],
          );

          const modoCambia =
            dto.modoInventario !== undefined &&
            prodRows.length > 0 &&
            prodRows[0].modo_inventario !== dto.modoInventario;
          const unidadCambia =
            dto.unidadMedida !== undefined &&
            prodRows.length > 0 &&
            prodRows[0].unidad_medida !== dto.unidadMedida;

          if (modoCambia || unidadCambia) {
            // Un ajuste_costo (tipo='ajuste') no mueve stock, solo corrige el
            // costo: no cuenta para bloquear el modo/unidad. Sin este filtro,
            // un ajuste hecho sobre stock 0 (antes de recibir mercadería)
            // congelaría ambos para siempre sin que nunca hubiera existido un
            // movimiento de stock real.
            const movRows: { cnt: string }[] = await manager.query(
              `SELECT COUNT(*) AS cnt FROM movimientos_inventario
               WHERE item_id = $1 AND eliminado_el IS NULL AND tipo <> 'ajuste'`,
              [itemId],
            );
            if (parseInt(movRows[0].cnt) > 0) {
              throw new BadRequestException(
                modoCambia
                  ? 'No se puede cambiar el modo de inventario de un producto con movimientos registrados'
                  : 'No se puede cambiar la unidad de medida de un producto con movimientos registrados',
              );
            }
          }

          // Cambiar la unidad de un ítem que otra fila ya referencia CON una
          // unidad fijada rompe esa fila: la receta dice "200 g de queso" y el
          // queso pasa a medirse en litros, así que `convertirUnidad` deja de
          // poder resolverla. El guard de movimientos no lo cubre — un
          // ingrediente sin costo ni movimientos pasaba de kg a l sin fricción.
          //
          // Son CUATRO tablas, no las dos que se ven a simple vista: además de
          // las recetas y las opciones de grupo están los extras permitidos y
          // los overrides por ítem↔grupo. Se buscó por conducta ("¿qué tabla
          // fija una unidad contra un item_id?") y no por el nombre de las dos
          // conocidas. Una sola query con `UNION ALL`, no una por tabla.
          //
          // Bloquea ante CUALQUIER referencia, aunque la unidad nueva sea
          // convertible (kg → g): es lo que decidió el owner, y la alternativa
          // —permitir solo los cambios compatibles— exige razonar la magnitud
          // por fila y deja al usuario sin señal de qué recetas dependen de esto.
          // El camino es desarmar la receta primero.
          if (unidadCambia) {
            const refRows: { origen: string }[] = await manager.query(
              `SELECT 'receta' AS origen
                 FROM receta_ingredientes
                WHERE ingrediente_item_id = $1 AND tenant_id = $2
                  AND eliminado_el IS NULL
               UNION ALL
               SELECT 'extra permitido de una receta'
                 FROM receta_extras_permitidos
                WHERE ingrediente_item_id = $1 AND tenant_id = $2
                  AND eliminado_el IS NULL
               UNION ALL
               SELECT 'opción de un grupo de modificadores'
                 FROM grupo_modificador_opciones
                WHERE item_id = $1 AND tenant_id = $2
                  AND unidad_codigo IS NOT NULL AND eliminado_el IS NULL
               UNION ALL
               SELECT 'override de una opción de grupo'
                 FROM item_grupo_modificador_opciones igo
                 JOIN grupo_modificador_opciones go
                   ON go.grupo_opcion_id = igo.grupo_opcion_id
                  AND go.eliminado_el IS NULL
                WHERE go.item_id = $1 AND igo.tenant_id = $2
                  AND go.tenant_id = $2
                  AND igo.unidad_codigo IS NOT NULL AND igo.eliminado_el IS NULL
               LIMIT 1`,
              [itemId, tenantId],
            );
            if (refRows.length > 0) {
              throw new BadRequestException(
                `No se puede cambiar la unidad de medida: el producto ya está referenciado por una ${refRows[0].origen}, ` +
                  'con su cantidad fijada en la unidad actual. Quitá esa referencia primero.',
              );
            }
          }

          // `costo_actual` es "costo por unidad_medida": si la unidad cambia y
          // el costo se queda, pasa a significar otra cosa (5.000 por kg leído
          // como 5.000 por gramo, error de 1000×). El guard de arriba no cubre
          // este caso porque un producto creado con stock 0 no tiene ningún
          // movimiento y sí puede tener costo.
          if (unidadCambia && prodRows[0].costo_actual != null) {
            costoAReconvertir = {
              desde: prodRows[0].unidad_medida,
              hacia: dto.unidadMedida!,
              costo: prodRows[0].costo_actual,
            };
          }
        }

        const prodClauses: string[] = [];
        const prodParams: unknown[] = [];
        let pidx = 1;
        if (dto.modoInventario !== undefined && tipo === 'producto') {
          prodClauses.push(`modo_inventario = $${pidx++}`);
          prodParams.push(dto.modoInventario);
          patch.modoInventario = dto.modoInventario;
        }
        if (dto.unidadMedida !== undefined) {
          prodClauses.push(`unidad_medida = $${pidx++}`);
          prodParams.push(dto.unidadMedida);
          patch.unidadMedida = dto.unidadMedida;
        }
        if (dto.fechaElaboracion !== undefined && tipo === 'producto') {
          prodClauses.push(`fecha_elaboracion = $${pidx++}`);
          prodParams.push(dto.fechaElaboracion);
          patch.fechaElaboracion = dto.fechaElaboracion;
        }
        if (dto.fechaVencimiento !== undefined && tipo === 'producto') {
          prodClauses.push(`fecha_vencimiento = $${pidx++}`);
          prodParams.push(dto.fechaVencimiento);
          patch.fechaVencimiento = dto.fechaVencimiento;
        }
        if (prodClauses.length) {
          prodParams.push(itemId);
          await manager.query(
            `UPDATE item_producto SET ${prodClauses.join(', ')} WHERE item_id = $${pidx++}`,
            prodParams,
          );
        }

        // La reconversión va por registrarMovimiento, no por un UPDATE directo:
        // `costo_actual` solo se escribe desde el choke point (ADR-016, con test
        // de invariante). De paso deja el cambio auditado en el kardex como un
        // ajuste_costo, con el costo anterior y el nuevo.
        if (costoAReconvertir) {
          // 1 unidad vieja equivale a N nuevas (1 kg = 1000 g), así que el
          // costo por unidad nueva es el viejo dividido por N.
          // ⚠️ Ese N sale cuantizado a 4 decimales (docblock de
          // `convertirConMapa`), y con cantidad 1 es el peor caso de precisión
          // relativa: mismo molde que `registrarAjusteCosto`. Inocuo mientras
          // los factores sean potencias de 10.
          // Entre magnitudes distintas (unidad → kg) no hay N posible, y el
          // error de convertirUnidad ("no se puede convertir de conteo a masa")
          // no dice qué lo bloqueó: acá es el costo, no la cantidad.
          let unaUnidadVieja: string;
          try {
            unaUnidadVieja = await this.catalogService.convertirUnidad(
              '1',
              costoAReconvertir.desde,
              costoAReconvertir.hacia,
            );
          } catch {
            throw new BadRequestException(
              `No se puede cambiar la unidad de ${costoAReconvertir.desde} a ${costoAReconvertir.hacia}: el costo vigente está expresado por ${costoAReconvertir.desde} y no se puede reconvertir entre magnitudes distintas`,
            );
          }
          const costoNuevo = convertirCostoUnitario(
            '1',
            costoAReconvertir.costo,
            unaUnidadVieja,
          );
          // Un costo vigente de 0 (mercadería donada) reconvierte a 0 y sigue
          // de largo: cambiarle la unidad a ese producto es legítimo. Lo que se
          // corta es el costo positivo que se pierde en la reconversión.
          assertCostoNoColapsaACero(
            costoAReconvertir.costo,
            costoNuevo,
            costoAReconvertir.hacia,
          );
          await this.inventarioService.registrarMovimiento(manager, {
            tenantId,
            itemId,
            usuarioId,
            tipo: 'ajuste',
            motivo: 'ajuste_costo',
            cantidad: '0',
            costoUnitario: costoNuevo,
            comentario: `Cambio de unidad ${costoAReconvertir.desde} → ${costoAReconvertir.hacia}: costo reconvertido`,
          });
        }
      } else if (tipo === 'servicio') {
        const srvClauses: string[] = [];
        const srvParams: unknown[] = [];
        let sidx = 1;
        if (dto.duracionEstimada !== undefined) {
          srvClauses.push(`duracion_estimada = $${sidx++}`);
          srvParams.push(dto.duracionEstimada);
          patch.duracionEstimada = dto.duracionEstimada;
        }
        if (dto.requiereCita !== undefined) {
          srvClauses.push(`requiere_cita = $${sidx++}`);
          srvParams.push(dto.requiereCita);
          patch.requiereCita = dto.requiereCita;
        }
        if (srvClauses.length) {
          srvParams.push(itemId);
          await manager.query(
            `UPDATE item_servicio SET ${srvClauses.join(', ')} WHERE item_id = $${sidx++}`,
            srvParams,
          );
        }
      } else if (tipo === 'suscripcion') {
        if (dto.frecuencia !== undefined) {
          await manager.query(
            `UPDATE item_suscripcion SET frecuencia = $1 WHERE item_id = $2`,
            [dto.frecuencia, itemId],
          );
          patch.frecuencia = dto.frecuencia;
        }
      } else if (tipo === 'receta') {
        if (dto.ingredientes !== undefined) {
          if (!dto.ingredientes.length) {
            throw new BadRequestException(
              'Las recetas requieren al menos un ingrediente',
            );
          }
          // El lock de `item_receta` ya se tomó arriba, antes del `UPDATE
          // items` — ver el comentario ahí para por qué no puede vivir acá.
          // Lo que importa para el costeo es que está tomado ANTES de esta
          // lectura: el mismo `costo_actual` lo escribe `aplicarDesfases`
          // partiendo de los mismos ingredientes, y sin el lock los dos leen la
          // lista vieja y el que commitea segundo pisa el costo del otro.
          const costeo = await this.validarYCostearIngredientes(
            manager,
            tenantId,
            dto.ingredientes,
          );

          // Mismo molde que los extras de más abajo, y por la misma razón: el
          // `UPDATE` que sigue borra la lista ENTERA, así que el diff se calcula
          // antes. Sacar de la receta un ingrediente que una mesa abierta pidió
          // **sin** él deja esa cuenta incobrable: al re-tasar,
          // `resolverPersonalizacionReceta` rechaza el omitido que ya no
          // pertenece a la receta ("Ingrediente omitido no pertenece a la
          // receta").
          //
          // ⚠️ **Esta puerta avisa más tarde que las otras cuatro, no antes.**
          // Medido el 2026-08-30: una línea cuya personalización es SOLO
          // `omitidos` ni siquiera pasa por el resolver en
          // `POST /calculo-precios/calcular` —`puedeCostar()` la saltea porque
          // sin extras ni grupos no puede mover el precio, y saltearse el
          // resolver es saltearse sus validaciones—, así que la precuenta
          // muestra un precio normal y el 400 recién aparece **al cerrar**. El
          // garzón no ve nada raro hasta que intenta cobrar.
          //
          // Solo los que se sacan, a propósito: cambiarle la cantidad, la unidad
          // o el bloqueante a un ingrediente ya omitido no rompe ninguna mesa
          // —el omitido guarda un id, no una cantidad— y agregar tampoco.
          const vivos: { ingrediente_item_id: string }[] = await manager.query(
            `SELECT ingrediente_item_id FROM receta_ingredientes
             WHERE receta_item_id = $1 AND tenant_id = $2
               AND eliminado_el IS NULL`,
            [itemId, tenantId],
          );
          const entrantes = new Set(
            dto.ingredientes.map((i) => i.ingredienteItemId),
          );
          const omitidos = await this.cuentasAbiertasConIngredienteOmitido(
            manager,
            tenantId,
            itemId,
            vivos
              .map((v) => v.ingrediente_item_id)
              .filter((id) => !entrantes.has(id)),
          );
          if (omitidos.length) {
            throw new BadRequestException(
              `No se puede sacar de la receta un ingrediente que una mesa pidió sin él: ${omitidos
                .map((o) => `"${o.ingrediente}" está omitido en ${o.cuenta}`)
                .join('; ')}`,
            );
          }

          // Soft delete de la lista anterior — nunca hard DELETE
          await manager.query(
            `UPDATE receta_ingredientes
             SET eliminado_el = NOW(), actualizado_el = NOW()
             WHERE receta_item_id = $1 AND eliminado_el IS NULL`,
            [itemId],
          );
          for (const ing of dto.ingredientes) {
            await manager.query(
              `INSERT INTO receta_ingredientes
                 (tenant_id, receta_item_id, ingrediente_item_id, cantidad, unidad_codigo, bloqueante)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [
                tenantId,
                itemId,
                ing.ingredienteItemId,
                ing.cantidad,
                ing.unidadCodigo,
                ing.bloqueante ?? true,
              ],
            );
          }
          await manager.query(
            `UPDATE item_receta
             SET costo_actual = $1, costo_propuesto_omitido = NULL
             WHERE item_id = $2`,
            [costeo.costoActual, itemId],
          );
          patch.costoActual = costeo.costoActual;
          patch.ingredientes = costeo.ingredientes;
        }
        if (dto.extrasPermitidos !== undefined) {
          const extrasValidados = await this.validarExtrasPermitidos(
            manager,
            tenantId,
            dto.extrasPermitidos,
          );

          // Este `UPDATE` borra la lista ENTERA y después reinserta la nueva,
          // así que el diff hay que calcularlo antes: los extras que **se
          // sacan** son los vivos que el dto ya no trae. Sacar uno que una mesa
          // abierta ya pidió deja esa cuenta incobrable —al re-tasar la línea,
          // `resolverPersonalizacionReceta` la rechaza con "Extra no permitido
          // para esta receta"—, que es el mismo agujero que la rama nueva de
          // `obtenerUsoItem` cierra del lado del borrado.
          //
          // Solo los que se sacan, a propósito: reordenar la lista, cambiarle el
          // precio a un extra ya pedido o agregar uno nuevo no rompe ninguna
          // mesa, y un guard por "la lista cambió" mataría la edición de
          // catálogo entera —dejaría la carta congelada mientras haya UNA mesa
          // sentada—.
          //
          // ⚠️ Que repreciar no rompa la mesa NO quiere decir que no la afecte:
          // `cerrarCuenta` manda solo `{ingredienteItemId, unidades}` y el
          // servidor re-tasa con el `precio_extra` del **catálogo vivo**
          // (`resolverPersonalizacionReceta`), así que la mesa abierta paga el
          // precio nuevo. Es la doctrina de siempre —el precio de una línea lo
          // calcula el servidor contra el catálogo vivo—, no un efecto de este
          // guard, y no es lo que este frente arregla: lo que se arregla acá es
          // que la línea deje de poder tasarse **en absoluto**.
          const vivos: { ingrediente_item_id: string }[] = await manager.query(
            `SELECT ingrediente_item_id FROM receta_extras_permitidos
             WHERE receta_item_id = $1 AND tenant_id = $2
               AND eliminado_el IS NULL`,
            [itemId, tenantId],
          );
          const entrantes = new Set(
            dto.extrasPermitidos.map((e) => e.ingredienteItemId),
          );
          const pedidos = await this.cuentasAbiertasConExtra(
            manager,
            tenantId,
            itemId,
            vivos
              .map((v) => v.ingrediente_item_id)
              .filter((id) => !entrantes.has(id)),
          );
          if (pedidos.length) {
            throw new BadRequestException(
              `No se puede sacar de la receta un extra ya pedido: ${pedidos
                .map((p) => `"${p.ingrediente}" está pedido en ${p.cuenta}`)
                .join('; ')}`,
            );
          }

          await manager.query(
            `UPDATE receta_extras_permitidos
             SET eliminado_el = NOW(), actualizado_el = NOW()
             WHERE receta_item_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
            [itemId, tenantId],
          );
          for (const extra of dto.extrasPermitidos) {
            await manager.query(
              `INSERT INTO receta_extras_permitidos
                 (tenant_id, receta_item_id, ingrediente_item_id, cantidad, unidad_codigo, precio_extra)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [
                tenantId,
                itemId,
                extra.ingredienteItemId,
                extra.cantidad,
                extra.unidadCodigo,
                extra.precioExtra,
              ],
            );
          }
          patch.extrasPermitidos = extrasValidados;
        }
      } else if (tipo === 'combo' && dto.componentes !== undefined) {
        // `componentes: []` es válido si el combo queda sostenido por grupos
        // (el guard de huérfano de más abajo lo verifica): combo solo-grupos
        // con costo 0, simétrico con create().
        const costeo = dto.componentes.length
          ? await this.validarYCostearComponentes(
              manager,
              tenantId,
              dto.componentes,
            )
          : { costoActual: '0', componentes: [] };
        await manager.query(
          `UPDATE combo_componentes
           SET eliminado_el = NOW(), actualizado_el = NOW()
           WHERE combo_item_id = $1 AND eliminado_el IS NULL`,
          [itemId],
        );
        for (const comp of dto.componentes) {
          await manager.query(
            `INSERT INTO combo_componentes
               (tenant_id, combo_item_id, componente_item_id, cantidad, bloqueante)
             VALUES ($1,$2,$3,$4,$5)`,
            [
              tenantId,
              itemId,
              comp.componenteItemId,
              comp.cantidad,
              comp.bloqueante ?? true,
            ],
          );
        }
        // Limpia el omitido igual que la receta de arriba: el snapshot
        // descartado corresponde a la lista de componentes anterior, y si
        // sobrevive al cambio de lista puede volver a coincidir con el
        // propuesto nuevo por casualidad — el combo desaparecería de la
        // bandeja con el costo cacheado equivocado.
        await manager.query(
          `UPDATE item_combo
           SET costo_actual = $1, costo_propuesto_omitido = NULL
           WHERE item_id = $2`,
          [costeo.costoActual, itemId],
        );
        patch.costoActual = costeo.costoActual;
        patch.componentes = costeo.componentes;
      }

      if (
        (tipo === 'combo' || tipo === 'receta') &&
        dto.gruposModificadores !== undefined
      ) {
        await this.asociarGruposModificadores(
          manager,
          tenantId,
          itemId,
          dto.gruposModificadores,
        );
        patch.gruposModificadores = dto.gruposModificadores;
      }

      // Un combo no puede quedar huérfano: si este PATCH tocó componentes
      // y/o grupos, verificar que sobreviva al menos uno de los dos (vivo)
      // antes de cerrar la transacción — replica la regla de create().
      if (
        tipo === 'combo' &&
        (dto.componentes !== undefined || dto.gruposModificadores !== undefined)
      ) {
        const vivosRows: { componentes: string; grupos: string }[] =
          await manager.query(
            `SELECT
               (SELECT COUNT(*) FROM combo_componentes
                 WHERE combo_item_id = $1 AND eliminado_el IS NULL) AS componentes,
               (SELECT COUNT(*) FROM item_grupos_modificadores
                 WHERE item_id = $1 AND eliminado_el IS NULL) AS grupos`,
            [itemId],
          );
        const totalVivos =
          parseInt(vivosRows[0].componentes, 10) +
          parseInt(vivosRows[0].grupos, 10);
        if (totalVivos === 0) {
          throw new BadRequestException(
            'Los combos requieren al menos un componente o un grupo de modificadores',
          );
        }
      }

      if (dto.impuestosIds !== undefined) {
        await manager.query(`DELETE FROM item_impuestos WHERE item_id = $1`, [
          itemId,
        ]);
        for (const id of dto.impuestosIds) {
          await manager.query(
            `INSERT INTO item_impuestos (item_id, impuesto_id) VALUES ($1,$2)`,
            [itemId, id],
          );
        }
        patch.impuestosIds = dto.impuestosIds;
      }
      if (dto.recargosIds !== undefined) {
        await manager.query(`DELETE FROM item_recargos WHERE item_id = $1`, [
          itemId,
        ]);
        for (const id of dto.recargosIds) {
          await manager.query(
            `INSERT INTO item_recargos (item_id, recargo_id) VALUES ($1,$2)`,
            [itemId, id],
          );
        }
        patch.recargosIds = dto.recargosIds;
      }
      if (dto.descuentosIds !== undefined) {
        await manager.query(`DELETE FROM item_descuentos WHERE item_id = $1`, [
          itemId,
        ]);
        for (const id of dto.descuentosIds) {
          await manager.query(
            `INSERT INTO item_descuentos (item_id, descuento_id) VALUES ($1,$2)`,
            [itemId, id],
          );
        }
        patch.descuentosIds = dto.descuentosIds;
      }

      return patch;
    });
  }

  /**
   * Los seis lugares donde un item puede estar en uso, en una sola query.
   * `UNION` y no `UNION ALL`: el dedupe es el mismo `DISTINCT` que hacía cada
   * query por separado —y es también lo que evita que una cuenta que pidió el
   * ítem como línea *y* como extra salga nombrada dos veces en el mensaje—. El
   * `ORDER BY` es por determinismo: sin él el orden lo decide el plan y el modal
   * lista los motivos distinto entre llamadas.
   *
   * Cuatro son de **catálogo**. Las otras dos son la misma pregunta operativa
   * —*¿hay una mesa esperando por esto?*— sobre `cuenta_lineas`, y las dos
   * devuelven `'cuenta'` a propósito, porque el mensaje de `remove()` es el
   * mismo y hay e2e que lo afirman:
   *
   *   1. `cl.item_id`: el ítem **es** la línea (la hamburguesa pedida).
   *   2. `cl.personalizacion @> {"extras":[…]}`: el ítem está **adentro** de la
   *      línea (el queso que esa hamburguesa lleva como extra). Sin esta rama,
   *      borrar el queso devolvía 200 y soft-borraba su fila de
   *      `receta_extras_permitidos`; a partir de ahí `resolverPersonalizacionReceta`
   *      rechaza esa línea con "Extra no permitido para esta receta" al re-tasar,
   *      y la mesa queda **incobrable** —en la precuenta y al cerrar—. Es
   *      containment y no `jsonb_array_elements` por dos razones medidas contra
   *      Postgres real: con la clave ausente devuelve `false` en vez de tirar, y
   *      exige que las coincidencias caigan en el **mismo** objeto —una opción
   *      elegida dentro del grupo G1 no matchea la pregunta "esa opción dentro
   *      de G2"—, que es lo que hace falta cuando el alcance es un grupo.
   *
   * Ambas se acotan por `estado = 'abierta'` y por el borrado de la línea, la
   * cuenta y la mesa —sin el filtro de estado, una cuenta ya cerrada volvería el
   * ítem inborrable para siempre—, y `'cuenta'` va primero en el mensaje de
   * `remove()` porque es la única clase con alguien esperando en la mesa.
   *
   * ⚠️ La tercera puerta —el ítem elegido como **opción de un grupo**— no tiene
   * rama acá porque la rama `'opcion'` ya bloquea ese borrado haya mesas o no…
   * **pero solo mientras la opción siga viva en el grupo** (esa rama filtra
   * `o.eliminado_el IS NULL`). Sacarla del grupo desarmaría esa cobertura, y por
   * eso el guard vive del otro lado: `PATCH /grupos-modificadores/:id` consulta
   * cuentas antes de soft-borrar la opción (`cuentasAbiertasConOpcionDeGrupo`,
   * cerrado el 2026-08-30).
   *
   * Las tres puertas de `PATCH /items/:id` —`extrasPermitidos`, `ingredientes` y
   * `gruposModificadores`— tampoco están acá sino en `update()` y en
   * `asociarGruposModificadores`, con las tres consultas hermanas: mismo
   * agujero, distintas puertas.
   *
   * El filtro por tenant va sobre la entidad padre de cada rama (`items`, o
   * `grupos_modificadores` en la de opciones), no sobre la tabla puente. A
   * diferencia de `cargarReglasPorIds` —donde el JOIN a `items` es la única
   * defensa posible porque sus tablas puente (`item_impuestos`, `item_descuentos`,
   * `item_recargos`) no tienen `tenant_id` propio—, acá las cinco tablas puente
   * (`receta_ingredientes`, `combo_componentes`, `grupo_modificador_opciones`,
   * `receta_extras_permitidos`, `cuenta_lineas`) sí lo tienen. En las dos de
   * cuentas se filtra por la puente **y** por los padres, que es lo que hace
   * falta para no contar cuentas o mesas en la papelera.
   */
  private async obtenerUsoItem(
    manager: EntityManager | Db,
    tenantId: string,
    itemId: string,
  ): Promise<UsoItem> {
    const rows: { clase: UsoItemTipo; nombre: string }[] = await manager.query(
      `SELECT 'ingrediente' AS clase, r.nombre
         FROM receta_ingredientes ri
         JOIN items r ON r.item_id = ri.receta_item_id
          AND r.tenant_id = $2 AND r.eliminado_el IS NULL
        WHERE ri.ingrediente_item_id = $1 AND ri.eliminado_el IS NULL
       UNION
       SELECT 'combo', c.nombre
         FROM combo_componentes cc
         JOIN items c ON c.item_id = cc.combo_item_id
          AND c.tenant_id = $2 AND c.eliminado_el IS NULL
        WHERE cc.componente_item_id = $1 AND cc.eliminado_el IS NULL
       UNION
       SELECT 'opcion', g.nombre
         FROM grupo_modificador_opciones o
         JOIN grupos_modificadores g
           ON g.grupo_modificador_id = o.grupo_modificador_id
          AND g.tenant_id = $2 AND g.eliminado_el IS NULL
        WHERE o.item_id = $1 AND o.eliminado_el IS NULL
       UNION
       SELECT 'cuenta',
              m.nombre || ' · ' || COALESCE(c.nombre, 'cuenta ' || c.numero)
         FROM cuenta_lineas cl
         JOIN cuentas c ON c.cuenta_id = cl.cuenta_id
          AND c.tenant_id = $2 AND c.eliminado_el IS NULL
          AND c.estado = 'abierta'
         JOIN mesas m ON m.mesa_id = c.mesa_id
          AND m.tenant_id = $2 AND m.eliminado_el IS NULL
        WHERE cl.item_id = $1 AND cl.tenant_id = $2
          AND cl.eliminado_el IS NULL
       UNION
       SELECT 'cuenta',
              m.nombre || ' · ' || COALESCE(c.nombre, 'cuenta ' || c.numero)
         FROM cuenta_lineas cl
         JOIN cuentas c ON c.cuenta_id = cl.cuenta_id
          AND c.tenant_id = $2 AND c.eliminado_el IS NULL
          AND c.estado = 'abierta'
         JOIN mesas m ON m.mesa_id = c.mesa_id
          AND m.tenant_id = $2 AND m.eliminado_el IS NULL
        WHERE cl.tenant_id = $2 AND cl.eliminado_el IS NULL
          AND cl.personalizacion @> jsonb_build_object(
                'extras',
                jsonb_build_array(
                  jsonb_build_object('ingredienteItemId', $1::uuid)))
       UNION
       SELECT 'extra', r.nombre
         FROM receta_extras_permitidos re
         JOIN items r ON r.item_id = re.receta_item_id
          AND r.tenant_id = $2 AND r.eliminado_el IS NULL
        WHERE re.ingrediente_item_id = $1 AND re.eliminado_el IS NULL
        ORDER BY 1, 2`,
      [itemId, tenantId],
    );

    const uso: UsoItem = { bloqueos: [], advertencias: [] };
    for (const r of rows) {
      const ref: UsoItemRef = { tipo: r.clase, nombre: r.nombre };
      if (r.clase === 'extra') uso.advertencias.push(ref);
      else uso.bloqueos.push(ref);
    }
    return uso;
  }

  /**
   * ¿Qué cuentas **abiertas** pidieron alguno de estos ingredientes como
   * **extra de esta receta**? Es la misma pregunta que la sexta rama del `UNION`
   * de `obtenerUsoItem`, con dos diferencias que la hacen otra consulta:
   *
   * - **Varios ids de una.** El `PATCH` de la receta puede sacar N extras en un
   *   request, y eso es **una** consulta —`CROSS JOIN LATERAL unnest($3)`— y no N.
   * - **Acotada a la receta.** El borrado pregunta por el ingrediente en
   *   cualquier línea; acá el ingrediente puede estar pedido como extra de
   *   *otra* receta y esa mesa no se rompe por editar ésta. Sin el
   *   `cl.item_id = $2` el guard bloquearía ediciones legítimas.
   *
   * Proyecta también el nombre del ingrediente —de ahí el `JOIN items`— porque
   * si el request saca tres extras y uno solo está pedido, "no se puede" sin
   * decir cuál no le sirve a nadie.
   *
   * A diferencia de la rama de `obtenerUsoItem`, ésta **no depende del GIN**: el
   * `cl.item_id = $2` la ancla en `idx_cuenta_lineas_item` y el containment cae
   * como filtro sobre las pocas líneas de esa receta. Medido con `EXPLAIN`
   * contra el compose: el plan arranca por `idx_cuenta_lineas_item`, el GIN no
   * aparece.
   *
   * ⚠️ Lee sin lock y después el `UPDATE` borra: bajo READ COMMITTED, una línea
   * que se agregue a una cuenta en el medio se pierde esta verificación y queda
   * huérfana igual. La ventana es chica y la puerta del `DELETE` tiene la misma
   * forma, así que es consistente con lo que ya había — no una regresión, pero
   * tampoco una garantía.
   */
  private async cuentasAbiertasConExtra(
    manager: EntityManager | Db,
    tenantId: string,
    recetaItemId: string,
    ingredienteItemIds: string[],
  ): Promise<{ ingrediente: string; cuenta: string }[]> {
    if (!ingredienteItemIds.length) return [];
    return manager.query(
      `SELECT DISTINCT i.nombre AS ingrediente,
              m.nombre || ' · ' || COALESCE(c.nombre, 'cuenta ' || c.numero)
                AS cuenta
         FROM cuenta_lineas cl
         JOIN cuentas c ON c.cuenta_id = cl.cuenta_id
          AND c.tenant_id = $1 AND c.eliminado_el IS NULL
          AND c.estado = 'abierta'
         JOIN mesas m ON m.mesa_id = c.mesa_id
          AND m.tenant_id = $1 AND m.eliminado_el IS NULL
         CROSS JOIN LATERAL unnest($3::uuid[]) AS x(id)
         JOIN items i ON i.item_id = x.id
          AND i.tenant_id = $1 AND i.eliminado_el IS NULL
        WHERE cl.tenant_id = $1 AND cl.eliminado_el IS NULL
          AND cl.item_id = $2
          AND cl.personalizacion @> jsonb_build_object(
                'extras',
                jsonb_build_array(
                  jsonb_build_object('ingredienteItemId', x.id)))
        ORDER BY 1, 2`,
      [tenantId, recetaItemId, ingredienteItemIds],
    );
  }

  /**
   * ¿Qué cuentas **abiertas** pidieron esta receta **sin** alguno de estos
   * ingredientes? La cuarta puerta, y la única de las cinco donde el
   * containment cae sobre un array de **escalares**: `omitidos` es una lista
   * plana de uuids, así que la pregunta es `@> {"omitidos":["<id>"]}`, sin
   * `jsonb_build_object` adentro. Verificado contra Postgres real:
   * `jsonb_build_array($n::uuid)` serializa el uuid como string JSON y matchea
   * el elemento.
   *
   * El `cl.item_id = $2` acota a esta receta y la cota es **exacta**: un combo
   * nunca produce omitidos —`resolverPersonalizacionCombo` devuelve
   * `omitidos: []` siempre, y la personalización de un componente son solo sus
   * grupos—, así que acá no hay un segundo nivel donde mirar como en
   * `cuentasAbiertasConOpcionDeGrupo`. Por lo mismo tampoco se apoya en el GIN:
   * arranca por `idx_cuenta_lineas_item`.
   *
   * ⚠️ Misma ventana de carrera que sus hermanas: lee sin lock y el `UPDATE`
   * que sigue borra.
   */
  private async cuentasAbiertasConIngredienteOmitido(
    manager: EntityManager | Db,
    tenantId: string,
    recetaItemId: string,
    ingredienteItemIds: string[],
  ): Promise<{ ingrediente: string; cuenta: string }[]> {
    if (!ingredienteItemIds.length) return [];
    return manager.query(
      `SELECT DISTINCT i.nombre AS ingrediente,
              m.nombre || ' · ' || COALESCE(c.nombre, 'cuenta ' || c.numero)
                AS cuenta
         FROM cuenta_lineas cl
         JOIN cuentas c ON c.cuenta_id = cl.cuenta_id
          AND c.tenant_id = $1 AND c.eliminado_el IS NULL
          AND c.estado = 'abierta'
         JOIN mesas m ON m.mesa_id = c.mesa_id
          AND m.tenant_id = $1 AND m.eliminado_el IS NULL
         CROSS JOIN LATERAL unnest($3::uuid[]) AS x(id)
         JOIN items i ON i.item_id = x.id
          AND i.tenant_id = $1 AND i.eliminado_el IS NULL
        WHERE cl.tenant_id = $1 AND cl.eliminado_el IS NULL
          AND cl.item_id = $2
          AND cl.personalizacion @> jsonb_build_object(
                'omitidos', jsonb_build_array(x.id))
        ORDER BY 1, 2`,
      [tenantId, recetaItemId, ingredienteItemIds],
    );
  }

  /**
   * ¿Qué cuentas **abiertas** eligieron alguna de estas opciones **de este
   * grupo**? La hermana de `cuentasAbiertasConExtra`, para la tercera puerta:
   * `PATCH /grupos-modificadores/:id` soft-borra las opciones que desaparecen,
   * y si una mesa ya eligió una, su línea deja de poder tasarse ("La opción X
   * no pertenece al grupo") en la precuenta y al cerrar.
   *
   * Vive acá y no en `GruposModificadoresService` porque la pregunta es sobre
   * `cuenta_lineas.personalizacion`, que es el mismo campo y la misma regla que
   * las otras dos puertas. `GruposModificadoresModule` importa `ItemsModule`
   * para llamarla; no hay ciclo, `ItemsModule` no conoce a los grupos.
   *
   * **Dos niveles, dos containments**, porque el snapshot guarda la elección en
   * dos lugares distintos según de quién sea el grupo:
   *   - `grupos[]` — grupo propio del ítem de la línea (receta o combo).
   *   - `componentes[].grupos[]` — grupo de un componente receta del combo.
   *
   * El `grupoId` va **dentro** del mismo objeto que las opciones, no como una
   * condición aparte: containment exige que las dos claves caigan en el mismo
   * elemento del array, así que una opción elegida en el grupo G1 no matchea la
   * pregunta "esa opción dentro de G2". Verificado contra Postgres real.
   *
   * A diferencia de `cuentasAbiertasConExtra`, acá **no** hay `cl.item_id` que
   * acote —un grupo puede colgar de muchos ítems y cualquiera de ellos rompe—,
   * así que ésta sí se apoya en `idx_cuenta_lineas_personalizacion` (GIN).
   */
  async cuentasAbiertasConOpcionDeGrupo(
    manager: EntityManager | Db,
    tenantId: string,
    grupoId: string,
    opcionItemIds: string[],
  ): Promise<{ opcion: string; cuenta: string }[]> {
    if (!opcionItemIds.length) return [];
    return manager.query(
      `SELECT DISTINCT i.nombre AS opcion,
              m.nombre || ' · ' || COALESCE(c.nombre, 'cuenta ' || c.numero)
                AS cuenta
         FROM cuenta_lineas cl
         JOIN cuentas c ON c.cuenta_id = cl.cuenta_id
          AND c.tenant_id = $1 AND c.eliminado_el IS NULL
          AND c.estado = 'abierta'
         JOIN mesas m ON m.mesa_id = c.mesa_id
          AND m.tenant_id = $1 AND m.eliminado_el IS NULL
         CROSS JOIN LATERAL unnest($3::uuid[]) AS x(id)
         JOIN items i ON i.item_id = x.id
          AND i.tenant_id = $1 AND i.eliminado_el IS NULL
        WHERE cl.tenant_id = $1 AND cl.eliminado_el IS NULL
          AND (cl.personalizacion @> jsonb_build_object(
                 'grupos',
                 jsonb_build_array(jsonb_build_object(
                   'grupoId', $2::uuid,
                   'opciones',
                   jsonb_build_array(
                     jsonb_build_object('itemId', x.id)))))
            OR cl.personalizacion @> jsonb_build_object(
                 'componentes',
                 jsonb_build_array(jsonb_build_object(
                   'grupos',
                   jsonb_build_array(jsonb_build_object(
                     'grupoId', $2::uuid,
                     'opciones',
                     jsonb_build_array(
                       jsonb_build_object('itemId', x.id))))))))
        ORDER BY 1, 2`,
      [tenantId, grupoId, opcionItemIds],
    );
  }

  /**
   * ¿Qué cuentas **abiertas** eligieron alguno de estos grupos **en este ítem**?
   * La quinta puerta: `PATCH /items/:id` con `gruposModificadores` reescribe las
   * asociaciones y soft-borra las que desaparecen.
   *
   * **Lo que rompe no es siempre lo mismo**, y por eso el guard cubre las dos
   * (medido el 2026-08-30 sobre un combo real, con la línea valiendo 4500):
   *   - Si el grupo es del **ítem de la línea** (receta suelta o combo), la
   *     línea deja de poder tasarse siempre —conserve o no otros grupos vivos—:
   *     `resolverGruposDeItem` se llama sin condición y rechaza el `grupoId`
   *     que ya no está asociado ("Grupo de modificadores no asociado a este
   *     item") → 400, mesa incobrable. Lo mismo si es de un **componente** que
   *     conserva otros grupos vivos.
   *   - Si era el **último** grupo vivo de un componente de combo, no hay error:
   *     `resolverPersonalizacionCombo` hace `if (!catalogo.asociados.length)
   *     continue` y nunca consume lo elegido, así que la opción desaparece del
   *     snapshot y la mesa **paga de menos, en silencio** (4300 en la medición).
   *     El error grita; éste no, y es el peor de los dos.
   *
   * **Dos niveles otra vez, pero acotados distinto**, y ésa es la diferencia con
   * `cuentasAbiertasConOpcionDeGrupo`:
   *   - `grupos[]` — grupo propio del ítem de la línea. La cota va **afuera**,
   *     en `cl.item_id = $2`: el snapshot no repite ahí de quién es el grupo.
   *   - `componentes[].grupos[]` — grupo de un componente receta de un combo. La
   *     cota va **adentro** del containment, como `componenteItemId`, porque
   *     containment exige que las dos claves caigan en el mismo elemento del
   *     array. Verificado contra Postgres real: con dos componentes eligiendo
   *     grupos distintos, preguntar por (componente A, grupo de B) da `false`.
   *
   * Sin las dos cotas el guard bloquearía de más: un grupo cuelga de muchos
   * ítems, y desasociarlo de la Pizza no rompe la mesa que lo eligió en el Lomo.
   *
   * El `JOIN` a `grupos_modificadores` filtra `eliminado_el IS NULL` y eso
   * además es la semántica correcta: si el grupo ya está borrado, esa mesa ya
   * está rota por el borrado y bloquear la limpieza de la asociación muerta no
   * la salva.
   *
   * 📌 Con esta puerta cerrada, `DELETE /grupos-modificadores/:id` queda cubierto
   * **de arrastre**: ese borrado ya se rechaza si el grupo está asociado a algún
   * ítem vivo, y para que una mesa lo haya elegido tiene que estar asociado.
   *
   * ⚠️ Misma ventana de carrera que sus hermanas: lee sin lock y el `UPDATE` que
   * sigue borra.
   */
  private async cuentasAbiertasConGrupoElegido(
    manager: EntityManager | Db,
    tenantId: string,
    itemId: string,
    grupoIds: string[],
  ): Promise<{ grupo: string; cuenta: string }[]> {
    if (!grupoIds.length) return [];
    return manager.query(
      `SELECT DISTINCT g.nombre AS grupo,
              m.nombre || ' · ' || COALESCE(c.nombre, 'cuenta ' || c.numero)
                AS cuenta
         FROM cuenta_lineas cl
         JOIN cuentas c ON c.cuenta_id = cl.cuenta_id
          AND c.tenant_id = $1 AND c.eliminado_el IS NULL
          AND c.estado = 'abierta'
         JOIN mesas m ON m.mesa_id = c.mesa_id
          AND m.tenant_id = $1 AND m.eliminado_el IS NULL
         CROSS JOIN LATERAL unnest($3::uuid[]) AS x(id)
         JOIN grupos_modificadores g ON g.grupo_modificador_id = x.id
          AND g.tenant_id = $1 AND g.eliminado_el IS NULL
        WHERE cl.tenant_id = $1 AND cl.eliminado_el IS NULL
          AND ((cl.item_id = $2
                AND cl.personalizacion @> jsonb_build_object(
                      'grupos',
                      jsonb_build_array(
                        jsonb_build_object('grupoId', x.id))))
            OR cl.personalizacion @> jsonb_build_object(
                 'componentes',
                 jsonb_build_array(jsonb_build_object(
                   'componenteItemId', $2::uuid,
                   'grupos',
                   jsonb_build_array(
                     jsonb_build_object('grupoId', x.id))))))
        ORDER BY 1, 2`,
      [tenantId, itemId, grupoIds],
    );
  }

  async obtenerUso(tenantId: string, itemId: string): Promise<UsoItem> {
    const item = await this.itemRepo.findOne({
      where: { id: itemId, tenantId },
    });
    if (!item) throw new NotFoundException('Item no encontrado');

    return this.obtenerUsoItem(this.db, tenantId, itemId);
  }

  async remove(
    tenantId: string,
    usuarioId: string,
    itemId: string,
  ): Promise<void> {
    const item = await this.itemRepo.findOne({
      where: { id: itemId, tenantId },
    });
    if (!item) throw new NotFoundException('Item no encontrado');

    await this.db.transaccion(async (manager) => {
      const { bloqueos } = await this.obtenerUsoItem(manager, tenantId, itemId);

      // Mismo orden de prioridad que las tres queries que esto reemplaza: la
      // primera clase con coincidencias es la que arma el mensaje, y los textos
      // son los de siempre porque hay e2e que los afirman.
      // `cuenta` va primero a propósito: los otros tres son de catálogo y se
      // resuelven cuando el admin quiera, pero una cuenta abierta tiene a
      // alguien esperando en la mesa. Es el bloqueo accionable ahora.
      const etiquetas: [UsoItemTipo, string][] = [
        ['cuenta', 'está pedido en'],
        ['ingrediente', 'es ingrediente de'],
        ['combo', 'es componente de'],
        ['opcion', 'es opción de'],
      ];
      for (const [tipo, etiqueta] of etiquetas) {
        const nombres = bloqueos
          .filter((b) => b.tipo === tipo)
          .map((b) => b.nombre);
        if (nombres.length) {
          throw new BadRequestException(
            `No se puede eliminar: ${etiqueta} ${nombres.join(', ')}`,
          );
        }
      }

      // El item se va, pero las filas que lo ofrecen como extra quedarían vivas
      // apuntando a un muerto. Las lecturas ya las filtran por el JOIN, así que
      // esto es higiene referencial, no corrección.
      await manager.query(
        `UPDATE receta_extras_permitidos
         SET eliminado_el = NOW(), actualizado_el = NOW()
         WHERE ingrediente_item_id = $1 AND tenant_id = $2
           AND eliminado_el IS NULL`,
        [itemId, tenantId],
      );

      // Misma higiene en la otra dirección: si lo que se borra es la RECETA que
      // ofrece el extra (no el ingrediente), sus filas de
      // `receta_extras_permitidos` quedarían vivas apuntando a una receta muerta.
      await manager.query(
        `UPDATE receta_extras_permitidos
         SET eliminado_el = NOW(), actualizado_el = NOW()
         WHERE receta_item_id = $1 AND tenant_id = $2
           AND eliminado_el IS NULL`,
        [itemId, tenantId],
      );

      // `items` es el único de los 16 recursos de la papelera que pisa
      // `activo` al borrar: por eso es también el único que se restaura
      // inactivo (ver `restaurar()`, más abajo).
      //
      // `eliminado_el` se escribe con `NOW()` a secas, y eso ES el arreglo.
      //
      // Hasta el 2026-08-06 acá decía `NOW() AT TIME ZONE 'UTC'`, con razón:
      // `items.eliminado_el` era `timestamp` SIN zona y
      // `receta_extras_permitidos.eliminado_el` era `timestamptz`, así que
      // `restaurar()` comparaba tipos distintos y el cast anclaba los dos
      // lados a UTC a mano. Cuando el esquema se uniformó a `timestamptz`
      // (invariante en `common/invariants/timestamptz-columns.invariant.spec.ts`)
      // ese mismo cast **se dio vuelta**: sobre una columna con zona,
      // `NOW() AT TIME ZONE 'UTC'` devuelve un `timestamp` sin zona que
      // Postgres vuelve a castear al escribir, usando el `TimeZone` de la
      // sesión — el mecanismo exacto que el cast venía a evitar.
      // Medido contra Postgres real: con la sesión en `America/Santiago`, el
      // instante guardado quedaba **4 horas corrido** respecto de `NOW()`.
      // Hoy no explota porque la sesión es UTC, que es justo la coincidencia
      // de la que este código dice no querer depender.
      //
      // La moraleja para el próximo: un cast de zona horaria es una respuesta
      // al TIPO de la columna, no una verdad permanente. Si el tipo cambia,
      // el cast hay que releerlo, no conservarlo.
      await manager.query(
        `UPDATE items
            SET activo = false, eliminado_el = NOW(),
                eliminado_por = $3, actualizado_el = NOW()
          WHERE item_id = $1 AND tenant_id = $2`,
        [itemId, tenantId, usuarioId],
      );
    });
  }

  /**
   * Papelera: revierte el soft delete de `remove()`. El ítem vuelve
   * **inactivo** (nunca `activo: true`): `remove()` pisó `activo = false` y
   * el valor previo no sobrevivió en ninguna columna, así que reactivarlo es
   * un segundo gesto deliberado del usuario, no algo que `restaurar()` pueda
   * inferir.
   */
  async restaurar(tenantId: string, itemId: string) {
    // Una sola sentencia (CTEs encadenadas), y no dos `manager.query()`
    // pasando el timestamp por JS de por medio. Se probaron las dos formas
    // contra Postgres real:
    //
    // 1) Leer `eliminado_el` con un `RETURNING (SELECT …)` (el subquery SÍ
    //    ve el valor previo al UPDATE, por las reglas de visibilidad de
    //    Postgres: verificado con una transacción de prueba + ROLLBACK) y
    //    después usarlo como parámetro del segundo `UPDATE`. Esto se rompió
    //    en el e2e real: `timestamptz` en Postgres tiene precisión de
    //    microsegundos, pero el driver `pg` lo mapea a un `Date` de JS —que
    //    solo tiene milisegundos—, así que el valor que vuelve a entrar como
    //    parámetro ya perdió precisión y el `WHERE eliminado_el = $N` no
    //    matchea NUNCA con el valor real guardado. El colateral no revivía
    //    ni una fila.
    // 2) La de abajo: la CTE `extras` referencia `eliminado_el_previo` de la
    //    CTE `restaurado` con un subquery **dentro del mismo SQL**, así que
    //    el timestamp nunca sale de Postgres ni pierde precisión. Verificado
    //    contra Postgres real (e2e con receta + extra + un borrado previo de
    //    otro motivo): revive solo la fila del borrado actual.
    //
    // Hubo un segundo fallo silencioso acá, del mismo molde pero por zonas
    // horarias, y **se cerró en la raíz el 2026-08-06**: `items.eliminado_el`
    // era `timestamp` SIN zona (default de `@DeleteDateColumn()` sin `type`)
    // y `receta_extras_permitidos.eliminado_el` era `timestamptz`, así que
    // compararlos dejaba que Postgres casteara el lado sin zona usando el
    // `TimeZone` de la SESIÓN que compara — no el que estaba activo al
    // escribir. Medido con `SET TimeZone` en sesiones separadas: matcheaba
    // 1 de 3 combinaciones. El parche era anclar los dos lados a UTC a mano
    // (`AT TIME ZONE 'UTC'` acá y en `remove()`).
    //
    // Ese parche ya no está, y sacarlo fue el arreglo: con las dos columnas
    // en `timestamptz` la comparación es entre iguales y no depende de
    // ninguna sesión. Dejarlo habría sido peor que no haberlo puesto nunca —
    // sobre una columna con zona, `AT TIME ZONE 'UTC'` la convierte a un
    // `timestamp` sin zona que Postgres re-castea con el `TimeZone` de
    // sesión. Medido: con la sesión en `America/Santiago`, 4 horas de
    // corrimiento. El invariante que impide que el esquema vuelva a
    // desalinearse vive en
    // `common/invariants/timestamptz-columns.invariant.spec.ts` y en
    // `test/esquema.e2e-spec.ts`.
    //
    // La CTE `extras` de abajo revive solo las filas de
    // `receta_extras_permitidos` que ESTE mismo borrado se llevó, acotando
    // por el timestamp exacto que `remove()` les puso: una fila borrada
    // antes por otro motivo tiene otro `eliminado_el` y no revive. Si
    // `restaurado` viene vacío (ítem que no estaba en la papelera), el
    // subquery da NULL y `eliminado_el = NULL` no matchea nada — no-op
    // seguro.
    //
    // `AND eliminado_por IS NOT NULL`: decisión del owner — la papelera solo
    // restaura lo que borró una persona. Un ítem borrado por el sistema
    // (`eliminado_por IS NULL`) da el mismo 404 "no está en la papelera" que
    // uno que nunca existió, sin rama especial (docs/features/papelera.md).
    const rows = unwrap<{ item_id: string }>(
      await this.db.query(
        `WITH restaurado AS (
           UPDATE items
              SET eliminado_el = NULL, eliminado_por = NULL,
                  actualizado_el = NOW()
            WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NOT NULL
              AND eliminado_por IS NOT NULL
           RETURNING item_id,
                     (SELECT eliminado_el FROM items
                        WHERE item_id = $1 AND tenant_id = $2) AS eliminado_el_previo
         ),
         extras AS (
           UPDATE receta_extras_permitidos
              SET eliminado_el = NULL, actualizado_el = NOW()
            WHERE tenant_id = $2
              AND eliminado_el = (SELECT eliminado_el_previo FROM restaurado)
              AND (ingrediente_item_id = $1 OR receta_item_id = $1)
           RETURNING 1
         )
         SELECT item_id FROM restaurado`,
        [itemId, tenantId],
      ),
    );
    if (!rows.length) {
      throw new NotFoundException(`Item ${itemId} no está en la papelera`);
    }

    // Una sola sentencia ya commiteada (sin transacción explícita) antes de
    // llegar acá: `findOne` ve el estado final sin ventanas de visibilidad
    // entre conexiones.
    return this.findOne(tenantId, itemId);
  }

  async ajustarStock(
    tenantId: string,
    usuarioId: string,
    itemId: string,
    dto: AjusteStockDto,
  ) {
    return this.db.transaccion(async (manager) => {
      const itemRows: { tipo: string }[] = await manager.query(
        `SELECT tipo FROM items
         WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [itemId, tenantId],
      );
      if (!itemRows.length) throw new NotFoundException('Item no encontrado');
      if (
        itemRows[0].tipo !== 'producto' &&
        itemRows[0].tipo !== 'ingrediente'
      ) {
        throw new BadRequestException('El item no es inventariable');
      }

      // La conversión ocurre acá y no en registrarMovimiento: el kardex siempre
      // guarda la unidad base del producto, así que no necesita saber de unidades.
      let cantidad = new Decimal(dto.cantidad).toString();
      // costoUnitario significa "costo por la unidad ingresada", no por la
      // unidad base: si hay conversión de cantidad, el costo se convierte
      // junto con ella preservando el valor total (cantidadIngresada ×
      // costoUnitario == cantidadBase × costoBase).
      let costoUnitario: string | null = dto.costoUnitario ?? null;
      if (dto.unidadCodigo) {
        const prodRows: { unidad_medida: string; modo_inventario: string }[] =
          await manager.query(
            `SELECT unidad_medida, modo_inventario FROM item_producto WHERE item_id = $1 FOR UPDATE`,
            [itemId],
          );
        const unidadBase = prodRows[0]?.unidad_medida;
        if (dto.unidadCodigo !== unidadBase) {
          if (prodRows[0]?.modo_inventario !== 'cantidad') {
            throw new BadRequestException(
              'Los productos por serie o lote solo admiten su unidad base',
            );
          }
          const cantidadIngresada = cantidad;
          cantidad = await this.catalogService.convertirUnidad(
            cantidad,
            dto.unidadCodigo,
            unidadBase,
          );
          if (costoUnitario != null) {
            const costoTipeado = costoUnitario;
            costoUnitario = convertirCostoUnitario(
              cantidadIngresada,
              costoUnitario,
              cantidad,
            );
            // El 0 TIPEADO pasa —es el caso que se habilitó—; lo que rebota es
            // el costo positivo que se pierde en la conversión.
            assertCostoNoColapsaACero(
              costoTipeado,
              costoUnitario,
              unidadBase ?? 'unidad',
            );
          }
        }
      }

      const { stockResultante, costoActual } =
        await this.inventarioService.registrarMovimiento(manager, {
          tenantId,
          itemId,
          usuarioId,
          tipo: dto.tipo,
          motivo: dto.motivo,
          cantidad,
          comentario: dto.comentario ?? null,
          series: dto.series,
          unidadIds: dto.unidadIds,
          lote: dto.lote,
          loteId: dto.loteId,
          costoUnitario,
        });

      return { stock: stockResultante, costoActual };
    });
  }

  async findUnidades(tenantId: string, itemId: string, estado?: string) {
    const rows: {
      unidad_id: string;
      serie: string;
      estado: string;
      condicion: string;
      garantia_hasta: Date | null;
      lote_id: string | null;
      codigo_lote: string | null;
      venta_id: string | null;
      creado_el: Date;
    }[] = await this.db.query(
      `SELECT
         u.unidad_id, u.serie, u.estado, u.condicion, u.garantia_hasta,
         u.lote_id, l.codigo_lote, u.venta_id, u.creado_el
       FROM item_unidad u
       LEFT JOIN item_lote l ON l.lote_id = u.lote_id AND l.eliminado_el IS NULL
       WHERE u.item_id = $1 AND u.tenant_id = $2 AND u.eliminado_el IS NULL
         ${estado ? 'AND u.estado = $3' : ''}
       ORDER BY u.creado_el DESC`,
      estado ? [itemId, tenantId, estado] : [itemId, tenantId],
    );

    return rows.map((r) => ({
      id: r.unidad_id,
      serie: r.serie,
      estado: r.estado,
      condicion: r.condicion,
      garantiaHasta: r.garantia_hasta,
      loteId: r.lote_id,
      codigoLote: r.codigo_lote,
      ventaId: r.venta_id,
      creadoEl: r.creado_el,
    }));
  }

  async findLotes(tenantId: string, itemId: string) {
    const rows: {
      lote_id: string;
      codigo_lote: string;
      fecha_elaboracion: Date | null;
      fecha_vencimiento: Date | null;
      cantidad_inicial: string;
      cantidad_disponible: string;
      creado_el: Date;
    }[] = await this.db.query(
      `SELECT
         lote_id, codigo_lote, fecha_elaboracion, fecha_vencimiento,
         cantidad_inicial, cantidad_disponible, creado_el
       FROM item_lote
       WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
       ORDER BY creado_el DESC`,
      [itemId, tenantId],
    );

    return rows.map((r) => ({
      id: r.lote_id,
      codigoLote: r.codigo_lote,
      fechaElaboracion: r.fecha_elaboracion,
      fechaVencimiento: r.fecha_vencimiento,
      cantidadInicial: r.cantidad_inicial,
      cantidadDisponible: r.cantidad_disponible,
      creadoEl: r.creado_el,
    }));
  }

  /**
   * Los ingredientes de VARIAS recetas en una consulta.
   *
   * Existe porque los tres catálogos que necesita `resolverPersonalizacionReceta`
   * son **por ítem, no por línea** (`(tenantId, itemId)` y nada más), así que
   * resolver las N líneas de un carrito los releía N veces. `calcular()` los
   * precarga de una y se los pasa por `precargado`. La versión de un solo id
   * quedó como envoltorio: una sola SQL, no dos que se puedan ir separando.
   */
  async obtenerIngredientesRecetaPorIds(
    manager: EntityManager | Db,
    tenantId: string,
    recetaItemIds: string[],
  ): Promise<Map<string, IngredienteReceta[]>> {
    const ids = [...new Set(recetaItemIds)];
    // Clave para TODO id pedido, aunque no tenga filas — ver
    // `obtenerComponentesComboPorIds`.
    const porReceta = new Map<string, IngredienteReceta[]>(
      ids.map((id) => [id, []]),
    );
    if (!ids.length) return porReceta;

    const rows: {
      receta_item_id: string;
      ingrediente_item_id: string;
      ingrediente_nombre: string;
      ingrediente_unidad_medida: string;
      cantidad: string;
      unidad_codigo: string;
      bloqueante: boolean;
    }[] = await manager.query(
      `SELECT ri.receta_item_id, ri.ingrediente_item_id, i.nombre AS ingrediente_nombre,
              ip.unidad_medida AS ingrediente_unidad_medida,
              ri.cantidad, ri.unidad_codigo, ri.bloqueante
       FROM receta_ingredientes ri
       JOIN items i ON i.item_id = ri.ingrediente_item_id AND i.eliminado_el IS NULL
       JOIN item_producto ip ON ip.item_id = ri.ingrediente_item_id
       WHERE ri.receta_item_id = ANY($1::uuid[]) AND ri.tenant_id = $2 AND ri.eliminado_el IS NULL
       ORDER BY ri.receta_item_id, ri.ingrediente_item_id`,
      [ids, tenantId],
    );
    for (const r of rows) {
      const lista = porReceta.get(r.receta_item_id) ?? [];
      lista.push({
        ingredienteItemId: r.ingrediente_item_id,
        ingredienteNombre: r.ingrediente_nombre,
        ingredienteUnidadMedida: r.ingrediente_unidad_medida,
        cantidad: r.cantidad,
        unidadCodigo: r.unidad_codigo,
        bloqueante: r.bloqueante,
      });
      porReceta.set(r.receta_item_id, lista);
    }
    return porReceta;
  }

  async obtenerIngredientesReceta(
    manager: EntityManager | Db,
    tenantId: string,
    recetaItemId: string,
  ): Promise<IngredienteReceta[]> {
    // Se aplanan todos los grupos en vez de pedir `.get(recetaItemId)`: la
    // consulta lleva un solo id en el `ANY`, así que toda fila que vuelve es de
    // esa receta. Depender de la clave haría que este método devolviera vacío el
    // día que el `SELECT` deje de proyectar la columna del agrupamiento, que es
    // un detalle del lote y no del contrato de acá.
    return [
      ...(
        await this.obtenerIngredientesRecetaPorIds(manager, tenantId, [
          recetaItemId,
        ])
      ).values(),
    ].flat();
  }

  /** Los extras permitidos de VARIAS recetas en una consulta. Ver
   *  `obtenerIngredientesRecetaPorIds` para el porqué. */
  async obtenerExtrasPermitidosPorIds(
    manager: EntityManager | Db,
    tenantId: string,
    recetaItemIds: string[],
  ): Promise<Map<string, ExtraPermitido[]>> {
    const ids = [...new Set(recetaItemIds)];
    // Clave para TODO id pedido, aunque no tenga filas — ver
    // `obtenerComponentesComboPorIds`.
    const porReceta = new Map<string, ExtraPermitido[]>(
      ids.map((id) => [id, []]),
    );
    if (!ids.length) return porReceta;

    const rows: {
      receta_item_id: string;
      ingrediente_item_id: string;
      ingrediente_nombre: string;
      ingrediente_unidad_medida: string;
      cantidad: string;
      unidad_codigo: string;
      precio_extra: string;
    }[] = await manager.query(
      `SELECT re.receta_item_id, re.ingrediente_item_id, i.nombre AS ingrediente_nombre,
              ip.unidad_medida AS ingrediente_unidad_medida,
              re.cantidad, re.unidad_codigo, re.precio_extra
       FROM receta_extras_permitidos re
       JOIN items i ON i.item_id = re.ingrediente_item_id AND i.eliminado_el IS NULL
       JOIN item_producto ip ON ip.item_id = re.ingrediente_item_id
       WHERE re.receta_item_id = ANY($1::uuid[]) AND re.tenant_id = $2 AND re.eliminado_el IS NULL`,
      [ids, tenantId],
    );
    for (const r of rows) {
      const lista = porReceta.get(r.receta_item_id) ?? [];
      lista.push({
        ingredienteItemId: r.ingrediente_item_id,
        ingredienteNombre: r.ingrediente_nombre,
        ingredienteUnidadMedida: r.ingrediente_unidad_medida,
        cantidad: r.cantidad,
        unidadCodigo: r.unidad_codigo,
        precioExtra: r.precio_extra,
      });
      porReceta.set(r.receta_item_id, lista);
    }
    return porReceta;
  }

  async obtenerExtrasPermitidos(
    manager: EntityManager | Db,
    tenantId: string,
    recetaItemId: string,
  ): Promise<ExtraPermitido[]> {
    // Se aplanan todos los grupos en vez de pedir `.get(recetaItemId)`: la
    // consulta lleva un solo id en el `ANY`, así que toda fila que vuelve es de
    // esa receta. Depender de la clave haría que este método devolviera vacío el
    // día que el `SELECT` deje de proyectar la columna del agrupamiento, que es
    // un detalle del lote y no del contrato de acá.
    return [
      ...(
        await this.obtenerExtrasPermitidosPorIds(manager, tenantId, [
          recetaItemId,
        ])
      ).values(),
    ].flat();
  }

  /** Los componentes receta de VARIOS combos en una consulta. */
  async obtenerComponentesComboPorIds(
    manager: EntityManager | Db,
    tenantId: string,
    comboItemIds: string[],
  ): Promise<Map<string, ComponenteCombo[]>> {
    const ids = [...new Set(comboItemIds)];
    // Clave para TODO id pedido, aunque no tenga filas. Sin esto un ítem sin
    // componentes no queda en el mapa, el `??` del llamador cae al método de un
    // solo id y vuelve la consulta por línea que este lote vino a matar — y el
    // caso "sin filas" no es raro: el seed no siembra una sola fila de
    // `receta_extras_permitidos`. Mismo criterio que `cargarCatalogoGrupos`.
    const porCombo = new Map<string, ComponenteCombo[]>(
      ids.map((id) => [id, []]),
    );
    if (!ids.length) return porCombo;

    const rows: (ComponenteCombo & { combo_item_id: string })[] =
      await manager.query(
        `SELECT cc.combo_item_id, cc.componente_item_id, i.nombre, cc.cantidad
       FROM combo_componentes cc
       JOIN items i ON i.item_id = cc.componente_item_id AND i.eliminado_el IS NULL
       WHERE cc.combo_item_id = ANY($1::uuid[]) AND cc.tenant_id = $2
         AND cc.eliminado_el IS NULL AND i.tipo = 'receta'`,
        [ids, tenantId],
      );
    for (const r of rows) {
      const lista = porCombo.get(r.combo_item_id) ?? [];
      lista.push({
        componente_item_id: r.componente_item_id,
        nombre: r.nombre,
        cantidad: r.cantidad,
      });
      porCombo.set(r.combo_item_id, lista);
    }
    return porCombo;
  }

  /**
   * Precarga, en **dos a cinco consultas que no crecen con la cantidad de
   * líneas**, todo lo que
   * `resolverPersonalizacionReceta` y `…Combo` leerían por su cuenta una vez por
   * llamada.
   *
   * Existe porque esos catálogos son **por ítem, no por línea**: las tres
   * consultas que dispara resolver una personalización toman `(tenantId, itemId)`
   * y nada de la línea. Resolver las N líneas de un carrito las repetía N veces,
   * y `POST /calculo-precios/calcular` corre en cada recálculo del carrito o de
   * la cuenta (debounce de 300 ms), no una vez por venta.
   *
   * El rango sale de qué hay en el carrito: `combo_componentes` solo si hay
   * combos, ingredientes y extras solo si hay recetas, y `cargarCatalogoGrupos`
   * son **una o dos** —corta después de las asociaciones si nadie tiene grupos—.
   * O sea que los números son techos, no valores: solo recetas ≤ 4, solo combos
   * ≤ 3, mezcla ≤ 5, y el piso es 2 (combos sin grupos asociados).
   *
   * Los componentes van primero porque los grupos de un combo incluyen los de
   * sus **componentes**: hay que saber quiénes son antes de pedirlos.
   */
  async cargarCatalogosPersonalizacion(
    manager: EntityManager | Db,
    tenantId: string,
    items: { itemId: string; tipo: string }[],
  ): Promise<CatalogosPersonalizacion> {
    const recetaIds = items
      .filter((i) => i.tipo === 'receta')
      .map((i) => i.itemId);
    const comboIds = items
      .filter((i) => i.tipo === 'combo')
      .map((i) => i.itemId);

    const componentesCombo = await this.obtenerComponentesComboPorIds(
      manager,
      tenantId,
      comboIds,
    );
    const componenteIds = [...componentesCombo.values()]
      .flat()
      .map((c) => c.componente_item_id);

    // Secuenciales por el mismo motivo que el resto del módulo: dentro de una
    // transacción comparten el `pg.Client` del contexto ALS y un `Promise.all`
    // las encolaría igual (en `pg@9` la segunda tira). Ver ADR-020.
    const ingredientes = await this.obtenerIngredientesRecetaPorIds(
      manager,
      tenantId,
      recetaIds,
    );
    const extras = await this.obtenerExtrasPermitidosPorIds(
      manager,
      tenantId,
      recetaIds,
    );
    const grupos = await this.cargarCatalogoGrupos(manager, tenantId, [
      ...recetaIds,
      ...comboIds,
      ...componenteIds,
    ]);

    return { ingredientes, extras, grupos, componentesCombo };
  }

  async resolverPersonalizacionReceta(
    manager: EntityManager | Db,
    tenantId: string,
    recetaItemId: string,
    dto?: PersonalizacionRecetaDto,
    /** Catálogos ya cargados por lote. Si vienen, este método no lee la base
     *  salvo lo que `resolverGruposDeItem` necesite y no esté acá. */
    precargado?: CatalogosPersonalizacion,
  ): Promise<{
    snapshot: PersonalizacionRecetaSnapshot;
    precioExtraTotal: string;
  }> {
    const omitidos = dto?.omitidos ?? [];
    if (omitidos.length !== new Set(omitidos).size) {
      throw new BadRequestException(
        'Ingrediente omitido duplicado en la personalización',
      );
    }

    const extraIds = (dto?.extras ?? []).map((e) => e.ingredienteItemId);
    if (extraIds.length !== new Set(extraIds).size) {
      throw new BadRequestException('Extra duplicado en la personalización');
    }

    const ingredientes =
      precargado?.ingredientes.get(recetaItemId) ??
      (await this.obtenerIngredientesReceta(manager, tenantId, recetaItemId));
    const extrasCat =
      precargado?.extras.get(recetaItemId) ??
      (await this.obtenerExtrasPermitidos(manager, tenantId, recetaItemId));

    for (const id of dto?.omitidos ?? []) {
      if (!ingredientes.some((i) => i.ingredienteItemId === id)) {
        throw new BadRequestException(
          'Ingrediente omitido no pertenece a la receta',
        );
      }
    }

    const extrasResolved: PersonalizacionRecetaSnapshot['extras'] = [];
    let precioExtraTotal = new Decimal(0);
    for (const e of dto?.extras ?? []) {
      const cat = extrasCat.find(
        (x) => x.ingredienteItemId === e.ingredienteItemId,
      );
      if (!cat) {
        throw new BadRequestException('Extra no permitido para esta receta');
      }
      const unidades = new Decimal(e.unidades ?? 1);
      if (unidades.lt(1) || !unidades.isInteger()) {
        throw new BadRequestException(
          'Las unidades del extra deben ser un entero mayor o igual a 1',
        );
      }
      extrasResolved.push({
        ingredienteItemId: cat.ingredienteItemId,
        cantidad: cat.cantidad,
        unidadCodigo: cat.unidadCodigo,
        precioExtra: cat.precioExtra,
        unidades: unidades.toString(),
      });
      precioExtraTotal = precioExtraTotal.plus(
        new Decimal(cat.precioExtra).mul(unidades),
      );
    }

    const gruposResueltos = await this.resolverGruposDeItem(
      manager,
      tenantId,
      recetaItemId,
      dto?.grupos,
      precargado?.grupos.get(recetaItemId),
    );
    const precioExtraTotalFinal = precioExtraTotal.plus(
      gruposResueltos.precioExtraTotal,
    );

    return {
      snapshot: {
        omitidos: [...(dto?.omitidos ?? [])],
        extras: extrasResolved,
        comentario: dto?.comentario?.trim() || undefined,
        ...(gruposResueltos.grupos.length
          ? { grupos: gruposResueltos.grupos }
          : {}),
      },
      precioExtraTotal: precioExtraTotalFinal.toFixed(4),
    };
  }

  /**
   * Catálogo de grupos + opciones de N items, en **dos** consultas fijas: una
   * por los grupos asociados y otra por las opciones de todos esos grupos. El
   * costo no crece con la cantidad de items ni con las veces que se resuelva
   * cada uno.
   */
  private async cargarCatalogoGrupos(
    manager: EntityManager | Db,
    tenantId: string,
    itemIds: string[],
  ): Promise<Map<string, CatalogoGrupos>> {
    const ids = [...new Set(itemIds)];
    const catalogo = new Map<string, CatalogoGrupos>(
      ids.map((id) => [id, { asociados: [], opcionesPorGrupo: new Map() }]),
    );
    if (!ids.length) return catalogo;

    const asociados: ({
      item_id: string;
    } & CatalogoGrupos['asociados'][number])[] = await manager.query(
      `SELECT igm.item_id, igm.grupo_modificador_id, igm.item_grupo_id, g.nombre, igm.min, igm.max
       FROM item_grupos_modificadores igm
       JOIN grupos_modificadores g ON g.grupo_modificador_id = igm.grupo_modificador_id
         AND g.eliminado_el IS NULL
       WHERE igm.item_id = ANY($1) AND igm.tenant_id = $2 AND igm.eliminado_el IS NULL`,
      [ids, tenantId],
    );
    for (const a of asociados) catalogo.get(a.item_id)?.asociados.push(a);
    if (!asociados.length) return catalogo;

    // Opciones de TODOS los grupos asociados en una sola query. El override
    // (`item_grupo_modificador_opciones`) es por par grupo↔item_grupo, así que
    // los pares viajan como dos arrays paralelos y se unen con `unnest`: usar
    // `item_grupo_id = ANY(...)` traería el override de otro grupo.
    // `item_grupo_id` vuelve en el SELECT porque es lo único que devuelve cada
    // fila a SU item: dos items distintos pueden compartir grupo, y entonces
    // `grupo_modificador_id` solo ya no alcanza para repartirlas.
    const filas: {
      grupo_modificador_id: string;
      item_grupo_id: string;
      item_id: string;
      nombre: string;
      cantidad: string | null;
      unidad_codigo: string | null;
      precio_extra: string;
    }[] = await manager.query(
      `SELECT a.grupo_modificador_id, a.item_grupo_id, o.item_id, i.nombre,
              COALESCE(ovr.cantidad, o.cantidad) AS cantidad,
              COALESCE(ovr.unidad_codigo, o.unidad_codigo) AS unidad_codigo,
              COALESCE(ovr.precio_extra, o.precio_extra) AS precio_extra
       FROM unnest($2::uuid[], $3::uuid[])
              AS a(grupo_modificador_id, item_grupo_id)
       JOIN grupo_modificador_opciones o
         ON o.grupo_modificador_id = a.grupo_modificador_id
        AND o.tenant_id = $1
        AND o.eliminado_el IS NULL
       JOIN items i ON i.item_id = o.item_id AND i.eliminado_el IS NULL
       LEFT JOIN item_grupo_modificador_opciones ovr
         ON ovr.grupo_opcion_id = o.grupo_opcion_id
        AND ovr.item_grupo_id = a.item_grupo_id
        AND ovr.eliminado_el IS NULL`,
      [
        tenantId,
        asociados.map((a) => a.grupo_modificador_id),
        asociados.map((a) => a.item_grupo_id),
      ],
    );

    const itemPorItemGrupo = new Map(
      asociados.map((a) => [a.item_grupo_id, a.item_id]),
    );
    for (const o of filas) {
      const cat = catalogo.get(itemPorItemGrupo.get(o.item_grupo_id) ?? '');
      if (!cat) continue;
      const lista = cat.opcionesPorGrupo.get(o.grupo_modificador_id) ?? [];
      lista.push(o);
      cat.opcionesPorGrupo.set(o.grupo_modificador_id, lista);
    }
    return catalogo;
  }

  /**
   * Resuelve y congela la selección de grupos de modificadores de un item
   * (receta o combo): valida que cada opción elegida pertenezca al grupo,
   * que la suma de unidades elegidas por grupo esté entre min y max, y
   * calcula el recargo total (Σ precioExtra × unidades).
   *
   * @param catalogoPrecargado El de ESTE `itemId`. Si viene, no se lee la base.
   */
  async resolverGruposDeItem(
    manager: EntityManager | Db,
    tenantId: string,
    itemId: string,
    gruposDto: PersonalizacionGrupoInputDto[] | undefined,
    catalogoPrecargado?: CatalogoGrupos,
  ): Promise<{ grupos: SnapshotGrupo[]; precioExtraTotal: string }> {
    // El catálogo llega precargado cuando el llamador ya lo pidió por lote
    // (`resolverPersonalizacionCombo`, que resuelve una elección por unidad de
    // cada componente). Sin él, se carga acá para este item: mismo par de
    // consultas de siempre, movidas al helper.
    const { asociados, opcionesPorGrupo } =
      catalogoPrecargado ??
      (await this.cargarCatalogoGrupos(manager, tenantId, [itemId])).get(
        itemId,
      )!;

    const elegidosPorGrupo = new Map(
      (gruposDto ?? []).map((g) => [g.grupoId, g.opciones]),
    );
    // No permitir grupos elegidos que no están asociados al item.
    for (const g of gruposDto ?? []) {
      if (!asociados.some((a) => a.grupo_modificador_id === g.grupoId)) {
        throw new BadRequestException(
          'Grupo de modificadores no asociado a este item',
        );
      }
    }

    const snapshotGrupos: SnapshotGrupo[] = [];
    let precioExtraTotal = new Decimal(0);

    for (const asoc of asociados) {
      const opcionesCat = opcionesPorGrupo.get(asoc.grupo_modificador_id) ?? [];

      const elegidas = elegidosPorGrupo.get(asoc.grupo_modificador_id) ?? [];
      let totalUnidades = new Decimal(0);
      const opcionesSnap: SnapshotGrupo['opciones'] = [];
      for (const el of elegidas) {
        const cat = opcionesCat.find((o) => o.item_id === el.itemId);
        if (!cat) {
          throw new BadRequestException(
            `La opción ${el.itemId} no pertenece al grupo ${asoc.nombre}`,
          );
        }
        if (cat.cantidad == null) {
          throw new BadRequestException(
            `La opción "${cat.nombre}" no tiene cantidad configurada para este item (pendiente)`,
          );
        }
        const unidades = new Decimal(el.unidades ?? 1);
        if (unidades.lt(1) || !unidades.isInteger()) {
          throw new BadRequestException(
            'Las unidades de la opción deben ser un entero ≥ 1',
          );
        }
        totalUnidades = totalUnidades.plus(unidades);
        opcionesSnap.push({
          itemId: cat.item_id,
          nombre: cat.nombre,
          cantidad: cat.cantidad,
          unidadCodigo: cat.unidad_codigo ?? undefined,
          precioExtra: cat.precio_extra,
          unidades: unidades.toString(),
        });
        precioExtraTotal = precioExtraTotal.plus(
          new Decimal(cat.precio_extra).mul(unidades),
        );
      }

      if (totalUnidades.lt(asoc.min) || totalUnidades.gt(asoc.max)) {
        throw new BadRequestException(
          `El grupo "${asoc.nombre}" requiere elegir entre ${asoc.min} y ${asoc.max} unidades`,
        );
      }

      // Solo se congela el grupo si hay opciones elegidas (min=0 puede venir vacío).
      if (opcionesSnap.length) {
        snapshotGrupos.push({
          grupoId: asoc.grupo_modificador_id,
          grupoNombre: asoc.nombre,
          opciones: opcionesSnap,
        });
      }
    }

    return {
      grupos: snapshotGrupos,
      precioExtraTotal: precioExtraTotal.toFixed(4),
    };
  }

  /**
   * Resuelve la personalización de un combo: solo admite grupos de
   * modificadores (sin ingredientes/extras, esos son propios de receta).
   */
  async resolverPersonalizacionCombo(
    manager: EntityManager | Db,
    tenantId: string,
    comboItemId: string,
    dto?: PersonalizacionRecetaDto,
    /** Ver `resolverPersonalizacionReceta`. */
    precargado?: CatalogosPersonalizacion,
  ): Promise<{
    snapshot: PersonalizacionRecetaSnapshot;
    precioExtraTotal: string;
  }> {
    // 1. Componentes receta del combo con sus cantidades (para validar
    //    pertenencia y rango de unidad, y saber cuántas unidades esperar).
    const compRows: ComponenteCombo[] =
      precargado?.componentesCombo.get(comboItemId) ??
      (
        await this.obtenerComponentesComboPorIds(manager, tenantId, [
          comboItemId,
        ])
      ).get(comboItemId) ??
      [];
    const compById = new Map(compRows.map((c) => [c.componente_item_id, c]));

    // 2. El catálogo de grupos del combo Y de sus componentes receta, de una.
    //    Antes esto eran dos cosas distintas: un `SELECT DISTINCT` para saber
    //    quién tenía grupos, y después el catálogo releído entero una vez por
    //    (componente × unidad). El lote contesta las dos con dos consultas
    //    fijas: quien no aparece con grupos asociados, no tiene.
    const recetaIds = compRows.map((c) => c.componente_item_id);
    // El precargado se usa **solo si trae a todos** los que hacen falta. La
    // asimetría con los otros tres importa: acá un miss no cuesta una consulta,
    // cuesta PLATA — `catalogoDe` devolvería catálogo vacío, el `continue` de
    // más abajo saltearía los grupos de ese componente y el combo se cobraría
    // más barato, sin excepción ni advertencia. Ante la duda se relee.
    //
    // ⚠️ **Hoy este `every` no puede dar false por el camino de la app**: el
    // único productor de `CatalogosPersonalizacion` es
    // `cargarCatalogosPersonalizacion`, que carga los grupos de los combos **y**
    // de sus componentes. Es defensa contra un SEGUNDO productor que precargue
    // de menos, y lo fija un test que arma el catálogo mutilado a mano
    // (`items.service.spec.ts`, *"con un precargado al que le falta un
    // componente…"*): sin el `every`, ese test cobra 0 en vez de 1500.
    const idsDeGrupos = [comboItemId, ...recetaIds];
    const catalogos =
      precargado && idsDeGrupos.every((id) => precargado.grupos.has(id))
        ? precargado.grupos
        : await this.cargarCatalogoGrupos(manager, tenantId, idsDeGrupos);
    const catalogoDe = (itemId: string): CatalogoGrupos =>
      catalogos.get(itemId) ?? { asociados: [], opcionesPorGrupo: new Map() };

    // 3. Grupos propios del combo. Va antes de validar `componentes` porque un
    //    `grupoId` propio inválido tiene que seguir tirando primero.
    const propios = await this.resolverGruposDeItem(
      manager,
      tenantId,
      comboItemId,
      dto?.grupos,
      catalogoDe(comboItemId),
    );
    let precioExtraTotal = new Decimal(propios.precioExtraTotal);

    // 4. Validar las entradas que mandó el front: componente vivo + unidad en rango + sin duplicar.
    const elegidasPorClave = new Map<string, PersonalizacionGrupoInputDto[]>();
    for (const c of dto?.componentes ?? []) {
      const comp = compById.get(c.componenteItemId);
      if (!comp) {
        throw new BadRequestException(
          'El componente no pertenece a este combo o no admite grupos',
        );
      }
      if (
        !Number.isInteger(c.unidad) ||
        c.unidad < 1 ||
        new Decimal(comp.cantidad).lt(c.unidad)
      ) {
        throw new BadRequestException(
          `Unidad inválida para el componente ${comp.nombre}`,
        );
      }
      const clave = `${c.componenteItemId}#${c.unidad}`;
      if (elegidasPorClave.has(clave)) {
        throw new BadRequestException(
          `Unidad ${c.unidad} duplicada para el componente ${comp.nombre}`,
        );
      }
      elegidasPorClave.set(clave, c.grupos);
    }

    // 5. Resolver TODA (componente con grupos, unidad) esperada — aunque el
    //    front la haya omitido — para que un grupo obligatorio sin elección
    //    dispare la validación de min dentro de resolverGruposDeItem.
    const componentesSnap: NonNullable<
      PersonalizacionRecetaSnapshot['componentes']
    > = [];
    for (const comp of compRows) {
      const catalogo = catalogoDe(comp.componente_item_id);
      if (!catalogo.asociados.length) continue;
      const unidades = new Decimal(comp.cantidad).toNumber();
      for (let u = 1; u <= unidades; u++) {
        const grupos = elegidasPorClave.get(`${comp.componente_item_id}#${u}`);
        const resuelto = await this.resolverGruposDeItem(
          manager,
          tenantId,
          comp.componente_item_id,
          grupos,
          catalogo,
        );
        precioExtraTotal = precioExtraTotal.plus(resuelto.precioExtraTotal);
        if (resuelto.grupos.length) {
          componentesSnap.push({
            componenteItemId: comp.componente_item_id,
            componenteNombre: comp.nombre,
            unidad: u,
            grupos: resuelto.grupos,
          });
        }
      }
    }

    return {
      snapshot: {
        omitidos: [],
        extras: [],
        comentario: dto?.comentario?.trim() || undefined,
        grupos: propios.grupos.length ? propios.grupos : undefined,
        componentes: componentesSnap.length ? componentesSnap : undefined,
      },
      precioExtraTotal: precioExtraTotal.toFixed(4),
    };
  }

  async obtenerStockProducto(
    manager: EntityManager,
    itemId: string,
  ): Promise<string> {
    const rows: { stock: string }[] = await manager.query(
      `SELECT stock FROM item_producto WHERE item_id = $1`,
      [itemId],
    );
    return rows[0]?.stock ?? '0';
  }

  /**
   * Nombre y unidad de STOCK de los ingredientes que un snapshot usa como
   * extra. La unidad es propiedad del ingrediente (`item_producto.unidad_medida`),
   * no de la lista de extras de la receta — ver el porqué largo en
   * `expandirIngredientesPersonalizados`.
   *
   * Vive aparte porque la piden los dos caminos de expansión: el que **escribe**
   * movimientos (`venderIngredientesReceta`, un id de receta por llamada) y el
   * que solo **pregunta** (`consumoDeLineas`, todos los extras del carrito en
   * una sola consulta). Misma consulta, distinto tamaño del `ANY`.
   */
  private async catalogoDeExtras(
    manager: EntityManager | Db,
    tenantId: string,
    ingredienteIds: string[],
  ): Promise<Map<string, { nombre: string; unidad_medida: string }>> {
    const ids = [...new Set(ingredienteIds)];
    if (!ids.length) return new Map();
    const rows: {
      item_id: string;
      nombre: string;
      unidad_medida: string;
    }[] = await manager.query(
      `SELECT i.item_id, i.nombre, ip.unidad_medida
         FROM items i
         JOIN item_producto ip ON ip.item_id = i.item_id
        WHERE i.item_id = ANY($1::uuid[]) AND i.tenant_id = $2
          AND i.eliminado_el IS NULL`,
      [ids, tenantId],
    );
    return new Map(
      rows.map((r) => [
        r.item_id,
        { nombre: r.nombre, unidad_medida: r.unidad_medida },
      ]),
    );
  }

  /**
   * Los ingredientes que consume **UNA unidad** de una receta, ya modulados por
   * la personalización: se quitan los omitidos y se suman los extras del
   * snapshot. Las cantidades quedan **como las declara la receta** (sin
   * multiplicar por lo pedido y sin convertir de unidad): eso lo hace cada
   * llamador, que es donde tiene sentido.
   *
   * **Por qué existe.** Es la única parte de la expansión que comparten el
   * camino que escribe movimientos y el que solo pregunta cuánto se consumiría;
   * tenerla dos veces es exactamente el modo de falla que este repo ya pagó
   * (dos expansiones que derivan). Lo que NO comparten, y por eso queda afuera:
   * quién bloquea a quién ante falta de stock, el `FOR UPDATE` por fila, las
   * advertencias de stock insuficiente y el pre-chequeo de un componente de
   * combo no bloqueante — todo eso solo tiene sentido cuando se escribe.
   *
   * El orden es por `ingredienteItemId` y es parte del contrato: quien escribe
   * toma `FOR UPDATE` en ese orden (`docs/patterns/backend.md` §15). Los extras
   * NO se concatenan al final —salen del snapshot, o sea del orden en que el
   * cliente los agregó al carrito— sino que entran al mismo orden global.
   *
   * La unidad de stock de un extra es propiedad del ingrediente
   * (`item_producto.unidad_medida`), no de la lista de extras de la receta.
   * Resolverla desde el catálogo de extras la ataba a que el extra siguiera en
   * la carta, con un fallback a la unidad de la PORCIÓN que hacía que
   * `convertirUnidad` convirtiera una unidad a sí misma (20 g de queso
   * descontados como 20 kg).
   */
  private expandirIngredientesPersonalizados(params: {
    ingredientesBase: IngredienteReceta[];
    /** De `catalogoDeExtras`. Un extra ausente acá ya no está en el catálogo. */
    extrasCat: Map<string, { nombre: string; unidad_medida: string }>;
    snapshot: PersonalizacionRecetaSnapshot | undefined;
    recetaNombre: string;
  }): { ingredientes: IngredienteReceta[]; advertencias: string[] } {
    const omitidos = new Set(params.snapshot?.omitidos ?? []);
    const fijos = params.ingredientesBase.filter(
      (ing) => !omitidos.has(ing.ingredienteItemId),
    );

    const advertencias: string[] = [];
    const extras = (params.snapshot?.extras ?? []).flatMap((extra) => {
      const cat = params.extrasCat.get(extra.ingredienteItemId);
      if (!cat) {
        // Ingrediente borrado del catálogo: no se mueve stock de un ítem que
        // ya no existe. Mismo criterio que `venderOpcionesGrupos` con una
        // opción borrada, más la advertencia que aquel no emite.
        advertencias.push(
          `${params.recetaNombre}: no se pudo descontar un extra porque su ingrediente ya no está en el catálogo`,
        );
        return [];
      }
      // Porción del extra × cuántas veces se agregó (unidades). Snapshots
      // antiguos sin `unidades` equivalen a 1.
      const cantidad = new Decimal(extra.cantidad)
        .mul(extra.unidades ?? '1')
        .toString();
      return [
        {
          ingredienteItemId: extra.ingredienteItemId,
          ingredienteNombre: cat.nombre,
          ingredienteUnidadMedida: cat.unidad_medida,
          cantidad,
          unidadCodigo: extra.unidadCodigo,
          bloqueante: false,
        },
      ];
    });

    return {
      ingredientes: [...fijos, ...extras].sort((a, b) =>
        a.ingredienteItemId.localeCompare(b.ingredienteItemId),
      ),
      advertencias,
    };
  }

  /**
   * Vende N unidades de una receta: expande a un movimiento de salida por
   * ingrediente. Un ingrediente bloqueante sin stock deja que
   * registrarMovimiento lance su validación de "salida no negativa" —
   * eso aborta toda la transacción de la venta, gratis. Uno no bloqueante
   * intenta el mismo movimiento; si falla solo por
   * 'Stock insuficiente para la salida', se omite y se reporta como
   * advertencia (evita la carrera del pre-chequeo SELECT sin lock).
   */
  async venderIngredientesReceta(
    manager: EntityManager,
    params: {
      tenantId: string;
      usuarioId: string | null;
      ventaId: string;
      recetaItemId: string;
      recetaNombre: string;
      cantidadVendida: string;
      snapshot?: PersonalizacionRecetaSnapshot;
      /**
       * Conversor ya cargado. Lo pasa quien expande un combo o un grupo, que
       * llama a esta función una vez por componente/opción: sin él, el catálogo
       * de unidades se releía por cada uno.
       */
      convertir?: ConvertirUnidad;
    },
  ): Promise<string[]> {
    const convertir =
      params.convertir ?? (await this.catalogService.crearConversor());
    const ingredientesBase = await this.obtenerIngredientesReceta(
      manager,
      params.tenantId,
      params.recetaItemId,
    );
    // Hoy el fallback de unidad que documenta `expandirIngredientesPersonalizados`
    // no se alcanza —todo snapshot se re-resuelve contra la carta viva en esta
    // misma transacción, así que un extra fuera de carta ya falló con 400 más
    // arriba—, pero la dependencia entre unidad de stock y carta no tenía por
    // qué existir.
    const extrasCat = await this.catalogoDeExtras(
      manager,
      params.tenantId,
      params.snapshot?.extras.map((e) => e.ingredienteItemId) ?? [],
    );

    // El orden por id (y no el del snapshot) lo fija la expansión compartida:
    // es el orden de bloqueo. Efecto lateral aceptado: el orden de las
    // advertencias de stock es por id y no el del snapshot. Determinista, que
    // es lo que se busca.
    const { ingredientes: todosIngredientes, advertencias } =
      this.expandirIngredientesPersonalizados({
        ingredientesBase,
        extrasCat,
        snapshot: params.snapshot,
        recetaNombre: params.recetaNombre,
      });

    for (const ing of todosIngredientes) {
      const cantidadPorReceta = new Decimal(ing.cantidad)
        .mul(params.cantidadVendida)
        .toString();
      const cantidadConvertida = convertir(
        cantidadPorReceta,
        ing.unidadCodigo,
        ing.ingredienteUnidadMedida,
      );

      const movimientoParams = {
        tenantId: params.tenantId,
        itemId: ing.ingredienteItemId,
        tipo: 'salida' as const,
        motivo: 'venta',
        cantidad: cantidadConvertida,
        usuarioId: params.usuarioId,
        ventaId: params.ventaId,
      };

      if (ing.bloqueante) {
        await this.inventarioService.registrarMovimiento(
          manager,
          movimientoParams,
        );
        continue;
      }

      try {
        await this.inventarioService.registrarMovimiento(
          manager,
          movimientoParams,
        );
      } catch (error) {
        if (
          error instanceof BadRequestException &&
          error.message === 'Stock insuficiente para la salida'
        ) {
          advertencias.push(
            `${params.recetaNombre}: no había stock suficiente de ${ing.ingredienteNombre}, se vendió sin ese insumo`,
          );
        } else {
          throw error;
        }
      }
    }

    await this.venderOpcionesGrupos(
      manager,
      {
        tenantId: params.tenantId,
        usuarioId: params.usuarioId,
        ventaId: params.ventaId,
        cantidadVendida: params.cantidadVendida,
        convertir,
      },
      params.snapshot?.grupos,
    );

    return advertencias;
  }

  /**
   * Vende N unidades de un combo: expande a un efecto de stock por cada
   * componente. Producto → movimiento de salida directo; receta → delega en
   * `venderIngredientesReceta` (que ya maneja su propio bloqueo a nivel de
   * ingrediente); servicio → sin efecto de stock. Un componente bloqueante
   * sin stock deja propagar el error y aborta toda la transacción de la
   * venta; uno no bloqueante degrada el fallo por stock a advertencia.
   */
  async venderComponentesCombo(
    manager: EntityManager,
    params: {
      tenantId: string;
      usuarioId: string | null;
      ventaId: string;
      comboItemId: string;
      comboNombre: string;
      cantidadVendida: string;
      snapshot?: PersonalizacionRecetaSnapshot;
      /** Ver `venderIngredientesReceta`. */
      convertir?: ConvertirUnidad;
    },
  ): Promise<string[]> {
    // Una sola lectura del catálogo para TODO el combo: es el peor caso de la
    // familia, porque cada componente-receta vuelve a expandir sus propios
    // ingredientes (N componentes × M ingredientes).
    const convertir =
      params.convertir ?? (await this.catalogService.crearConversor());
    const componentes: {
      componente_item_id: string;
      componente_nombre: string;
      tipo: string;
      cantidad: string;
      bloqueante: boolean;
    }[] = await manager.query(
      `SELECT cc.componente_item_id, i.nombre AS componente_nombre, i.tipo,
              cc.cantidad, cc.bloqueante
       FROM combo_componentes cc
       JOIN items i ON i.item_id = cc.componente_item_id AND i.eliminado_el IS NULL
       WHERE cc.combo_item_id = $1 AND cc.tenant_id = $2 AND cc.eliminado_el IS NULL
       ORDER BY cc.componente_item_id`,
      [params.comboItemId, params.tenantId],
    );

    const advertencias: string[] = [];
    // Componentes que no se sirvieron: sus grupos de modificadores tampoco
    // deben descontarse (ver el filtro de `gruposComponentes` más abajo).
    const componentesOmitidos = new Set<string>();

    for (const comp of componentes) {
      const cantidadTotal = new Decimal(comp.cantidad)
        .mul(params.cantidadVendida)
        .toString();

      if (comp.tipo === 'servicio') continue;

      if (comp.tipo === 'receta') {
        // La receta gestiona el bloqueo a nivel de ingrediente. Si el componente
        // es no bloqueante, primero se pre-chequea disponibilidad: sin esto,
        // `venderIngredientesReceta` podría deducir algunos de sus propios
        // ingredientes bloqueantes (los que sí tienen stock) antes de lanzar
        // por otro que no lo tiene, y ese throw quedaría engullido más abajo
        // sin revertir las deducciones ya escritas en la misma transacción
        // (deriva silenciosa de inventario). Si no alcanza, se omite el
        // llamado completo (cero escrituras) y se reporta como advertencia.
        // El try/catch se conserva como defensa en profundidad para la
        // ventana de carrera residual entre el pre-chequeo y la deducción.
        if (!comp.bloqueante) {
          const disponible = await this.calcularDisponibleReceta(
            params.tenantId,
            comp.componente_item_id,
            convertir,
          );
          if (
            disponible !== null &&
            new Decimal(disponible).lessThan(cantidadTotal)
          ) {
            advertencias.push(
              `${params.comboNombre}: no había stock suficiente de ${comp.componente_nombre}, se vendió sin ese componente`,
            );
            componentesOmitidos.add(comp.componente_item_id);
            continue;
          }
        }
        try {
          const adv = await this.venderIngredientesReceta(manager, {
            tenantId: params.tenantId,
            usuarioId: params.usuarioId,
            ventaId: params.ventaId,
            recetaItemId: comp.componente_item_id,
            recetaNombre: comp.componente_nombre,
            cantidadVendida: cantidadTotal,
            convertir,
          });
          advertencias.push(...adv);
        } catch (error) {
          if (
            !comp.bloqueante &&
            error instanceof BadRequestException &&
            error.message === 'Stock insuficiente para la salida'
          ) {
            advertencias.push(
              `${params.comboNombre}: no había stock suficiente de ${comp.componente_nombre}, se vendió sin ese componente`,
            );
            componentesOmitidos.add(comp.componente_item_id);
          } else {
            throw error;
          }
        }
        continue;
      }

      // producto
      const movimientoParams = {
        tenantId: params.tenantId,
        itemId: comp.componente_item_id,
        tipo: 'salida' as const,
        motivo: 'venta',
        cantidad: cantidadTotal,
        usuarioId: params.usuarioId,
        ventaId: params.ventaId,
      };
      if (comp.bloqueante) {
        await this.inventarioService.registrarMovimiento(
          manager,
          movimientoParams,
        );
        continue;
      }
      try {
        await this.inventarioService.registrarMovimiento(
          manager,
          movimientoParams,
        );
      } catch (error) {
        if (
          error instanceof BadRequestException &&
          error.message === 'Stock insuficiente para la salida'
        ) {
          advertencias.push(
            `${params.comboNombre}: no había stock suficiente de ${comp.componente_nombre}, se vendió sin ese componente`,
          );
          componentesOmitidos.add(comp.componente_item_id);
        } else {
          throw error;
        }
      }
    }

    await this.venderOpcionesGrupos(
      manager,
      {
        tenantId: params.tenantId,
        usuarioId: params.usuarioId,
        ventaId: params.ventaId,
        cantidadVendida: params.cantidadVendida,
        convertir,
      },
      params.snapshot?.grupos,
    );

    // Grupos de los componentes receta (elección por unidad congelada en el
    // snapshot). Cada entrada es UNA unidad → venderOpcionesGrupos ya
    // multiplica por cantidadVendida; no multiplicar por la cantidad del
    // componente (ya está enumerada como unidades separadas).
    // Se excluyen los componentes que no se sirvieron: si el combo se vendió
    // sin la hamburguesa, la proteína que el cliente había elegido para ella
    // tampoco salió de la cocina. Sin este filtro el pre-chequeo de arriba
    // lograba "cero escrituras" por el componente y la deriva de inventario
    // se colaba igual por sus modificadores.
    const gruposComponentes = (params.snapshot?.componentes ?? [])
      .filter((c) => !componentesOmitidos.has(c.componenteItemId))
      .flatMap((c) => c.grupos);
    if (gruposComponentes.length) {
      await this.venderOpcionesGrupos(
        manager,
        {
          tenantId: params.tenantId,
          usuarioId: params.usuarioId,
          ventaId: params.ventaId,
          cantidadVendida: params.cantidadVendida,
          convertir,
        },
        gruposComponentes,
      );
    }

    return advertencias;
  }

  /**
   * Vende las opciones elegidas de los grupos de modificadores (SnapshotGrupo[])
   * congelados en la personalización. A diferencia de los componentes fijos de
   * combo/ingredientes de receta, las opciones de grupo NO tienen concepto de
   * "no bloqueante": cualquier error de stock insuficiente se propaga sin
   * capturar y aborta toda la transacción de la venta.
   */
  private async venderOpcionesGrupos(
    manager: EntityManager,
    params: {
      tenantId: string;
      usuarioId: string | null;
      ventaId: string;
      cantidadVendida: string;
      /** Requerido: los dos llamadores ya lo tienen cargado. */
      convertir: ConvertirUnidad;
    },
    grupos: SnapshotGrupo[] | undefined,
  ): Promise<void> {
    // Este loop también toma `FOR UPDATE` por opción, y el orden del snapshot
    // lo decide el cliente al armar el carrito — el mismo problema que el
    // `ordenLocks` de `ventas.service.ts` vino a resolver un nivel más arriba.
    // Se aplanan los grupos porque el orden tiene que ser global entre ellos,
    // no determinista dentro de cada uno. Efecto lateral aceptado: si dos
    // opciones fallan, ahora el error que gana es el de la de menor `itemId`
    // y no el que el cliente puso primero — determinista, que es lo que se
    // busca. Ningún paso del loop lee el grupo al que pertenece la opción.
    const opciones = (grupos ?? [])
      .flatMap((g) => g.opciones)
      .sort((a, b) => a.itemId.localeCompare(b.itemId));
    for (const op of opciones) {
      const rows: { tipo: string; unidad_medida: string | null }[] =
        await manager.query(
          `SELECT i.tipo, ip.unidad_medida
           FROM items i
           LEFT JOIN item_producto ip ON ip.item_id = i.item_id
           WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
          [op.itemId, params.tenantId],
        );
      if (!rows.length) continue;
      const { tipo, unidad_medida } = rows[0];
      if (tipo === 'servicio') continue;

      // cantidad total = cantidad de la opción × unidades elegidas × cantidad vendida del item
      const cantidadTotal = new Decimal(op.cantidad)
        .mul(op.unidades)
        .mul(params.cantidadVendida)
        .toString();

      if (tipo === 'receta') {
        // Para una opción receta, cantidadTotal son unidades enteras de la receta.
        await this.venderIngredientesReceta(manager, {
          tenantId: params.tenantId,
          usuarioId: params.usuarioId,
          ventaId: params.ventaId,
          recetaItemId: op.itemId,
          recetaNombre: op.nombre,
          cantidadVendida: cantidadTotal,
          convertir: params.convertir,
        });
        continue;
      }

      // producto o ingrediente → salida (siempre bloqueante: el error se propaga)
      const cantidadSalida =
        tipo === 'ingrediente' && op.unidadCodigo
          ? params.convertir(cantidadTotal, op.unidadCodigo, unidad_medida!)
          : cantidadTotal;
      await this.inventarioService.registrarMovimiento(manager, {
        tenantId: params.tenantId,
        itemId: op.itemId,
        tipo: 'salida',
        motivo: 'venta',
        cantidad: cantidadSalida,
        usuarioId: params.usuarioId,
        ventaId: params.ventaId,
      });
    }
  }

  /**
   * Cuánto consume de cada ingrediente o producto un conjunto de líneas ya
   * pedidas. **No escribe nada**: es la pregunta que `venderIngredientesReceta`
   * y `venderComponentesCombo` no saben contestar porque solo saben ejecutar.
   *
   * La clave del `Map` es el `itemId` del ingrediente o producto **consumido**,
   * y las cantidades están en la unidad de STOCK de ese ítem
   * (`item_producto.unidad_medida`), ya convertidas. Son **dos**: `cantidad` es
   * todo lo que se consume y `cantidadBloqueante` solo las ocurrencias que
   * frenan — el mismo ítem puede entrar por los dos lados y no se colapsan (ver
   * `ConsumoDeItem`).
   *
   * ## Qué comparte con los tres caminos de expansión que ya existen
   *
   * | | Común | Propio de cada uno |
   * |---|---|---|
   * | `venderIngredientesReceta` | omitidos + extras (`expandirIngredientesPersonalizados`), `cantidad × pedido` y la conversión a la unidad de stock | el `FOR UPDATE` por fila, el orden de bloqueo, degradar a advertencia lo no bloqueante |
   * | `venderComponentesCombo` | `cantidad del componente × pedido`, servicio sin efecto, receta que se re-expande | el pre-chequeo de disponibilidad del componente no bloqueante y el filtro de `componentesOmitidos` que de él se deriva |
   * | `venderOpcionesGrupos` | `cantidad × unidades × pedido` y que solo un `ingrediente` convierte de unidad | que toda opción propaga el error (no existe "no bloqueante" ahí) |
   * | `calcularDisponibilidadBatch` | leer en lote con `= ANY($1)` en vez de por fila | que solo mira lo **bloqueante** y que tolera una unidad rota devolviendo 0 |
   *
   * Lo común de la primera fila **está extraído de verdad**
   * (`expandirIngredientesPersonalizados`), que es la parte cara de equivocarse:
   * qué ingredientes quedan después de la personalización. Lo demás es
   * aritmética de una línea y vive acá y allá, porque compartirlo obligaría a
   * meter en la función pura el manejo de errores que solo tiene sentido cuando
   * se escribe.
   *
   * ## Enfoque (la decisión del paso 2 del brief)
   *
   * **Se carga en lote y se expande en JS**, no se expande en SQL leyendo el
   * `jsonb` de `personalizacion`. Es la opción que no duplica la lógica de
   * personalización —reusa `expandirIngredientesPersonalizados`, la misma que
   * usa la venta—, y cuesta consultas de más, no una consulta por línea: el
   * total es **constante en la cantidad de líneas** (a lo sumo cinco), porque
   * cada nivel de la expansión se resuelve con un `= ANY($1)` sobre todos los
   * ids de ese nivel. Expandir en SQL habría sido una segunda implementación
   * del snapshot, en un lenguaje donde el primer error se ve en producción.
   *
   * El anidamiento tiene fondo, y por eso los niveles son fijos: un ingrediente
   * de receta siempre es `producto`/`ingrediente` (la consulta hace `JOIN
   * item_producto`), y una opción de grupo que es receta se expande sin
   * snapshot propio. No hay recursión sin fondo que batchear.
   *
   * ⚠️ **Una unidad que ya no se puede convertir hace lanzar `BadRequestException`**,
   * igual que en la venta. `calcularDisponibilidadBatch` toma la decisión
   * contraria a propósito (tolera y cuenta 0) porque cuelga de `GET /items` y un
   * throw ahí dejaba al tenant sin menú; quien llame desde un listado tiene que
   * decidir qué hace con ese error, no heredarlo por descuido.
   */
  async consumoDeLineas(
    tenantId: string,
    lineas: LineaConsumo[],
    convertir?: ConvertirUnidad,
  ): Promise<Map<string, ConsumoDeItem>> {
    const consumo = new Map<string, ConsumoDeItem>();
    if (!lineas.length) return consumo;

    const conv = convertir ?? (await this.catalogService.crearConversor());

    const sumar = (
      itemId: string,
      nombre: string,
      cantidad: string,
      bloqueante: boolean,
    ): void => {
      const previo = consumo.get(itemId);
      const bloqueantePrevia = previo?.cantidadBloqueante ?? new Decimal(0);
      consumo.set(itemId, {
        cantidad: (previo?.cantidad ?? new Decimal(0)).plus(cantidad),
        // **Se acumula por ocurrencia, no se mergea un flag.** Un `&&` acá
        // —lo que había hasta el 2026-09-02— hacía que un solo consumo no
        // bloqueante del ítem apagara el tope de todos los demás; la venta
        // frena por ocurrencia, así que reservar y descontar divergían. Ver
        // `ConsumoDeItem`.
        cantidadBloqueante: bloqueante
          ? bloqueantePrevia.plus(cantidad)
          : bloqueantePrevia,
        // Es el mismo ítem en las dos ramas, así que da igual cuál queda; se
        // conserva el primero por no reescribir sin motivo.
        nombre: previo?.nombre ?? nombre,
      });
    };

    // 1) Tipo de cada ítem pedido: decide si la línea se consume a sí misma
    //    (producto) o si se expande (receta/combo).
    const tipoRows: { item_id: string; tipo: string; nombre: string }[] =
      await this.db.query(
        `SELECT item_id, tipo, nombre FROM items
        WHERE item_id = ANY($1::uuid[]) AND tenant_id = $2
          AND eliminado_el IS NULL`,
        [[...new Set(lineas.map((l) => l.itemId))], tenantId],
      );
    const tipos = new Map(tipoRows.map((r) => [r.item_id, r.tipo]));
    const nombres = new Map(tipoRows.map((r) => [r.item_id, r.nombre]));

    /**
     * Los grupos que una línea consume. Los de sus componentes solo cuentan en
     * un combo — `venderIngredientesReceta` ignora `snapshot.componentes`. Se
     * usa para juntar los ids Y para acumular, así que las dos pasadas no
     * pueden discrepar.
     */
    const gruposDeLinea = (linea: LineaConsumo): SnapshotGrupo[] => {
      const propios = linea.personalizacion?.grupos ?? [];
      if (tipos.get(linea.itemId) !== 'combo') return propios;
      return [
        ...propios,
        ...(linea.personalizacion?.componentes ?? []).flatMap((c) => c.grupos),
      ];
    };

    // 2) Componentes de todos los combos pedidos, en una consulta.
    const comboIds = lineas
      .filter((l) => tipos.get(l.itemId) === 'combo')
      .map((l) => l.itemId);
    const componenteRows: {
      combo_item_id: string;
      componente_item_id: string;
      tipo: string;
      nombre: string;
      cantidad: string;
      bloqueante: boolean;
    }[] = comboIds.length
      ? await this.db.query(
          `SELECT cc.combo_item_id, cc.componente_item_id, i.tipo, i.nombre,
                  cc.cantidad, cc.bloqueante
             FROM combo_componentes cc
             JOIN items i ON i.item_id = cc.componente_item_id AND i.eliminado_el IS NULL
            WHERE cc.combo_item_id = ANY($1::uuid[]) AND cc.tenant_id = $2
              AND cc.eliminado_el IS NULL`,
          [[...new Set(comboIds)], tenantId],
        )
      : [];
    const componentes = new Map<string, typeof componenteRows>();
    for (const r of componenteRows) {
      componentes.set(r.combo_item_id, [
        ...(componentes.get(r.combo_item_id) ?? []),
        r,
      ]);
    }

    // 3) Catálogo de TODAS las opciones de grupo elegidas, en una consulta: qué
    //    es cada una y en qué unidad se guarda su stock. `LEFT JOIN` porque una
    //    opción puede ser una receta, que no tiene fila en `item_producto`.
    const opcionIds = lineas.flatMap((l) =>
      gruposDeLinea(l).flatMap((g) => g.opciones.map((op) => op.itemId)),
    );
    const opcionRows: {
      item_id: string;
      tipo: string;
      nombre: string;
      unidad_medida: string | null;
    }[] = opcionIds.length
      ? await this.db.query(
          `SELECT i.item_id, i.tipo, i.nombre, ip.unidad_medida
             FROM items i
             LEFT JOIN item_producto ip ON ip.item_id = i.item_id
            WHERE i.item_id = ANY($1::uuid[]) AND i.tenant_id = $2
              AND i.eliminado_el IS NULL`,
          [[...new Set(opcionIds)], tenantId],
        )
      : [];
    const opcionesCat = new Map(opcionRows.map((r) => [r.item_id, r]));

    // 4) Ingredientes de TODAS las recetas que van a expandirse —pedidas
    //    directo, como componente de un combo o como opción de un grupo— en una
    //    consulta. Los tres orígenes se juntan antes de consultar justamente
    //    para que sea una y no tres.
    const recetaIds = [
      ...new Set([
        ...lineas
          .filter((l) => tipos.get(l.itemId) === 'receta')
          .map((l) => l.itemId),
        ...componenteRows
          .filter((r) => r.tipo === 'receta')
          .map((r) => r.componente_item_id),
        ...opcionRows.filter((r) => r.tipo === 'receta').map((r) => r.item_id),
      ]),
    ];
    const ingredientesPorReceta = await this.obtenerIngredientesRecetaPorIds(
      this.db,
      tenantId,
      recetaIds,
    );

    // 5) Catálogo de los extras de todos los snapshots, en una consulta.
    const extrasCat = await this.catalogoDeExtras(
      this.db,
      tenantId,
      lineas.flatMap(
        (l) => l.personalizacion?.extras.map((e) => e.ingredienteItemId) ?? [],
      ),
    );

    const acumularReceta = (
      recetaItemId: string,
      cantidadPedida: string,
      personalizacion: PersonalizacionRecetaSnapshot | null,
      bloqueanteDelContexto: boolean,
    ): void => {
      const { ingredientes } = this.expandirIngredientesPersonalizados({
        ingredientesBase: ingredientesPorReceta.get(recetaItemId) ?? [],
        extrasCat,
        snapshot: personalizacion ?? undefined,
        // Solo alimenta advertencias, que acá se descartan: preguntar cuánto se
        // consumiría no le avisa nada a nadie.
        recetaNombre: '',
      });
      for (const ing of ingredientes) {
        const cantidad = new Decimal(ing.cantidad)
          .mul(cantidadPedida)
          .toString();
        sumar(
          ing.ingredienteItemId,
          ing.ingredienteNombre,
          conv(cantidad, ing.unidadCodigo, ing.ingredienteUnidadMedida),
          ing.bloqueante && bloqueanteDelContexto,
        );
      }
    };

    const acumularGrupos = (
      grupos: SnapshotGrupo[],
      cantidadPedida: string,
    ): void => {
      for (const op of grupos.flatMap((g) => g.opciones)) {
        const cat = opcionesCat.get(op.itemId);
        // Opción borrada del catálogo: no consume stock de un ítem que ya no
        // existe. Mismo criterio que `venderOpcionesGrupos`.
        if (!cat || cat.tipo === 'servicio') continue;
        const cantidadTotal = new Decimal(op.cantidad)
          .mul(op.unidades)
          .mul(cantidadPedida)
          .toString();
        if (cat.tipo === 'receta') {
          acumularReceta(op.itemId, cantidadTotal, null, true);
          continue;
        }
        // Una opción de grupo SIEMPRE bloquea: `venderOpcionesGrupos` propaga
        // el error de stock sin capturarlo, no existe ahí el "no bloqueante"
        // de los ingredientes de receta ni el de los componentes de combo.
        sumar(
          op.itemId,
          cat.nombre,
          cat.tipo === 'ingrediente' && op.unidadCodigo
            ? conv(cantidadTotal, op.unidadCodigo, cat.unidad_medida!)
            : cantidadTotal,
          true,
        );
      }
    };

    for (const linea of lineas) {
      const tipo = tipos.get(linea.itemId);
      // Ítem borrado o de otro tenant: no consume nada.
      if (!tipo) continue;
      if (tipo === 'servicio' || tipo === 'suscripcion') continue;

      if (tipo === 'receta') {
        acumularReceta(
          linea.itemId,
          linea.cantidad,
          linea.personalizacion,
          true,
        );
      } else if (tipo === 'combo') {
        for (const comp of componentes.get(linea.itemId) ?? []) {
          if (comp.tipo === 'servicio') continue;
          const cantidadTotal = new Decimal(comp.cantidad)
            .mul(linea.cantidad)
            .toString();
          if (comp.tipo === 'receta') {
            // Sin snapshot: la personalización de un componente vive en
            // `snapshot.componentes[].grupos`, que se acumula abajo.
            acumularReceta(
              comp.componente_item_id,
              cantidadTotal,
              null,
              comp.bloqueante,
            );
          } else {
            sumar(
              comp.componente_item_id,
              comp.nombre,
              cantidadTotal,
              comp.bloqueante,
            );
          }
        }
      } else {
        // ⚠️ Una línea `tipo='ingrediente'` se reserva acá pero la venta la
        // RECHAZA al cerrar (un ingrediente no tiene clasificación tributaria).
        // Es preexistente y no se arregla acá: abre otro frente.
        //
        // producto o ingrediente: la línea se consume a sí misma. `cantidad` ya
        // viene en la unidad base del ítem (la venta la resuelve antes, ver
        // `cantidadCanonica` en `ventas.service.ts`), así que no se convierte.
        sumar(
          linea.itemId,
          nombres.get(linea.itemId) ?? '',
          linea.cantidad,
          true,
        );
      }

      // Los grupos NO se multiplican por la cantidad del componente: el
      // snapshot ya los enumera por unidad. Se pasan la cantidad de la línea,
      // igual que `venderComponentesCombo`.
      //
      // ⚠️ Esto corre para TODA línea, `producto`/`ingrediente` incluidos, y la
      // venta no las expande así: `venderIngredientesReceta` y
      // `venderComponentesCombo` son los únicos que miran los grupos. Hoy es
      // inalcanzable —`salones.service.ts:704` rechaza con 400 la
      // personalización sobre algo que no sea receta o combo, así que un
      // producto nunca llega acá con grupos—. **Si ese guard se relaja, esta
      // línea hace que reservar y descontar divergan**: se apartaría stock de
      // una opción que después nadie descuenta.
      //
      // Ese eje —que la reserva y el descuento cuenten distinto— es el que esta
      // feature no puede permitirse, porque la divergencia no tira error: se ve
      // en la mesa que no puede cobrar. Y ya mordió una vez por otro lado: hasta
      // el 2026-09-02 el consumo llevaba un flag `bloqueante` por ítem mergeado
      // con AND mientras la venta frena **por ocurrencia**
      // (ver `ConsumoDeItem`). Que este camino sea inalcanzable no es garantía
      // de nada; lo que la da es que las dos cuentas se hagan igual.
      acumularGrupos(gruposDeLinea(linea), linea.cantidad);
    }

    return consumo;
  }

  /**
   * **El tope al PEDIR.** Rechaza con `400` un pedido que, sumado a lo que las
   * cuentas abiertas del tenant ya tienen tomado, se pasaría del stock de algún
   * ingrediente o producto **bloqueante**.
   *
   * Hasta hoy nadie frenaba acá: dos mesas pedían la misma última unidad y el
   * choque estallaba al **cobrar**, con "Stock insuficiente para la salida", la
   * comida ya servida y la línea imposible de sacar por estar despachada. La
   * mesa quedaba trabada. Este guard mueve ese rechazo al momento en que
   * todavía se puede pedir otra cosa.
   *
   * **Solo frena lo bloqueante** (decisión del owner, spec § 4.2). Lo no
   * bloqueante igual suma al comprometido —lo hace `comprometidoPorItem`— y por
   * eso su disponible puede quedar negativo: ocupa, pero no impide pedir.
   *
   * ⚠️ **Lo bloqueante es una CANTIDAD, no un flag del ítem**
   * (`ConsumoDeItem.cantidadBloqueante`). El mismo ingrediente puede entrar por
   * un camino que frena y por otro que no —receta con queso + "extra queso"—, y
   * lo que se topea es solo la porción que frena. Colapsarlo en un flag por ítem
   * apagaba el tope de la porción base y dejaba la mesa trabada al cobrar; ver
   * `ConsumoDeItem` y los dos tests de "Revisión final" en
   * `reserva-stock-mesa.e2e-spec.ts`.
   *
   * ## `lineasPrevias`: para EDITAR una línea, no para agregar una
   *
   * `agregarLinea` no lo pasa: lo que pide es todo nuevo. `actualizarLinea` sí
   * —la línea en su estado ACTUAL—, porque `comprometidoPorItem` ya la cuenta
   * con esa cantidad y sin descontarla se contaría dos veces (subir de 1 a 2
   * con stock 2 rebotaría, y es un pedido que entra). Lo que se compara es
   * entonces `consumo(nueva) − consumo(vieja)`, **expandiendo los dos
   * extremos**; ver el comentario del `netoDe` de abajo para por qué expandir
   * la resta en su lugar da distinto y no sirve.
   *
   * ## Los tres pasos, y por qué ese orden es el contrato
   *
   * 1. `consumoDeLineas` de lo que se está pidiendo —y de `lineasPrevias`, si
   *    vinieron—. Va **antes** del lock: lee
   *    catálogo y recetas, nada de stock, y alargar el lock con eso no compra
   *    nada. Acá el conversor es el **estricto**: una unidad que ya no se puede
   *    convertir hace lanzar `BadRequestException` y el pedido se rechaza, que
   *    es lo correcto en el camino que enforcea — apartar de menos en silencio
   *    sobrevende. (`comprometidoPorItem` toma la decisión contraria porque
   *    cuelga de `GET /items`; ver su docblock.)
   * 2. `SELECT … FOR UPDATE OF ip` sobre `item_producto`, **en un solo
   *    statement y ordenado por `item_id`**. Es **el mismo lock** que ya toma
   *    la venta al descontar (`InventarioService.registrarMovimiento`).
   *
   *    ⚠️ **El mismo lock, pero NO el mismo orden, y eso es lo que hay que
   *    saber.** La venta bloquea en *(orden de línea) × (orden dentro de la
   *    línea)*, que **no es ascendente global** —el contraejemplo está en
   *    `docs/agent/anti-patterns.md` § "Tomar `FOR UPDATE` en un orden que
   *    decide el cliente", y por eso `ventas.crear()` reintenta—. Acá el orden
   *    sí es ascendente, que es lo mejor que puede hacer un statement único,
   *    pero contra la venta el ciclo sigue siendo posible. Por eso el cierre
   *    real es el reintento del `40P01`, que `SalonesService.agregarLinea`
   *    tiene (ver su bucle y el de `ventas.service.ts` → `crear`).
   *
   *    La regla que gobierna este caso es la de `anti-patterns.md` + el bloque
   *    `ordenLocks` de `ventas.service.ts`; **NO** es la § 15 de
   *    `docs/patterns/backend.md`, cuya cadena
   *    (`recargos → descuentos → item_receta → item_combo → items`) no menciona
   *    `item_producto`. Citarla acá mandaba al próximo a la sección equivocada.
   * 3. Recién **después** del lock se lee el comprometido. El orden es
   *    load-bearing: bajo READ COMMITTED, la consulta que corre después de
   *    esperar el lock ve la línea que la otra transacción acababa de
   *    commitear. Leerlo antes haría que dos pedidos simultáneos del último
   *    vieran los dos "queda 1" y pasaran los dos, que es exactamente el bug.
   *    Lo fija `toma el lock de stock ANTES de leer el comprometido…` en
   *    `items.service.spec.ts`.
   *
   * ⚠️ **Lo que este guard NO cierra.** Una línea de `tipo='ingrediente'` se
   * puede seguir agregando a una cuenta y la venta la **rechaza al cerrar**
   * (`ventas.service.ts` → "Los ingredientes no se pueden vender
   * directamente"). Es otro camino a la mesa trabada, preexistente y ajeno a
   * esta feature: acá el ingrediente se reserva como cualquier otro consumo.
   */
  async validarStockAlPedir(
    tenantId: string,
    lineasNuevas: LineaConsumo[],
    lineasPrevias: LineaConsumo[] = [],
  ): Promise<void> {
    const consumoNuevo = await this.consumoDeLineas(tenantId, lineasNuevas);
    // Segunda expansión, también ANTES del lock: no lee stock, así que alargar
    // el lock con ella no compra nada (mismo criterio que el paso 1).
    const consumoPrevio = lineasPrevias.length
      ? await this.consumoDeLineas(tenantId, lineasPrevias)
      : null;

    // `neto` = lo que se pide DE MÁS, y se calcula como
    // `consumo(nueva) − consumo(vieja)`, **nunca** como `consumo(nueva − vieja)`.
    // No son lo mismo y la diferencia es alcanzable: `consumoDeLineas` no solo
    // multiplica, después CONVIERTE, y `CatalogService.convertirConMapa`
    // redondea a 4 decimales y **lanza** si lo convertido cae por debajo de esa
    // precisión. Medido: una receta con 5 g de un insumo stockeado en kg, línea
    // en 1 → subirla a 1,005 expande el delta como `0,025 g → 0,0000 kg` y
    // rebota con un 400 sobre "precisión de stock" que no tiene nada que ver
    // con lo que pidió el garzón; expandiendo los dos extremos da
    // `0,0050 − 0,0050 = 0`, que es la respuesta correcta. Custodiado por
    // "subir una fracción de una receta con un insumo… no rebota por precisión"
    // en `reserva-stock-mesa.e2e-spec.ts`.
    //
    // Y se calcula sobre `cantidadBloqueante` **en los dos extremos**, nunca
    // sobre el total: el tope compara contra el stock lo que FRENA, y el total
    // arrastra además lo que solo ocupa. `actualizarLinea` no edita la
    // personalización —es la misma de los dos lados—, así que la diferencia no
    // se cancela: se duplica. Medido, con una receta que lleva un ingrediente
    // bloqueante y un extra del mismo ítem, subir la línea de 1 a 2 necesita
    // **una** ración más y con los totales pediría dos, o sea rebota un pedido
    // que entra. Lo custodia "editar un plato con extra netea solo lo que frena,
    // no el total" en `items.service.spec.ts`.
    const netoDe = (itemId: string, c: ConsumoDeItem): Decimal =>
      consumoPrevio
        ? c.cantidadBloqueante.minus(
            consumoPrevio.get(itemId)?.cantidadBloqueante ?? 0,
          )
        : c.cantidadBloqueante;

    // Solo entra al tope lo que tiene AL MENOS UNA ocurrencia bloqueante, y
    // entra por esa cantidad: lo no bloqueante ocupa pero no frena (spec § 4.2).
    //
    // Un neto ≤ 0 no se mira ni se lockea: bajar la cantidad solo LIBERA, y
    // soltar stock no puede sobrevender. Filtrar acá —antes del lock— además
    // achica la huella de locks del camino que baja, en vez de agrandarla.
    const bloqueantes = [...consumoNuevo]
      .filter(([, c]) => c.cantidadBloqueante.greaterThan(0))
      .map(([itemId, c]) => [itemId, c, netoDe(itemId, c)] as const)
      .filter(([, , neto]) => neto.greaterThan(0));
    if (!bloqueantes.length) return;

    const ids = bloqueantes.map(([itemId]) => itemId);
    const stockRows: {
      item_id: string;
      stock: string | null;
      unidad_medida: string;
    }[] = await this.db.query(
      // `FOR UPDATE OF ip` y no `FOR UPDATE` a secas, por lo mismo que
      // `registrarMovimiento`: sin el `OF`, Postgres lockearía también la fila
      // de `items`, huella de locks nueva en el camino más caliente.
      // `item_producto` no tiene `tenant_id` ni `eliminado_el` (extensión con
      // PK compartida), así que el acote por tenant y el filtro de borrado
      // viven los dos en el JOIN al padre.
      //
      // El `ORDER BY` es el que fija el orden de bloqueo: el nodo `LockRows`
      // va por encima del `Sort`, así que las filas se lockean ya ordenadas.
      `SELECT ip.item_id, ip.stock, ip.unidad_medida
         FROM item_producto ip
         JOIN items i ON i.item_id = ip.item_id
        WHERE ip.item_id = ANY($1::uuid[]) AND i.tenant_id = $2
          AND i.eliminado_el IS NULL
        ORDER BY ip.item_id
        FOR UPDATE OF ip`,
      [ids, tenantId],
    );
    const stockPorItem = new Map(stockRows.map((r) => [r.item_id, r]));

    // ⚠️ Esto corre **sosteniendo el lock de arriba** —tiene que ser así, ver
    // el paso 3 del docblock—, así que su costo es tiempo de lock sobre los
    // ítems que se están pidiendo. La ventana está medida y acotada: con los
    // dos índices que agregó la Tarea 2 (`cuenta_lineas(tenant_id, cuenta_id)`
    // y `cuentas(tenant_id, estado)`) la consulta del comprometido mide
    // 0,36 ms. Si esa medición deja de valer —muchísimas cuentas abiertas, un
    // índice que se cae— esto es lo primero que hay que volver a mirar, porque
    // dos garzones pidiendo el mismo ítem se serializan acá.
    const comprometido = await this.comprometidoPorItem(tenantId);

    for (const [itemId, c, neto] of bloqueantes) {
      const fila = stockPorItem.get(itemId);
      // **Ruidoso a propósito: era la única salida silenciosa del camino que
      // enforcea.** Un ítem bloqueante SIN fila en `item_producto` no es un
      // caso de negocio: todo lo que llega acá con `bloqueante` es un
      // `producto` o un `ingrediente` —los tipos que sí tienen extensión—,
      // porque un componente de combo solo puede ser producto/receta/servicio
      // (`validarComponentesCombo`), una opción de grupo suma esos cuatro
      // (`grupos-modificadores.service.ts`), el `servicio` se saltea antes y la
      // `receta` se re-expande. Un combo dentro de otro combo, que es lo que
      // este comentario decía antes, **es imposible**: el alta lo rechaza.
      //
      // Lo que SÍ puede pasar es la carrera: alguien borra (soft) el
      // ingrediente entre la expansión y esta consulta —READ COMMITTED, el
      // commit ajeno ya se ve— y el `i.eliminado_el IS NULL` lo deja afuera.
      // Saltearlo ahí significaría no topear un ítem que la venta **sí** va a
      // descontar (`registrarMovimiento` no filtra el borrado a propósito), o
      // sea sobrevender en silencio. Se rechaza el pedido, que es el mismo
      // criterio del conversor estricto del paso 1.
      if (!fila) {
        throw new BadRequestException(
          `No se puede verificar el stock de "${c.nombre}": el ítem ya no está disponible en el catálogo`,
        );
      }
      const restante = new Decimal(fila.stock ?? '0').minus(
        comprometido.get(itemId) ?? 0,
      );
      if (neto.greaterThan(restante)) {
        // El mensaje nombra el ítem que faltó, no el plato: en una receta de
        // seis ingredientes "no hay stock" manda al garzón a adivinar. Y
        // `restante` se muestra tal cual, negativo incluido —lo no bloqueante
        // puede haberlo pasado—: clamplear a 0 escondería justo el número que
        // el encargado necesita ver.
        //
        // **"lo que se está agregando", y no "este pedido"**, porque el número
        // es el NETO y los dos llamadores lo leen distinto: al agregar una línea
        // coincide con lo que el garzón tipeó, pero al SUBIR una que ya existía
        // es la diferencia (tipeó 3 sobre una línea de 1 y el número es 2).
        // "Este pedido necesita 2" invitaba a leer el 3 y no entender de dónde
        // salía el 2; así la frase es cierta desde los dos lados.
        throw new BadRequestException(
          `Stock insuficiente de "${c.nombre}": quedan ${restante.toString()} ${fila.unidad_medida} ` +
            `y lo que se está agregando necesita ${neto.toString()} ${fila.unidad_medida}`,
        );
      }
    }
  }

  // ── private helpers ────────────────────────────────────────────────────────

  /**
   * Rechaza costos presentes que sean NEGATIVOS. El `0` pasa: mercadería de
   * donación o muestra cuesta 0 de verdad, y ese es un costo conocido —distinto
   * de `NULL`, que es "no sé cuánto costó" y es lo que filtra `sinCosto`
   * (`IS NULL`, no `= 0`). Decisión del owner, 2026-08-29.
   *
   * Hasta entonces el helper exigía `> 0` y contradecía al propio
   * `CreateItemDto`, que documenta y valida `>= 0` (`@IsDecimalNoNegativo`)
   * desde antes: el caso que el comentario del DTO daba por bueno era
   * inalcanzable por API. Lo que estaba mal era la validación, no el comentario.
   */
  private validarCostoNoNegativo(costo: string): void {
    let value: Decimal;
    try {
      value = new Decimal(costo);
    } catch {
      throw new BadRequestException('El costo no puede ser negativo');
    }
    if (value.isNaN() || value.lessThan(0)) {
      throw new BadRequestException('El costo no puede ser negativo');
    }
  }

  /** Valida que el código exista en el catálogo global de unidades de medida. */
  private async validarUnidadMedida(codigo: string): Promise<void> {
    const unidades = await this.catalogService.findAllUnidadesMedida();
    if (!unidades.some((u) => u.codigo === codigo)) {
      const validas = unidades.map((u) => u.codigo).join(', ');
      throw new BadRequestException(
        `Unidad de medida no reconocida: ${codigo}. Válidas: ${validas}`,
      );
    }
  }

  /**
   * Mínimo, entre los ingredientes BLOQUEANTES de una receta, de
   * floor(stock del ingrediente convertido a la unidad de la receta /
   * cantidad por receta). null si la receta no tiene ingredientes
   * bloqueantes (sin límite aplicable). Se calcula al vuelo: sin columna
   * cacheada (ver Decisions del diseño).
   */
  private async calcularDisponibleReceta(
    tenantId: string,
    recetaItemId: string,
    convertir: ConvertirUnidad,
  ): Promise<number | null> {
    const rows: {
      cantidad: string;
      unidad_codigo: string;
      ingrediente_unidad_medida: string;
      stock: string;
    }[] = await this.db.query(
      `SELECT ri.cantidad, ri.unidad_codigo, ip.unidad_medida AS ingrediente_unidad_medida, ip.stock
       FROM receta_ingredientes ri
       JOIN item_producto ip ON ip.item_id = ri.ingrediente_item_id
       WHERE ri.receta_item_id = $1 AND ri.tenant_id = $2
         AND ri.bloqueante = true AND ri.eliminado_el IS NULL`,
      [recetaItemId, tenantId],
    );
    if (!rows.length) return null;

    let minimo: Decimal | null = null;
    for (const r of rows) {
      const cantidadBase = convertir(
        r.cantidad,
        r.unidad_codigo,
        r.ingrediente_unidad_medida,
      );
      const posibles = new Decimal(r.stock).div(cantidadBase).floor();
      if (minimo === null || posibles.lessThan(minimo)) minimo = posibles;
    }
    return minimo === null ? null : minimo.toNumber();
  }

  /**
   * Disponibilidad de todas las recetas/combos/productos de una página en un nº
   * CONSTANTE de queries, en vez de una por fila (N+1).
   *
   * **Lo que todavía se PUEDE PEDIR, no lo que hay.** El stock del que se
   * reparte sale de restarle lo que las cuentas `abierta` del tenant ya
   * comprometieron (`comprometidoPorItem`), porque el sistema no aparta stock al
   * pedir: la venta descuenta recién al cerrar la cuenta, así que sin este
   * descuento dos mesas podían pedir la misma última unidad y el choque
   * estallaba al cobrar. `stock` sigue significando lo que hay **físicamente**
   * — es el saldo materializado de `movimientos_inventario` y cambiarle el
   * sentido sería mucho peor.
   *
   * **Devuelve dos mapas porque son dos preguntas distintas** (decisión del
   * owner, 2026-09-01, que enmienda la § 4.1b de la spec):
   *
   * - `disponible` — receta y combo: el mínimo de unidades que permiten armar
   *   sus componentes **bloqueantes**, igual que
   *   `calcularDisponibleReceta`/`calcularDisponibleCombo` fila a fila. Es un
   *   **conteo entero de porciones** y no cambió de tipo ni de significado; lo
   *   único que cambia es que el stock que se divide ya viene descontado.
   * - `stockDisponible` — producto e ingrediente: **cuánta cantidad queda por
   *   pedir**, string en la escala de `stock` (4 decimales, la del kardex).
   *   Hasta el 2026-09-01 estos tipos no tenían número.
   *
   * Meter las dos en un solo campo confundía un conteo con una cantidad —1,5 kg
   * de queso no es "una porción y media"— y obligaba a devolver la cantidad como
   * `number`, que para plata o cantidades es lo que el proyecto no hace.
   *
   * ⚠️ **Los dos pueden ser negativos, y es correcto que se vea.** Lo
   * comprometido incluye lo NO bloqueante (spec § 4.2: suma al comprometido
   * pero no frena al pedir), así que un ingrediente que solo entra como no
   * bloqueante puede pasarse del stock. Clamplear a 0 escondería justo el caso
   * que el encargado necesita ver.
   */
  private async calcularDisponibilidadBatch(
    tenantId: string,
    recetaIds: string[],
    comboIds: string[],
    /** Los ítems con stock propio de la página, con el `stock` ya leído. */
    productos: { itemId: string; stock: string | null }[],
  ): Promise<{
    disponible: Map<string, number | null>;
    stockDisponible: Map<string, string>;
  }> {
    const resultado = new Map<string, number | null>();
    const resultadoStock = new Map<string, string>();
    if (!recetaIds.length && !comboIds.length && !productos.length) {
      return { disponible: resultado, stockDisponible: resultadoStock };
    }

    // 0) Lo que las cuentas abiertas ya comprometieron, de TODO el tenant: un
    // ingrediente de esta página puede estar tomado por una receta que no está
    // listada. Es una sola llamada para toda la página, nunca una por ítem.
    const comprometido = await this.comprometidoPorItem(tenantId);

    /**
     * El stock del que se reparte: lo físico menos lo ya pedido. Único punto
     * donde `ip.stock` deja de leerse pelado, para que las tres ramas
     * (ingrediente de receta, componente de combo y producto suelto) no puedan
     * discrepar.
     */
    const stockDisponible = (itemId: string, stock: string | null): Decimal =>
      new Decimal(stock ?? '0').minus(comprometido.get(itemId) ?? 0);

    // 1) Componentes bloqueantes de todos los combos (una query).
    const comboRows: {
      combo_item_id: string;
      componente_item_id: string;
      tipo: string;
      cantidad: string;
      stock: string | null;
    }[] = comboIds.length
      ? await this.db.query(
          `SELECT cc.combo_item_id, cc.componente_item_id, i.tipo, cc.cantidad, ip.stock
           FROM combo_componentes cc
           JOIN items i ON i.item_id = cc.componente_item_id AND i.eliminado_el IS NULL
           LEFT JOIN item_producto ip ON ip.item_id = cc.componente_item_id
           WHERE cc.combo_item_id = ANY($1) AND cc.tenant_id = $2
             AND cc.bloqueante = true AND cc.eliminado_el IS NULL`,
          [comboIds, tenantId],
        )
      : [];

    // Las recetas usadas como componente de un combo también necesitan su
    // disponibilidad, aunque no estén listadas en la página.
    const recetasDeCombos = comboRows
      .filter((r) => r.tipo === 'receta')
      .map((r) => r.componente_item_id);
    const todasRecetas = [...new Set([...recetaIds, ...recetasDeCombos])];

    // 2) Ingredientes bloqueantes de todas las recetas (una query).
    const ingRows: {
      receta_item_id: string;
      ingrediente_item_id: string;
      cantidad: string;
      unidad_codigo: string;
      ingrediente_unidad_medida: string;
      stock: string;
    }[] = todasRecetas.length
      ? await this.db.query(
          `SELECT ri.receta_item_id, ri.ingrediente_item_id, ri.cantidad, ri.unidad_codigo,
                  ip.unidad_medida AS ingrediente_unidad_medida, ip.stock
           FROM receta_ingredientes ri
           JOIN item_producto ip ON ip.item_id = ri.ingrediente_item_id
           WHERE ri.receta_item_id = ANY($1) AND ri.tenant_id = $2
             AND ri.bloqueante = true AND ri.eliminado_el IS NULL`,
          [todasRecetas, tenantId],
        )
      : [];

    // 3) Todas las conversiones de unidad resolviendo las unidades en una sola
    // query (evita el N+1 anidado de convertir ingrediente por ingrediente).
    const cantidadesBase = await this.catalogService.convertirUnidades(
      ingRows.map((r) => ({
        cantidad: r.cantidad,
        desde: r.unidad_codigo,
        hacia: r.ingrediente_unidad_medida,
      })),
    );

    // 4) Disponibilidad de cada receta = mínimo de floor(stock / cantidadBase).
    const dispReceta = new Map<string, Decimal | null>();
    for (const id of todasRecetas) dispReceta.set(id, null);
    ingRows.forEach((r, i) => {
      const cantidadBase = cantidadesBase[i];
      // `null` = la unidad de la receta y la del ingrediente ya no se pueden
      // convertir entre sí (alguien cambió la unidad del ingrediente cuando
      // todavía se podía). La receta queda en 0 —no se puede producir— en vez
      // de tirar abajo el listado entero, que es lo que pasaba antes. 0 y no
      // `null`: `null` acá significa "sin límite" y mostraría como disponible
      // algo que no se puede preparar.
      const posibles =
        cantidadBase === null
          ? new Decimal(0)
          : stockDisponible(r.ingrediente_item_id, r.stock)
              .div(cantidadBase)
              .floor();
      const actual = dispReceta.get(r.receta_item_id) ?? null;
      if (actual === null || posibles.lessThan(actual)) {
        dispReceta.set(r.receta_item_id, posibles);
      }
    });
    for (const id of recetaIds) {
      const d = dispReceta.get(id) ?? null;
      resultado.set(id, d === null ? null : d.toNumber());
    }

    // 5) Disponibilidad de cada combo = mínimo entre sus componentes bloqueantes
    // (servicio se ignora; receta usa su propia disponibilidad ya calculada).
    const dispCombo = new Map<string, Decimal | null>();
    for (const id of comboIds) dispCombo.set(id, null);
    for (const r of comboRows) {
      if (r.tipo === 'servicio') continue;
      let posibles: Decimal;
      if (r.tipo === 'receta') {
        const disp = dispReceta.get(r.componente_item_id) ?? null;
        if (disp === null) continue;
        posibles = disp.div(r.cantidad).floor();
      } else {
        posibles = stockDisponible(r.componente_item_id, r.stock)
          .div(r.cantidad)
          .floor();
      }
      const actual = dispCombo.get(r.combo_item_id) ?? null;
      if (actual === null || posibles.lessThan(actual)) {
        dispCombo.set(r.combo_item_id, posibles);
      }
    }
    for (const id of comboIds) {
      const d = dispCombo.get(id) ?? null;
      resultado.set(id, d === null ? null : d.toNumber());
    }

    // 6) Un producto o ingrediente suelto vale su propio stock descontado. No
    // hay mínimo que sacar ni unidad que convertir: la línea se consume a sí
    // misma en su unidad base (ver `consumoDeLineas`).
    //
    // Va a `stockDisponible` y NO a `disponible`: es una cantidad, no un conteo
    // de porciones. `toFixed(4)` la deja en la misma escala que `stock`
    // —`numeric(18,4)`, la del kardex— para que las dos columnas de la fila se
    // puedan comparar sin reformatear, y como string por la misma razón que el
    // resto de las cantidades del proyecto.
    for (const p of productos) {
      resultadoStock.set(
        p.itemId,
        stockDisponible(p.itemId, p.stock).toFixed(4),
      );
    }

    return { disponible: resultado, stockDisponible: resultadoStock };
  }

  /**
   * Cuánto de cada ingrediente o producto tienen ya tomado las cuentas
   * **abiertas** del tenant. Es la reserva que el sistema no tenía: pedir en una
   * mesa no escribe en `movimientos_inventario` —la venta descuenta recién al
   * cerrar la cuenta—, así que sin esta resta dos mesas podían pedir la misma
   * última unidad.
   *
   * **Una sola consulta para las líneas de TODAS las cuentas abiertas, y una
   * sola llamada a `consumoDeLineas`.** Nunca una por ítem ni por cuenta: esto
   * cuelga de `GET /items`, que es el menú del POS.
   *
   * Solo `estado = 'abierta'`: una cuenta cerrada ya descontó stock de verdad al
   * generar su venta y volver a restarla contaría dos veces; una cancelada nunca
   * va a consumir nada. No se une a `mesas` —`obtenerUsoItem` sí lo hace, pero
   * porque necesita el nombre de la mesa para el mensaje—: `eliminarMesa`
   * rechaza borrar una mesa con cuentas abiertas, así que acá no hay huérfanas
   * que filtrar.
   *
   * Suma lo bloqueante Y lo no bloqueante: `bloqueante` decide quién FRENA al
   * pedir, no quién ocupa (spec § 4.2). Por eso el resultado se resta entero.
   *
   * ⚠️ **Degrada el error de unidad en vez de heredarlo.** `consumoDeLineas`
   * lanza `BadRequestException` cuando una unidad ya no se puede convertir
   * —para el camino que enforcea es lo correcto: mejor rechazar el pedido que
   * apartar de menos en silencio—, pero acá un throw deja `GET /items` caído
   * para todo el tenant, que es exactamente el incidente que ya hizo tolerante a
   * `CatalogService.convertirUnidades`. Entonces la conversión rota vale `0`
   * consumido: ese ítem conserva su comportamiento de antes de este cambio
   * (stock sin descontar) mientras los demás sí descuentan, en vez de tumbar el
   * menú entero. El costo de equivocarse es sobrevender ese ítem, que es
   * estrictamente lo de hoy; el 500 sería peor.
   */
  private async comprometidoPorItem(
    tenantId: string,
  ): Promise<Map<string, Decimal>> {
    const rows: {
      item_id: string;
      cantidad: string;
      personalizacion: PersonalizacionRecetaSnapshot | null;
    }[] = await this.db.query(
      `SELECT cl.item_id, cl.cantidad, cl.personalizacion
         FROM cuenta_lineas cl
         JOIN cuentas c ON c.cuenta_id = cl.cuenta_id
          AND c.tenant_id = $1 AND c.eliminado_el IS NULL
          AND c.estado = 'abierta'
        WHERE cl.tenant_id = $1 AND cl.eliminado_el IS NULL`,
      [tenantId],
    );
    if (!rows.length) return new Map();

    const estricto = await this.catalogService.crearConversor();
    const tolerante: ConvertirUnidad = (cantidad, desde, hacia) => {
      try {
        return estricto(cantidad, desde, hacia);
      } catch (e) {
        // Acotado al error esperado —unidad desconocida, magnitud
        // incompatible—, no un `catch {}` pelado: un fallo inesperado acá
        // alimenta un número de negocio, así que tiene que seguir saliendo como
        // 500 ruidoso en vez de disfrazarse de "unidad rota". Mismo criterio y
        // misma redacción que `CatalogService.convertirUnidades`.
        if (e instanceof BadRequestException) return '0';
        throw e;
      }
    };

    const consumo = await this.consumoDeLineas(
      tenantId,
      rows.map((r) => ({
        itemId: r.item_id,
        // `cuenta_lineas.cantidad` ya es la canónica (la de presentación vive
        // aparte en `cantidad_presentacion`), que es lo que `LineaConsumo` pide.
        cantidad: r.cantidad,
        personalizacion: r.personalizacion,
      })),
      tolerante,
    );
    return new Map([...consumo].map(([itemId, c]) => [itemId, c.cantidad]));
  }

  /**
   * Filas base de varios ítems para las validaciones de receta/combo, en UNA
   * query. Las tres `validar*` de abajo consultaban ítem por ítem sobre el
   * array que mandó el cliente; ahora precargan y el loop solo valida, así que
   * **el orden en que fallan las validaciones no cambia** (la carga no lanza).
   *
   * `costo_actual` sale de `COALESCE(item_producto, item_receta)`: para un
   * ingrediente la segunda es NULL, así que sirve a los tres llamadores.
   */
  private async filasValidacionPorIds(
    manager: EntityManager,
    tenantId: string,
    itemIds: string[],
  ): Promise<
    Map<
      string,
      {
        tipo: string;
        nombre: string;
        modo_inventario: string | null;
        unidad_medida: string | null;
        costo_actual: string | null;
      }
    >
  > {
    const unicos = [...new Set(itemIds)];
    if (!unicos.length) return new Map();

    const rows: {
      item_id: string;
      tipo: string;
      nombre: string;
      modo_inventario: string | null;
      unidad_medida: string | null;
      costo_actual: string | null;
    }[] = await manager.query(
      `SELECT i.item_id, i.tipo, i.nombre, ip.modo_inventario, ip.unidad_medida,
              COALESCE(ip.costo_actual, ir.costo_actual) AS costo_actual
         FROM items i
         LEFT JOIN item_producto ip ON ip.item_id = i.item_id
         LEFT JOIN item_receta ir ON ir.item_id = i.item_id
        WHERE i.item_id = ANY($1::uuid[]) AND i.tenant_id = $2
          AND i.eliminado_el IS NULL`,
      [unicos, tenantId],
    );
    return new Map(rows.map((r) => [r.item_id, r]));
  }

  /**
   * Corta con 400 un id repetido en la lista de componentes de una receta o
   * combo. Los tres destinos (componentes de combo, ingredientes y extras de
   * receta) tienen un índice único parcial detrás, así que sin este chequeo el
   * duplicado pasa la validación y revienta contra el índice: 500 en vez de 400.
   * El dato queda a salvo igual —la transacción revierte—, lo que fallaba era la
   * calidad del error.
   *
   * Va SIEMPRE antes de la primera query: el chequeo es en memoria y ahorra el
   * viaje. Eso lo vuelve más temprano que las validaciones por fila (cantidad,
   * tipo, unidad), así que un payload con un duplicado **y** una cantidad
   * inválida ahora reporta el duplicado. Los dos son 400 accionables.
   */
  private assertSinIdsRepetidos(ids: string[], mensaje: string): void {
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(mensaje);
    }
  }

  /**
   * Valida cada ingrediente (existe, es producto, modo 'cantidad', unidad
   * compatible) y devuelve el costo total de la receta convirtiendo cada
   * cantidad a la unidad base del ingrediente antes de multiplicar por su
   * costo_actual (costo por unidad base).
   */
  private async validarYCostearIngredientes(
    manager: EntityManager,
    tenantId: string,
    ingredientes: RecetaIngredienteInputDto[],
  ): Promise<{
    costoActual: string;
    ingredientes: {
      ingredienteItemId: string;
      ingredienteNombre: string;
      cantidad: string;
      unidadCodigo: string;
      bloqueante: boolean;
    }[];
  }> {
    let costoTotal = new Decimal(0);
    const detalle: {
      ingredienteItemId: string;
      ingredienteNombre: string;
      cantidad: string;
      unidadCodigo: string;
      bloqueante: boolean;
    }[] = [];
    this.assertSinIdsRepetidos(
      ingredientes.map((i) => i.ingredienteItemId),
      'Un ingrediente no puede aparecer más de una vez en la receta',
    );
    const filas = await this.filasValidacionPorIds(
      manager,
      tenantId,
      ingredientes.map((i) => i.ingredienteItemId),
    );
    // Catálogo de unidades cargado una vez: la conversión sigue ocurriendo
    // dentro del loop, en el mismo punto, así que ningún error cambia de orden.
    const convertir = await this.catalogService.crearConversor();
    for (const ing of ingredientes) {
      let cantidad: Decimal;
      try {
        cantidad = new Decimal(ing.cantidad);
      } catch {
        throw new BadRequestException(
          'La cantidad del ingrediente debe ser un número mayor a 0',
        );
      }
      if (cantidad.isNaN() || cantidad.lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          'La cantidad del ingrediente debe ser mayor a 0',
        );
      }
      const fila = filas.get(ing.ingredienteItemId);
      if (!fila || fila.tipo !== 'ingrediente') {
        throw new BadRequestException(
          `El ingrediente ${ing.ingredienteItemId} no es un item de tipo ingrediente válido`,
        );
      }
      if (fila.modo_inventario !== 'cantidad') {
        throw new BadRequestException(
          'Los insumos de receta solo admiten modo de inventario "cantidad"',
        );
      }
      const cantidadBase = convertir(
        ing.cantidad,
        ing.unidadCodigo,
        fila.unidad_medida!,
      );
      const costoUnitario = new Decimal(fila.costo_actual ?? '0');
      costoTotal = costoTotal.plus(costoUnitario.mul(cantidadBase));
      detalle.push({
        ingredienteItemId: ing.ingredienteItemId,
        ingredienteNombre: fila.nombre,
        cantidad: ing.cantidad,
        unidadCodigo: ing.unidadCodigo,
        bloqueante: ing.bloqueante ?? true,
      });
    }
    // Costo por unidad de receta/combo: tasa interna a escala de costo (4), HALF_UP
    // fijo — mismo criterio que el CPP. La MISMA cuenta vive dos veces: acá y en
    // validarYCostear{Ingredientes,Componentes} (el camino de escritura al crear o
    // editar). Si cambiás el criterio en una, cambialo en la otra: la bandeja de
    // desfases compara ambos resultados con eq4 y un criterio distinto la hace
    // proponer o esconder desfases fantasma.
    return {
      costoActual: costoTotal
        .toDecimalPlaces(ESCALA_COSTO, Decimal.ROUND_HALF_UP)
        .toString(),
      ingredientes: detalle,
    };
  }

  private async validarYCostearComponentes(
    manager: EntityManager,
    tenantId: string,
    componentes: ComboComponenteInputDto[],
  ): Promise<{
    costoActual: string;
    componentes: {
      componenteItemId: string;
      componenteNombre: string;
      tipo: string;
      cantidad: string;
      bloqueante: boolean;
    }[];
  }> {
    if (!componentes.length) {
      throw new BadRequestException(
        'Los combos requieren al menos un componente',
      );
    }
    this.assertSinIdsRepetidos(
      componentes.map((c) => c.componenteItemId),
      'Un item no puede aparecer más de una vez como componente del combo',
    );
    let costoTotal = new Decimal(0);
    const detalle: {
      componenteItemId: string;
      componenteNombre: string;
      tipo: string;
      cantidad: string;
      bloqueante: boolean;
    }[] = [];
    const filas = await this.filasValidacionPorIds(
      manager,
      tenantId,
      componentes.map((c) => c.componenteItemId),
    );
    for (const c of componentes) {
      const fila = filas.get(c.componenteItemId);
      if (!fila) {
        throw new BadRequestException(
          `Componente no encontrado: ${c.componenteItemId}`,
        );
      }
      const { nombre, tipo, costo_actual } = fila;
      if (!['producto', 'receta', 'servicio'].includes(tipo)) {
        throw new BadRequestException(
          `Un componente de combo debe ser producto, receta o servicio (recibido: ${tipo})`,
        );
      }
      if (new Decimal(c.cantidad).lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          `La cantidad del componente ${nombre} debe ser mayor a 0`,
        );
      }
      costoTotal = costoTotal.plus(
        new Decimal(costo_actual ?? '0').mul(c.cantidad),
      );
      detalle.push({
        componenteItemId: c.componenteItemId,
        componenteNombre: nombre,
        tipo,
        cantidad: c.cantidad,
        bloqueante: c.bloqueante ?? true,
      });
    }
    // Costo por unidad de receta/combo: tasa interna a escala de costo (4), HALF_UP
    // fijo — mismo criterio que el CPP. La MISMA cuenta vive dos veces: acá y en
    // validarYCostear{Ingredientes,Componentes} (el camino de escritura al crear o
    // editar). Si cambiás el criterio en una, cambialo en la otra: la bandeja de
    // desfases compara ambos resultados con eq4 y un criterio distinto la hace
    // proponer o esconder desfases fantasma.
    return {
      costoActual: costoTotal
        .toDecimalPlaces(ESCALA_COSTO, Decimal.ROUND_HALF_UP)
        .toString(),
      componentes: detalle,
    };
  }

  private async validarExtrasPermitidos(
    manager: EntityManager,
    tenantId: string,
    extras: RecetaExtraInputDto[],
  ): Promise<
    {
      ingredienteItemId: string;
      ingredienteNombre: string;
      cantidad: string;
      unidadCodigo: string;
      precioExtra: string;
    }[]
  > {
    const detalle: {
      ingredienteItemId: string;
      ingredienteNombre: string;
      cantidad: string;
      unidadCodigo: string;
      precioExtra: string;
    }[] = [];
    // Duplicados antes de tocar la BD, igual que `validarYCostearComponentes`:
    // sin esto el payload pasaba la validación y reventaba contra el índice
    // único parcial de `receta_extras_permitidos` (500 en vez de 400).
    this.assertSinIdsRepetidos(
      extras.map((e) => e.ingredienteItemId),
      'Un ingrediente no puede aparecer más de una vez como extra permitido',
    );
    const filas = await this.filasValidacionPorIds(
      manager,
      tenantId,
      extras.map((e) => e.ingredienteItemId),
    );
    const convertir = await this.catalogService.crearConversor();
    for (const extra of extras) {
      let cantidad: Decimal;
      try {
        cantidad = new Decimal(extra.cantidad);
      } catch {
        throw new BadRequestException(
          'La cantidad del extra permitido debe ser un número mayor a 0',
        );
      }
      if (cantidad.isNaN() || cantidad.lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          'La cantidad del extra permitido debe ser mayor a 0',
        );
      }
      let precioExtra: Decimal;
      try {
        precioExtra = new Decimal(extra.precioExtra);
      } catch {
        throw new BadRequestException(
          'El precio extra debe ser un número mayor o igual a 0',
        );
      }
      if (precioExtra.isNaN() || precioExtra.lessThan(0)) {
        throw new BadRequestException(
          'El precio extra debe ser mayor o igual a 0',
        );
      }
      const fila = filas.get(extra.ingredienteItemId);
      if (!fila || fila.tipo !== 'ingrediente') {
        throw new BadRequestException(
          `El extra ${extra.ingredienteItemId} no es un item de tipo ingrediente válido`,
        );
      }
      if (fila.modo_inventario !== 'cantidad') {
        throw new BadRequestException(
          'Los extras permitidos solo admiten modo de inventario "cantidad"',
        );
      }
      // Solo valida compatibilidad de unidades; el resultado no se usa.
      convertir(extra.cantidad, extra.unidadCodigo, fila.unidad_medida!);
      detalle.push({
        ingredienteItemId: extra.ingredienteItemId,
        ingredienteNombre: fila.nombre,
        cantidad: extra.cantidad,
        unidadCodigo: extra.unidadCodigo,
        precioExtra: extra.precioExtra,
      });
    }
    return detalle;
  }

  private eq4(a: string | Decimal, b: string | Decimal): boolean {
    return new Decimal(a)
      .toDecimalPlaces(ESCALA_COSTO, Decimal.ROUND_HALF_UP)
      .eq(new Decimal(b).toDecimalPlaces(ESCALA_COSTO, Decimal.ROUND_HALF_UP));
  }

  private margenPct(precio: Decimal, costo: Decimal): Decimal | null {
    if (precio.lessThanOrEqualTo(0)) return null;
    // Un margen es un RATIO, no plata: toma `ESCALA_COSTO` porque se deriva del
    // costo y la bandeja lo muestra al lado del costo del que sale, no porque
    // sea un monto costeado.
    return precio
      .minus(costo)
      .div(precio)
      .toDecimalPlaces(ESCALA_COSTO, Decimal.ROUND_HALF_UP);
  }

  private precioSugerido(
    precioViejo: Decimal,
    costoViejo: Decimal,
    costoNuevo: Decimal,
  ): Decimal | null {
    const margen = this.margenPct(precioViejo, costoViejo);
    if (margen === null) return null;
    if (margen.greaterThanOrEqualTo(1)) return null;
    // Preserva margen %: costoNuevo × precioViejo / costoViejo
    // (= costoNuevo / (1 − margenViejo)). Null si costoViejo ≤ 0.
    if (costoViejo.lessThanOrEqualTo(0)) return null;
    // Propuesta de precio de lista que preserva el margen: tasa, no monto (el
    // precio unitario tiene decimales propios — el propio SII da 6 a PrcItem).
    // Escala 4 solo para viajar en el DTO; el precio real lo decide el usuario al
    // aplicar el desfase. Cuantizarlo a la escala de la moneda sería UX del
    // prefill, no una corrección.
    return costoNuevo
      .mul(precioViejo)
      .div(costoViejo)
      .toDecimalPlaces(ESCALA_COSTO, Decimal.ROUND_HALF_UP);
  }

  /**
   * `item_id → { tipo, nombre }` de los items compuestos pedidos, en una query.
   * Ausente = no existe. El nombre viene de acá y no de una query aparte porque
   * lo necesita el motivo de `omitidos`.
   */
  private async cabecerasCompuestas(
    manager: EntityManager,
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, { tipo: 'receta' | 'combo'; nombre: string }>> {
    if (!ids.length) return new Map();
    const rows: {
      item_id: string;
      tipo: 'receta' | 'combo';
      nombre: string;
    }[] = await manager.query(
      `SELECT i.item_id, i.tipo, i.nombre
           FROM items i
          WHERE i.item_id = ANY($1::uuid[]) AND i.tenant_id = $2
            AND i.eliminado_el IS NULL
            AND i.tipo IN ('receta', 'combo')`,
      [ids, tenantId],
    );
    return new Map(
      rows.map((r) => [r.item_id, { tipo: r.tipo, nombre: r.nombre }]),
    );
  }

  /** Componentes vivos de varios combos, agrupados por combo, en una query. */
  private async componentesPorCombo(
    manager: EntityManager,
    tenantId: string,
    comboIds: string[],
  ): Promise<
    Map<
      string,
      {
        componente_item_id: string;
        cantidad: string;
        costo_actual: string | null;
      }[]
    >
  > {
    const out = new Map<
      string,
      {
        componente_item_id: string;
        cantidad: string;
        costo_actual: string | null;
      }[]
    >();
    if (!comboIds.length) return out;
    const rows: {
      combo_item_id: string;
      componente_item_id: string;
      cantidad: string;
      costo_actual: string | null;
    }[] = await manager.query(
      `SELECT cc.combo_item_id, cc.componente_item_id, cc.cantidad,
              COALESCE(ip.costo_actual, ir.costo_actual) AS costo_actual
         FROM combo_componentes cc
         JOIN items comp ON comp.item_id = cc.componente_item_id
          AND comp.eliminado_el IS NULL
         LEFT JOIN item_producto ip ON ip.item_id = cc.componente_item_id
         LEFT JOIN item_receta ir ON ir.item_id = cc.componente_item_id
        WHERE cc.combo_item_id = ANY($1::uuid[]) AND cc.tenant_id = $2
          AND cc.eliminado_el IS NULL`,
      [comboIds, tenantId],
    );
    for (const r of rows) {
      const arr = out.get(r.combo_item_id) ?? [];
      arr.push(r);
      out.set(r.combo_item_id, arr);
    }
    return out;
  }

  /** Ingredientes vivos de varias recetas, agrupados por receta, en una query. */
  private async ingredientesPorReceta(
    manager: EntityManager,
    tenantId: string,
    recetaItemIds: string[],
  ): Promise<
    Map<
      string,
      {
        cantidad: string;
        unidad_codigo: string;
        unidad_base: string;
        costo_actual: string | null;
      }[]
    >
  > {
    const out = new Map<
      string,
      {
        cantidad: string;
        unidad_codigo: string;
        unidad_base: string;
        costo_actual: string | null;
      }[]
    >();
    if (!recetaItemIds.length) return out;

    const rows: {
      receta_item_id: string;
      cantidad: string;
      unidad_codigo: string;
      unidad_base: string;
      costo_actual: string | null;
    }[] = await manager.query(
      `SELECT ri.receta_item_id, ri.cantidad, ri.unidad_codigo,
              ip.unidad_medida AS unidad_base, ip.costo_actual
         FROM receta_ingredientes ri
         JOIN items ing ON ing.item_id = ri.ingrediente_item_id
          AND ing.eliminado_el IS NULL
         JOIN item_producto ip ON ip.item_id = ri.ingrediente_item_id
        WHERE ri.receta_item_id = ANY($1::uuid[]) AND ri.tenant_id = $2
          AND ri.eliminado_el IS NULL`,
      [recetaItemIds, tenantId],
    );
    for (const r of rows) {
      const arr = out.get(r.receta_item_id) ?? [];
      arr.push(r);
      out.set(r.receta_item_id, arr);
    }
    return out;
  }

  /**
   * Costo propuesto de una receta ya persistida (ingredientes vivos). Misma
   * aritmética que `validarYCostearIngredientes`: convierte a unidad base ×
   * costo_actual.
   *
   * Recibe el conversor ya cargado (`CatalogService.crearConversor`) en vez de
   * consultar: así el catálogo de unidades se lee UNA vez por request y la
   * conversión —que puede lanzar— sigue ocurriendo dentro del loop del llamador,
   * sin adelantar sus errores por encima de las otras validaciones.
   */
  /**
   * `null` = alguno de los ingredientes tiene la unidad rota (la receta pide
   * gramos de algo que hoy se mide en litros), así que no hay costo que
   * proponer para esa receta.
   *
   * Devolver `null` en vez de dejar propagar la excepción es el mismo criterio
   * que `convertirUnidades`, y por la misma razón medida: acá `construirFilasDesfase`
   * recorre **todas** las recetas del tenant, así que una sola fila rota hacía
   * responder `400` a `GET /desfases` entero. Es un segundo sitio con la
   * misma fragilidad que el listado de items, y se encontró porque el e2e del
   * guard de unidad dejó una fila así en la base.
   */
  private costoPropuesto(
    convertir: (cantidad: string, desde: string, hacia: string) => string,
    ings: {
      cantidad: string;
      unidad_codigo: string;
      unidad_base: string;
      costo_actual: string | null;
    }[],
  ): string | null {
    let total = new Decimal(0);
    for (const ing of ings) {
      let cantidadBase: string;
      try {
        cantidadBase = convertir(
          ing.cantidad,
          ing.unidad_codigo,
          ing.unidad_base,
        );
      } catch (e) {
        // Mismo criterio acotado que `convertirUnidades`: solo el error
        // esperado de conversión se traduce a "sin costo proponible".
        if (e instanceof BadRequestException) return null;
        throw e;
      }
      total = total.plus(
        new Decimal(ing.costo_actual ?? '0').mul(cantidadBase),
      );
    }
    // Costo por unidad de receta/combo: tasa interna a escala de costo (4), HALF_UP
    // fijo — mismo criterio que el CPP. La MISMA cuenta vive dos veces: acá y en
    // validarYCostear{Ingredientes,Componentes} (el camino de escritura al crear o
    // editar). Si cambiás el criterio en una, cambialo en la otra: la bandeja de
    // desfases compara ambos resultados con eq4 y un criterio distinto la hace
    // proponer o esconder desfases fantasma.
    return total
      .toDecimalPlaces(ESCALA_COSTO, Decimal.ROUND_HALF_UP)
      .toFixed(ESCALA_COSTO);
  }

  /**
   * `runner` y `opts` son la misma forma que `filasDesfaseCombos`, y por la
   * misma razón: `descartarDesfases` necesita armar la fila de lo que cambió
   * **dentro de su transacción**, para ver los `UPDATE` que acaba de hacer.
   *
   * `opts.convertir` es el conversor YA cargado, para el llamador que tiene uno.
   * `crearConversor()` no cachea —hace un `find()` de la tabla de unidades cada
   * vez—, así que sin este parámetro `descartarDesfases` leía el mismo catálogo
   * dos veces en la misma transacción. Es el mismo criterio, y por la misma
   * razón, que ya obliga a pasárselo a `costoPropuesto`.
   */
  private async filasDesfaseRecetas(
    runner: Db | EntityManager,
    tenantId: string,
    opts: {
      insumoItemId?: string;
      recetaItemIds?: string[];
      convertir?: ConvertirUnidad;
    },
  ): Promise<DesfaseItemDto[]> {
    const filtros: string[] = [];
    const params: unknown[] = [tenantId];
    let join = '';
    if (opts.insumoItemId) {
      join = `JOIN receta_ingredientes ri
                ON ri.receta_item_id = i.item_id AND ri.eliminado_el IS NULL`;
      params.push(opts.insumoItemId);
      filtros.push(`ri.ingrediente_item_id = $${params.length}`);
    }
    if (opts.recetaItemIds) {
      if (!opts.recetaItemIds.length) return [];
      params.push(opts.recetaItemIds);
      filtros.push(`i.item_id = ANY($${params.length}::uuid[])`);
    }

    const cabeceras: {
      receta_item_id: string;
      nombre: string;
      costo_actual: string;
      costo_propuesto_omitido: string | null;
      precio_base: string;
    }[] = await runner.query(
      `SELECT DISTINCT i.item_id AS receta_item_id, i.nombre,
              ir.costo_actual, ir.costo_propuesto_omitido, i.precio_base
         FROM items i
         JOIN item_receta ir ON ir.item_id = i.item_id
         ${join}
        WHERE i.tenant_id = $1 AND i.tipo = 'receta' AND i.eliminado_el IS NULL
          ${filtros.length ? `AND ${filtros.join(' AND ')}` : ''}
        ORDER BY i.nombre`,
      params,
    );
    if (!cabeceras.length) return [];

    const ids = cabeceras.map((c) => c.receta_item_id);
    const ings: {
      receta_item_id: string;
      ingrediente_item_id: string;
      ingrediente_nombre: string;
      cantidad: string;
      unidad_codigo: string;
      unidad_base: string;
      costo_actual: string | null;
    }[] = await runner.query(
      `SELECT ri.receta_item_id, ri.ingrediente_item_id, ing.nombre AS ingrediente_nombre,
            ri.cantidad, ri.unidad_codigo, ip.unidad_medida AS unidad_base, ip.costo_actual
     FROM receta_ingredientes ri
     JOIN items ing ON ing.item_id = ri.ingrediente_item_id AND ing.eliminado_el IS NULL
     JOIN item_producto ip ON ip.item_id = ri.ingrediente_item_id
     WHERE ri.tenant_id = $1 AND ri.eliminado_el IS NULL
       AND ri.receta_item_id = ANY($2::uuid[])`,
      [tenantId, ids],
    );

    const byReceta = new Map<string, typeof ings>();
    for (const row of ings) {
      const list = byReceta.get(row.receta_item_id) ?? [];
      list.push(row);
      byReceta.set(row.receta_item_id, list);
    }

    const convertir =
      opts.convertir ?? (await this.catalogService.crearConversor());

    const out: DesfaseItemDto[] = [];
    for (const cab of cabeceras) {
      const lista = byReceta.get(cab.receta_item_id) ?? [];
      if (!lista.length) continue;
      const propuesto = this.costoPropuesto(convertir, lista);
      // Sin costo proponible (unidad rota en algún ingrediente) la receta se
      // omite de la bandeja, en vez de tumbar la respuesta para todas.
      if (propuesto === null) continue;
      const cacheado = new Decimal(cab.costo_actual ?? '0').toFixed(
        ESCALA_COSTO,
      );
      if (this.eq4(propuesto, cacheado)) continue;
      if (
        cab.costo_propuesto_omitido != null &&
        this.eq4(propuesto, cab.costo_propuesto_omitido)
      ) {
        continue;
      }

      const precio = new Decimal(cab.precio_base);
      const costoActualD = new Decimal(cacheado);
      const costoPropD = new Decimal(propuesto);
      const mAct = this.margenPct(precio, costoActualD);
      const mProp = this.margenPct(precio, costoPropD);
      const sug = this.precioSugerido(precio, costoActualD, costoPropD);

      out.push({
        itemId: cab.receta_item_id,
        tipo: 'receta',
        nombre: cab.nombre,
        costoActual: cacheado,
        costoPropuesto: propuesto,
        deltaCosto: costoPropD.minus(costoActualD).toFixed(ESCALA_COSTO),
        precioBase: precio.toFixed(4),
        margenPctActual: mAct?.toFixed(ESCALA_COSTO) ?? null,
        margenPctPropuesto: mProp?.toFixed(ESCALA_COSTO) ?? null,
        precioSugerido: sug?.toFixed(4) ?? null,
        afectados: lista.map((i) => ({
          itemId: i.ingrediente_item_id,
          nombre: i.ingrediente_nombre,
          costoActual: i.costo_actual,
        })),
      });
    }
    return out;
  }

  private async construirFilasDesfase(
    tenantId: string,
    insumoItemId?: string,
  ): Promise<DesfaseItemDto[]> {
    // Dos bloques de 2 queries cada uno, no una query por item: el costo de un
    // combo se arma con los costos YA cacheados de sus componentes, así que no
    // hace falta expandir nada.
    const recetas = await this.filasDesfaseRecetas(this.db, tenantId, {
      insumoItemId,
    });
    const combos = await this.filasDesfaseCombos(this.db, tenantId, {
      insumoItemId,
    });
    return [...recetas, ...combos].sort((a, b) =>
      a.nombre.localeCompare(b.nombre),
    );
  }

  /**
   * Costo propuesto de un combo: Σ(costo cacheado del componente × cantidad),
   * la misma fórmula de `validarYCostearComponentes`. A diferencia de
   * `costoPropuesto` (recetas) **nunca devuelve null**: no hay conversión de
   * unidades acá, así que el caso "sin costo proponible" no existe. Un
   * componente `servicio` no tiene costo y aporta 0, igual que al armar el combo.
   */
  private costoPropuestoCombo(
    comps: { cantidad: string; costo_actual: string | null }[],
  ): string {
    let total = new Decimal(0);
    for (const c of comps) {
      total = total.plus(new Decimal(c.costo_actual ?? '0').mul(c.cantidad));
    }
    // Costo por unidad de receta/combo: tasa interna a escala de costo (4), HALF_UP
    // fijo — mismo criterio que el CPP. La MISMA cuenta vive dos veces: acá y en
    // validarYCostear{Ingredientes,Componentes} (el camino de escritura al crear o
    // editar). Si cambiás el criterio en una, cambialo en la otra: la bandeja de
    // desfases compara ambos resultados con eq4 y un criterio distinto la hace
    // proponer o esconder desfases fantasma.
    return total
      .toDecimalPlaces(ESCALA_COSTO, Decimal.ROUND_HALF_UP)
      .toFixed(ESCALA_COSTO);
  }

  /**
   * `runner` es la fachada `Db` en la lectura y el `EntityManager` de la
   * transacción cuando `aplicarDesfases` necesita ver sus propias escrituras.
   */
  private async filasDesfaseCombos(
    runner: Db | EntityManager,
    tenantId: string,
    opts: { insumoItemId?: string; comboItemIds?: string[] },
  ): Promise<DesfaseItemDto[]> {
    const filtros: string[] = [];
    const params: unknown[] = [tenantId];
    let join = '';
    if (opts.insumoItemId) {
      join = `JOIN combo_componentes cc ON cc.combo_item_id = i.item_id
                AND cc.eliminado_el IS NULL`;
      params.push(opts.insumoItemId);
      filtros.push(`cc.componente_item_id = $${params.length}`);
    }
    if (opts.comboItemIds) {
      if (!opts.comboItemIds.length) return [];
      params.push(opts.comboItemIds);
      filtros.push(`i.item_id = ANY($${params.length}::uuid[])`);
    }

    const cabeceras: {
      combo_item_id: string;
      nombre: string;
      costo_actual: string | null;
      costo_propuesto_omitido: string | null;
      precio_base: string;
    }[] = await runner.query(
      `SELECT DISTINCT i.item_id AS combo_item_id, i.nombre,
              ic.costo_actual, ic.costo_propuesto_omitido, i.precio_base
         FROM items i
         JOIN item_combo ic ON ic.item_id = i.item_id
         ${join}
        WHERE i.tenant_id = $1 AND i.tipo = 'combo' AND i.eliminado_el IS NULL
          ${filtros.length ? `AND ${filtros.join(' AND ')}` : ''}
        ORDER BY i.nombre`,
      params,
    );
    if (!cabeceras.length) return [];

    const ids = cabeceras.map((c) => c.combo_item_id);
    const comps: {
      combo_item_id: string;
      componente_item_id: string;
      componente_nombre: string;
      cantidad: string;
      costo_actual: string | null;
    }[] = await runner.query(
      `SELECT cc.combo_item_id, cc.componente_item_id,
              comp.nombre AS componente_nombre, cc.cantidad,
              COALESCE(ip.costo_actual, ir.costo_actual) AS costo_actual
         FROM combo_componentes cc
         JOIN items comp ON comp.item_id = cc.componente_item_id
          AND comp.eliminado_el IS NULL
         LEFT JOIN item_producto ip ON ip.item_id = cc.componente_item_id
         LEFT JOIN item_receta ir ON ir.item_id = cc.componente_item_id
        WHERE cc.tenant_id = $1 AND cc.eliminado_el IS NULL
          AND cc.combo_item_id = ANY($2::uuid[])`,
      [tenantId, ids],
    );

    const porCombo = new Map<string, typeof comps>();
    for (const row of comps) {
      const list = porCombo.get(row.combo_item_id) ?? [];
      list.push(row);
      porCombo.set(row.combo_item_id, list);
    }

    const out: DesfaseItemDto[] = [];
    for (const cab of cabeceras) {
      const lista = porCombo.get(cab.combo_item_id) ?? [];
      // Mismo guard que las recetas sin ingredientes: un combo sin componentes
      // vivos no tiene costo que proponer.
      if (!lista.length) continue;
      const propuesto = this.costoPropuestoCombo(lista);
      const cacheado = new Decimal(cab.costo_actual ?? '0').toFixed(
        ESCALA_COSTO,
      );
      if (this.eq4(propuesto, cacheado)) continue;
      if (
        cab.costo_propuesto_omitido != null &&
        this.eq4(propuesto, cab.costo_propuesto_omitido)
      ) {
        continue;
      }

      const precio = new Decimal(cab.precio_base);
      const costoActualD = new Decimal(cacheado);
      const costoPropD = new Decimal(propuesto);

      out.push({
        itemId: cab.combo_item_id,
        tipo: 'combo',
        nombre: cab.nombre,
        costoActual: cacheado,
        costoPropuesto: propuesto,
        deltaCosto: costoPropD.minus(costoActualD).toFixed(ESCALA_COSTO),
        precioBase: precio.toFixed(4),
        margenPctActual:
          this.margenPct(precio, costoActualD)?.toFixed(ESCALA_COSTO) ?? null,
        margenPctPropuesto:
          this.margenPct(precio, costoPropD)?.toFixed(ESCALA_COSTO) ?? null,
        precioSugerido:
          this.precioSugerido(precio, costoActualD, costoPropD)?.toFixed(4) ??
          null,
        afectados: lista.map((c) => ({
          itemId: c.componente_item_id,
          nombre: c.componente_nombre,
          costoActual: c.costo_actual,
        })),
      });
    }
    return out;
  }

  async listarDesfases(
    tenantId: string,
    insumoItemId?: string,
  ): Promise<DesfaseItemDto[]> {
    return this.construirFilasDesfase(tenantId, insumoItemId);
  }

  async itemsAfectadosPorInsumo(
    tenantId: string,
    insumoItemId: string,
  ): Promise<DesfaseItemDto[]> {
    // `ingrediente` y `producto` son tipos distintos y sus caminos no se cruzan:
    // una receta solo lleva ingredientes, y un componente de combo solo puede
    // ser producto, receta o servicio. Con el guard viejo (`= 'ingrediente'`)
    // comprar un producto devolvía 404 y el frontend se lo tragaba: ningún
    // modal se abría nunca para un componente de combo.
    const exists: unknown[] = await this.db.query(
      `SELECT 1 FROM items
     WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
       AND tipo IN ('ingrediente', 'producto')`,
      [insumoItemId, tenantId],
    );
    if (!exists.length) throw new NotFoundException('Item no encontrado');
    return this.construirFilasDesfase(tenantId, insumoItemId);
  }

  async aplicarDesfases(
    tenantId: string,
    items: {
      itemId: string;
      actualizarPrecio?: boolean;
      precioBase?: string;
    }[],
  ): Promise<{
    aplicados: number;
    omitidos: { itemId: string; nombre: string; motivo: string }[];
    afectados: DesfaseItemDto[];
  }> {
    for (const it of items) {
      if (it.actualizarPrecio) {
        let p: Decimal;
        try {
          p = new Decimal(it.precioBase ?? '');
        } catch {
          throw new BadRequestException('precioBase inválido');
        }
        if (p.isNaN() || p.lessThanOrEqualTo(0)) {
          throw new BadRequestException(
            'precioBase debe ser mayor a 0 cuando actualizarPrecio es true',
          );
        }
      }
    }

    return this.db.transaccion(async (manager) => {
      // Cabeceras e ingredientes de TODAS las recetas del lote en 2 queries.
      // El loop de abajo se conserva —y con él el orden exacto en que fallan
      // las validaciones— pero ya no consulta: antes eran 2 lecturas por receta
      // más una por ingrediente adentro del cálculo del costo.
      const ids = [...new Set(items.map((i) => i.itemId))];

      // La validación de tenant va ANTES de los locks: `cabecerasCompuestas`
      // es quien filtra `tenant_id`, y con los locks primero un id ajeno
      // bloqueaba filas de otro tenant hasta el rollback del 404. Lee `items`
      // sin lock, así que subirla no toma nada por adelantado.
      const cabPorId = await this.cabecerasCompuestas(manager, tenantId, ids);
      for (const it of items) {
        if (!cabPorId.has(it.itemId)) {
          throw new NotFoundException(`Item ${it.itemId} no encontrado`);
        }
      }
      // Los locks de abajo bloquean `ids` y no un subconjunto "ya validado":
      // el loop de arriba tira ante el PRIMER id que no esté en `cabPorId`, así
      // que llegar hasta acá significa que los dos conjuntos son el mismo y
      // filtrar sería la identidad. El acoplamiento sí importa: si algún día la
      // validación pasa a saltear los ids ajenos en vez de tirar, hay que
      // filtrar acá antes de bloquear — bloquear un id sin validar es
      // exactamente el bug que subir `cabecerasCompuestas` vino a cerrar.

      // Los locks van ANTES de leer los ingredientes, no antes de escribir: si
      // se toman después, otra transacción alcanza a cambiar la receta entre la
      // lectura y el lock y el costo se calcula sobre ingredientes viejos.
      //
      // `ORDER BY` no es cosmético: sin él, el orden de bloqueo lo decide el
      // plan, y dos lotes con recetas en común se toman las filas en órdenes
      // distintos y se abrazan. El orden del lote lo pone el cliente — es
      // exactamente el caso que hay que neutralizar.
      //
      // Y el orden ENTRE las dos tablas es siempre el mismo —`item_receta`
      // primero, `item_combo` después— por la misma razón: un lote mixto y otro
      // que las tomara al revés cerrarían el ciclo A→B / B→A.
      await manager.query(
        `SELECT item_id FROM item_receta
          WHERE item_id = ANY($1) ORDER BY item_id FOR UPDATE`,
        [ids],
      );
      await manager.query(
        `SELECT item_id FROM item_combo
          WHERE item_id = ANY($1) ORDER BY item_id FOR UPDATE`,
        [ids],
      );

      const recetasDelLote = items.filter(
        (i) => cabPorId.get(i.itemId)!.tipo === 'receta',
      );
      const combosDelLote = items.filter(
        (i) => cabPorId.get(i.itemId)!.tipo === 'combo',
      );

      const ingsPorReceta = await this.ingredientesPorReceta(
        manager,
        tenantId,
        recetasDelLote.map((r) => r.itemId),
      );

      let aplicados = 0;
      // El catálogo de unidades solo lo necesitan las recetas: un lote de solo
      // combos no lo carga.
      const convertir = recetasDelLote.length
        ? await this.catalogService.crearConversor()
        : null;
      for (const it of recetasDelLote) {
        if (!ingsPorReceta.get(it.itemId)?.length) {
          throw new BadRequestException(
            `La receta ${it.itemId} no tiene ingredientes`,
          );
        }

        // `convertir` no es null acá: el loop solo corre si hay recetas, que es
        // exactamente la condición con la que se cargó el catálogo.
        const propuesto = this.costoPropuesto(
          convertir!,
          ingsPorReceta.get(it.itemId)!,
        );
        // La bandeja LEE tolerante (omite la receta sin costo proponible), pero
        // ESCRIBIR es otra cosa: `costo_actual` es dinero y la columna es
        // nullable, así que un `null` acá se persistiría en silencio y después
        // se leería como costo 0 al costear un combo que use esta receta.
        // Falla ruidoso, como fallaba antes de que `costoPropuesto` dejara de
        // propagar la excepción — pero nombrando la receta y la causa.
        if (propuesto === null) {
          throw new BadRequestException(
            `No se puede calcular el costo de la receta ${it.itemId}: ` +
              'alguno de sus ingredientes tiene una unidad incompatible con la ' +
              'que la receta declara. Corregí esa unidad antes de aplicar.',
          );
        }
        await manager.query(
          `UPDATE item_receta
           SET costo_actual = $1, costo_propuesto_omitido = NULL
           WHERE item_id = $2`,
          [propuesto, it.itemId],
        );

        if (it.actualizarPrecio && it.precioBase) {
          const precio = new Decimal(it.precioBase)
            .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
            .toFixed(4);
          await manager.query(
            `UPDATE items SET precio_base = $1
             WHERE item_id = $2 AND tenant_id = $3 AND eliminado_el IS NULL`,
            [precio, it.itemId, tenantId],
          );
        }
        aplicados += 1;
      }

      const compsPorCombo = await this.componentesPorCombo(
        manager,
        tenantId,
        combosDelLote.map((c) => c.itemId),
      );
      const recetasAplicadas = new Set(recetasDelLote.map((r) => r.itemId));
      const omitidos: { itemId: string; nombre: string; motivo: string }[] = [];

      for (const it of combosDelLote) {
        const comps = compsPorCombo.get(it.itemId) ?? [];
        if (!comps.length) {
          throw new BadRequestException(
            `El combo ${it.itemId} no tiene componentes`,
          );
        }
        // El lote que se pisa a sí mismo: si una receta de este mismo lote es
        // componente de este combo, aplicarlo lo escribiría con un costo
        // distinto del que el usuario aprobó, y con un precio calculado para el
        // número viejo. Se omite y vuelve en `afectados` con el costo nuevo.
        const dependiente = comps.find((c) =>
          recetasAplicadas.has(c.componente_item_id),
        );
        if (dependiente) {
          omitidos.push({
            itemId: it.itemId,
            nombre: cabPorId.get(it.itemId)!.nombre,
            motivo:
              'Depende de una receta de este mismo lote: se recalcula y vuelve a proponerse.',
          });
          continue;
        }

        const propuesto = this.costoPropuestoCombo(comps);
        await manager.query(
          `UPDATE item_combo
             SET costo_actual = $1, costo_propuesto_omitido = NULL
           WHERE item_id = $2`,
          [propuesto, it.itemId],
        );
        if (it.actualizarPrecio && it.precioBase) {
          const precio = new Decimal(it.precioBase)
            .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
            .toFixed(4);
          await manager.query(
            `UPDATE items SET precio_base = $1
             WHERE item_id = $2 AND tenant_id = $3 AND eliminado_el IS NULL`,
            [precio, it.itemId, tenantId],
          );
        }
        aplicados += 1;
      }

      // Los combos que contienen alguna de las recetas recién aplicadas y que
      // quedaron desfasados. Se lee con el `manager` de la transacción para ver
      // sus escrituras antes del commit. (Desde ADR-020 `db.query` resolvería el
      // mismo manager; el explícito se queda porque no depende del contexto.)
      let afectados: DesfaseItemDto[] = [];
      if (recetasAplicadas.size) {
        const combosCandidatos: { combo_item_id: string }[] =
          await manager.query(
            `SELECT DISTINCT cc.combo_item_id
               FROM combo_componentes cc
              WHERE cc.tenant_id = $1 AND cc.eliminado_el IS NULL
                AND cc.componente_item_id = ANY($2::uuid[])`,
            [tenantId, [...recetasAplicadas]],
          );
        afectados = await this.filasDesfaseCombos(manager, tenantId, {
          comboItemIds: combosCandidatos.map((c) => c.combo_item_id),
        });
      }
      return { aplicados, omitidos, afectados };
    });
  }

  /**
   * Descarta el aviso de desfase de varios ítems: archiva el costo propuesto en
   * `costo_propuesto_omitido`, y la bandeja deja de mostrar la fila mientras el
   * propuesto siga siendo ese.
   *
   * ⚠️ **Archiva el propuesto que el usuario VIO, no uno recalculado.** Hasta el
   * 2026-08-25 recalculaba, y eso silenciaba desfases: medido contra la API, el
   * usuario veía 1120, cambiaba el costo de un ingrediente, y el descarte
   * archivaba 1019,98 —un número que nunca estuvo en pantalla—; con el predicado
   * de la bandeja (oculta si propuesto == omitido) la fila desaparecía y el
   * desfase nuevo quedaba sin ver.
   *
   * **No es una carrera, y por eso no se arregla con un lock.** El recálculo es
   * desde cero, así que cualquier cambio entre abrir la bandeja y hacer clic lo
   * dispara —el mismo usuario, en otra pestaña, con minutos de diferencia—. Un
   * `FOR UPDATE` cubre milisegundos; la ventana real es lo que la pantalla esté
   * abierta. Lo que la cierra es que el dato viaje desde el cliente.
   *
   * **Cuando el propuesto cambió, esa fila NO se descarta y se informa**
   * (decisión del owner, 2026-08-25): las demás del lote sí, para que una fila
   * ajena no bloquee el trabajo. La que cambió vuelve a la bandeja con su número
   * nuevo y el usuario la decide de nuevo, viéndolo.
   */
  async descartarDesfases(
    tenantId: string,
    items: { itemId: string; costoPropuestoVisto: string }[],
  ): Promise<{
    descartados: number;
    cambiados: {
      itemId: string;
      nombre: string;
      costoPropuestoActual: string;
      /**
       * La fila lista para volver a pintarse, o `null` si ese ítem **ya no está
       * desfasado** (el costo del insumo volvió a lo que estaba). Existe para
       * que el frontend no tenga que recargar: la recarga del drawer preguntaba
       * `afectados(insumo)`, un alcance más angosto que lo que el drawer
       * muestra, y avisaba sobre filas que sacaba de pantalla.
       */
      fila: DesfaseItemDto | null;
    }[];
  }> {
    return this.db.transaccion(async (manager) => {
      // Mismo batch que `aplicarDesfases`: 2 lecturas para todo el lote, loop
      // conservado para no alterar el orden de las validaciones.
      const ids = [...new Set(items.map((i) => i.itemId))];
      const cabPorId = await this.cabecerasCompuestas(manager, tenantId, ids);
      for (const { itemId } of items) {
        if (!cabPorId.has(itemId)) {
          throw new NotFoundException(`Item ${itemId} no encontrado`);
        }
      }
      // Cada helper recibe solo los ids de su tipo: con un lote de un solo tipo
      // el otro retorna sin consultar.
      const ingsPorReceta = await this.ingredientesPorReceta(
        manager,
        tenantId,
        ids.filter((id) => cabPorId.get(id)!.tipo === 'receta'),
      );
      const compsPorCombo = await this.componentesPorCombo(
        manager,
        tenantId,
        ids.filter((id) => cabPorId.get(id)!.tipo === 'combo'),
      );
      // El catálogo de unidades solo lo necesitan las recetas.
      const convertir = ids.some((id) => cabPorId.get(id)!.tipo === 'receta')
        ? await this.catalogService.crearConversor()
        : null;

      let descartados = 0;
      const cambiados: {
        itemId: string;
        nombre: string;
        costoPropuestoActual: string;
        fila: DesfaseItemDto | null;
      }[] = [];
      // Orden de bloqueo declarado (`docs/patterns/backend.md`): item_receta →
      // item_combo → items. Los UPDATE de acá abajo toman lock de fila igual
      // que un FOR UPDATE, así que recorrer el lote en el orden que manda el
      // cliente dejaba que dos `descartar` con las mismas filas en orden
      // distinto se abrazaran (40P01). `aplicarDesfases` ya ordena receta →
      // combo; esto alinea los dos caminos de la bandeja. Dentro de cada
      // pasada, además, se ordena por `item_id` — igual que el
      // `ORDER BY item_id` de los dos `SELECT … FOR UPDATE` de
      // `aplicarDesfases` — porque `descartarDesfases` no toma ningún lock
      // explícito: el lock lo toma cada `UPDATE`, en el orden en que se
      // ejecuta. Sin este segundo orden, dos recetas (o dos combos) sin
      // ningún ítem del otro tipo de por medio seguían pudiendo abrazarse si
      // dos lotes las traían en sentidos opuestos.
      //
      // ⚠️ Se ordena por `itemId` pero **se conserva cada entrada del lote**, no
      // se deduplica: un id repetido seguía contando dos veces en `descartados`
      // y sigue contando dos veces ahora. `Array.prototype.sort` es estable, así
      // que dos entradas del mismo id no cambian de posición relativa entre sí y
      // cada una conserva SU `costoPropuestoVisto`.
      //
      // 📌 Consecuencia del cruce, alcanzable solo por API: un lote
      // `[{id, '700'}, {id, '900'}]` compara las DOS ocurrencias contra el mismo
      // propuesto recalculado una vez, así que ese id puede salir en
      // `descartados` **y** en `cambiados` a la vez. El panel no lo produce
      // —`onDescartar` mapea filas únicas—, y no se rechaza porque no hay
      // lectura razonable de "el usuario vio dos números distintos para la misma
      // fila".
      //
      // Efecto observable asumido: en un lote mixto con errores en los dos
      // tipos, falla primero el de la receta (misma precedencia que ya
      // tenía `aplicarDesfases`); y dentro de una misma pasada, si hay
      // errores en más de un id, sale primero el de `item_id` menor,
      // no el que vino primero en el lote del cliente.
      const porTipo = (tipo: 'receta' | 'combo') =>
        items
          .filter((i) => cabPorId.get(i.itemId)!.tipo === tipo)
          .sort((a, b) =>
            a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0,
          );

      for (const { itemId, costoPropuestoVisto } of porTipo('receta')) {
        if (!ingsPorReceta.get(itemId)?.length) {
          throw new BadRequestException(
            `La receta ${itemId} no tiene ingredientes`,
          );
        }
        const propuesto = this.costoPropuesto(
          convertir!,
          ingsPorReceta.get(itemId)!,
        );
        // Mismo criterio que `aplicarDesfases`: sin costo proponible no hay nada
        // que descartar, y escribir `null` en `costo_propuesto_omitido` lo
        // volvería "sin omisión" — la receta reaparecería en la bandeja en la
        // siguiente lectura, con el usuario creyendo que la descartó.
        if (propuesto === null) {
          throw new BadRequestException(
            `No se puede calcular el costo de la receta ${itemId}: ` +
              'alguno de sus ingredientes tiene una unidad incompatible con la ' +
              'que la receta declara. Corregí esa unidad antes de descartar.',
          );
        }
        // La misma comparación que usa el predicado de la bandeja
        // (`listarDesfases`), para que "coincide" signifique lo mismo en los dos
        // lados: si acá pasara y allá no, la fila volvería igual.
        if (!this.eq4(propuesto, costoPropuestoVisto)) {
          cambiados.push({
            itemId,
            nombre: cabPorId.get(itemId)!.nombre,
            costoPropuestoActual: propuesto,
            fila: null,
          });
          continue;
        }
        await manager.query(
          `UPDATE item_receta SET costo_propuesto_omitido = $1 WHERE item_id = $2`,
          [propuesto, itemId],
        );
        descartados += 1;
      }

      for (const { itemId, costoPropuestoVisto } of porTipo('combo')) {
        const comps = compsPorCombo.get(itemId) ?? [];
        if (!comps.length) {
          throw new BadRequestException(
            `El combo ${itemId} no tiene componentes`,
          );
        }
        // Sin caso de error propio: `costoPropuestoCombo` nunca devuelve
        // null, así que el 400 de unidad incompatible no aplica acá.
        const propuestoCombo = this.costoPropuestoCombo(comps);
        if (!this.eq4(propuestoCombo, costoPropuestoVisto)) {
          cambiados.push({
            itemId,
            nombre: cabPorId.get(itemId)!.nombre,
            costoPropuestoActual: propuestoCombo,
            fila: null,
          });
          continue;
        }
        await manager.query(
          `UPDATE item_combo SET costo_propuesto_omitido = $1 WHERE item_id = $2`,
          [propuestoCombo, itemId],
        );
        descartados += 1;
      }
      // La fila completa de lo que cambió, para que el frontend la muestre sin
      // volver a preguntar. Se arma con los MISMOS constructores que la bandeja
      // —predicado incluido—, no con un builder aparte: así una fila que dejó de
      // estar desfasada (el usuario revirtió el costo del insumo, o el propuesto
      // nuevo coincide con el omitido) sale `null` en vez de aparecer con delta
      // 0. Se lee con el `manager` para ver los UPDATE de arriba: los ítems que
      // SÍ se descartaron quedan filtrados por su propio `costo_propuesto_omitido`.
      //
      // Cuesta 0 queries en el camino normal (`cambiados` vacío) y hasta 4 en el
      // que ya es la excepción: dos por tipo —cabeceras y componentes—, y cada
      // helper vuelve sin consultar si no le toca ningún id. Son 4 y no 5 porque
      // el conversor viaja: `crearConversor()` no cachea, y sin pasarlo esto
      // releía la tabla de unidades que el loop de arriba ya había cargado.
      if (cambiados.length) {
        const idsPorTipo = (tipo: 'receta' | 'combo') => [
          ...new Set(
            cambiados
              .filter((c) => cabPorId.get(c.itemId)!.tipo === tipo)
              .map((c) => c.itemId),
          ),
        ];
        const filas = [
          ...(await this.filasDesfaseRecetas(manager, tenantId, {
            recetaItemIds: idsPorTipo('receta'),
            // `null` solo cuando el lote no trae ninguna receta, y en ese caso
            // la lista de ids está vacía y el helper vuelve sin usarlo.
            convertir: convertir ?? undefined,
          })),
          ...(await this.filasDesfaseCombos(manager, tenantId, {
            comboItemIds: idsPorTipo('combo'),
          })),
        ];
        const porId = new Map(filas.map((f) => [f.itemId, f]));
        for (const c of cambiados) c.fila = porId.get(c.itemId) ?? null;
      }
      return { descartados, cambiados };
    });
  }
  private async validarMoneda(
    manager: EntityManager,
    tenantId: string,
    monedaId: string,
  ): Promise<{ codigo: string; simbolo: string | null }> {
    const rows: { codigo_iso: string; simbolo: string | null }[] =
      await manager.query(
        `SELECT m.codigo_iso, m.simbolo FROM pais_moneda pm
         JOIN moneda m ON m.moneda_id = pm.moneda_id AND m.eliminado_el IS NULL
         JOIN provincia prov ON prov.pais_id = pm.pais_id AND prov.eliminado_el IS NULL
         JOIN tenants t ON t.provincia_id = prov.provincia_id AND t.eliminado_el IS NULL
         WHERE t.tenant_id = $1 AND pm.moneda_id = $2 AND pm.eliminado_el IS NULL`,
        [tenantId, monedaId],
      );
    if (!rows.length) {
      throw new BadRequestException(
        'La moneda no está disponible para este tenant',
      );
    }
    return { codigo: rows[0].codigo_iso, simbolo: rows[0].simbolo };
  }

  /**
   * Una categoría pausada (`activo = false`) no acepta asignaciones nuevas
   * (decisión del owner, 2026-08-11): pausar significa "no se usa más", y hasta
   * ahora eso lo sostenía solo el frontend —`items.vue` filtra la lista— así que
   * un POST/PATCH directo la asignaba igual. Mismo criterio que
   * `validarImpresoraComanda` en `categorias.service.ts`, que ya exigía `activo`.
   *
   * ⚠️ Lo que NO hace: tocar los vínculos existentes. Un ítem no pierde su
   * categoría porque la categoría se pause — se rechaza la asignación nueva y
   * nada más. Por eso el filtro va acá y no en las lecturas.
   *
   * El `activo` se lee y se evalúa en TypeScript en vez de sumarlo al `WHERE`:
   * así "no es de este tenant" y "está pausada" son dos errores distintos, que
   * es la diferencia entre un id equivocado y una decisión de negocio.
   */
  private async validarCategoria(
    manager: EntityManager,
    tenantId: string,
    categoriaId: string,
  ): Promise<string> {
    const rows: { nombre: string; activo: boolean }[] = await manager.query(
      `SELECT nombre, activo FROM categorias
       WHERE categoria_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [categoriaId, tenantId],
    );
    if (!rows.length) {
      throw new BadRequestException('La categoría no pertenece a este tenant');
    }
    if (!rows[0].activo) {
      throw new BadRequestException(
        `La categoría "${rows[0].nombre}" está pausada y no admite asignaciones nuevas`,
      );
    }
    return rows[0].nombre;
  }

  /**
   * Las reglas que se asocian a un ítem tienen que existir en el tenant **y ser
   * de nivel línea**. Una regla de nivel venta se elige en la venta y se evalúa
   * contra el total: asociada a un ítem se evaluaría contra la línea y cobraría
   * otra cosa —un "10% sobre compras de $50.000" se dispararía con una línea de
   * $50.000 dentro de una venta de $60.000—. Ésta es una de las dos puertas
   * donde el nivel se hace cumplir; la otra está en `CalculoPreciosService`.
   *
   * Los dos motivos van por separado a propósito: "no pertenece a este tenant"
   * mandaba a buscar un problema de permisos donde el problema es de nivel.
   *
   * Sigue siendo **una sola query** para todos los ids (`= ANY`), no una por
   * regla: `nivel` viaja en el mismo SELECT que ya validaba pertenencia.
   */
  private async validarReglas(
    manager: EntityManager,
    tenantId: string,
    ids: string[],
    tabla: string,
    pkCol: string,
  ): Promise<void> {
    // `FOR SHARE`, no `FOR UPDATE`: dos asociaciones concurrentes de la misma
    // regla a ítems distintos no tienen por qué estorbarse, y lo único que hay
    // que excluir es el cambio de nivel de la regla, que toma `FOR UPDATE`
    // (`descuentos.service.ts` / `recargos.service.ts` → `validarCambioDeNivel`).
    // Sin este lock la validación es un phantom: bajo READ COMMITTED el `COUNT`
    // de esa otra puerta puede correr antes de este `INSERT` y su `UPDATE`
    // después, y queda una fila puente con una regla de nivel venta — el estado
    // que las dos puertas existen para impedir.
    //
    // Va en el MISMO statement que lee `nivel` a propósito: cuando el lock se
    // espera, Postgres reevalúa la fila ya actualizada (EvalPlanQual), así que
    // el `nivel` que se compara abajo es el de después del commit ajeno, no el
    // que se leyó antes de bloquear.
    //
    // Un solo statement con `ANY(...)`: las filas se lockean en orden de plan,
    // igual para las dos transacciones, así que no hace falta un `ORDER BY`
    // para evitar el cruce entre dos asociaciones (misma refutación que en
    // `fusionarCuentas`). El orden ENTRE tablas sí importa y es el de acá:
    // reglas antes que `items` (docs/patterns/backend.md § 15).
    const rows: { nivel: NivelRegla }[] = await manager.query(
      `SELECT nivel FROM ${tabla}
       WHERE ${pkCol} = ANY($1::uuid[]) AND tenant_id = $2 AND eliminado_el IS NULL
       FOR SHARE`,
      [ids, tenantId],
    );
    if (rows.length !== ids.length) {
      throw new BadRequestException(
        `Una o más reglas de ${tabla} no pertenecen a este tenant`,
      );
    }
    if (rows.some((r) => r.nivel === NivelRegla.VENTA)) {
      throw new BadRequestException(
        `Una o más reglas de ${tabla} son de nivel venta: se eligen en la venta, no se asocian a un ítem`,
      );
    }
  }

  /**
   * Impuestos válidos: personalizados del tenant o del catálogo del sistema del
   * país del tenant. Y **nunca el IVA**: se deriva de `clasificacion_tributaria`,
   * no se asigna por ítem (ADR-018).
   */
  private async validarImpuestos(
    manager: EntityManager,
    tenantId: string,
    ids: string[],
  ): Promise<void> {
    const rows: { impuesto_id: string; tipo: string }[] = await manager.query(
      `SELECT i.impuesto_id, i.tipo FROM impuestos i
        WHERE i.impuesto_id = ANY($1::uuid[]) AND i.eliminado_el IS NULL
          AND (i.tenant_id = $2
               OR i.pais_id = (SELECT p.pais_id
                                 FROM tenants t
                                 JOIN provincia p ON p.provincia_id = t.provincia_id
                                WHERE t.tenant_id = $2 AND t.eliminado_el IS NULL))`,
      [ids, tenantId],
    );
    if (rows.length !== ids.length) {
      throw new BadRequestException(
        'Uno o más impuestos no están disponibles para este tenant',
      );
    }
    if (rows.some((r) => r.tipo === 'iva')) {
      throw new BadRequestException(
        'El IVA no se asigna por ítem ni por línea: sale de la clasificación tributaria',
      );
    }
  }

  private async insertarRelaciones(
    manager: EntityManager,
    itemId: string,
    impuestosIds: string[],
    recargosIds: string[],
    descuentosIds: string[],
  ): Promise<void> {
    for (const id of impuestosIds) {
      await manager.query(
        `INSERT INTO item_impuestos (item_id, impuesto_id) VALUES ($1,$2)`,
        [itemId, id],
      );
    }
    for (const id of recargosIds) {
      await manager.query(
        `INSERT INTO item_recargos (item_id, recargo_id) VALUES ($1,$2)`,
        [itemId, id],
      );
    }
    for (const id of descuentosIds) {
      await manager.query(
        `INSERT INTO item_descuentos (item_id, descuento_id) VALUES ($1,$2)`,
        [itemId, id],
      );
    }
  }

  /**
   * Upsert de la asociación item↔grupo preservando `item_grupo_id` de los grupos
   * que persisten (para no huérfanar sus overrides), + upsert de los overrides de
   * consumo/recargo por opción. Soft-borra asociaciones y overrides que desaparecen.
   */
  private async asociarGruposModificadores(
    manager: EntityManager,
    tenantId: string,
    itemId: string,
    grupos: ItemGrupoModificadorInputDto[],
  ): Promise<void> {
    const vivas: { item_grupo_id: string; grupo_modificador_id: string }[] =
      await manager.query(
        `SELECT item_grupo_id, grupo_modificador_id FROM item_grupos_modificadores
         WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [itemId, tenantId],
      );
    const itemGrupoIdPorGrupo = new Map(
      vivas.map((r) => [r.grupo_modificador_id, r.item_grupo_id]),
    );

    const vistos = new Set<string>();
    const gruposEntrantes = new Set<string>();
    let convertir: ConvertirUnidad | undefined;
    let orden = 0;
    for (const g of grupos) {
      if (vistos.has(g.grupoModificadorId)) {
        throw new BadRequestException(
          'Un grupo no puede asociarse dos veces al mismo item',
        );
      }
      vistos.add(g.grupoModificadorId);
      gruposEntrantes.add(g.grupoModificadorId);
      if (g.max < Math.max(g.min, 1)) {
        throw new BadRequestException(
          'El máximo del grupo debe ser mayor o igual a max(min, 1)',
        );
      }
      const grupoRows: { grupo_modificador_id: string }[] = await manager.query(
        `SELECT grupo_modificador_id FROM grupos_modificadores
         WHERE grupo_modificador_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [g.grupoModificadorId, tenantId],
      );
      if (!grupoRows.length) {
        throw new BadRequestException(
          `Grupo de modificadores no encontrado: ${g.grupoModificadorId}`,
        );
      }

      let itemGrupoId = itemGrupoIdPorGrupo.get(g.grupoModificadorId);
      if (itemGrupoId) {
        await manager.query(
          `UPDATE item_grupos_modificadores
           SET min = $1, max = $2, orden = $3, actualizado_el = NOW()
           WHERE item_grupo_id = $4`,
          [g.min, g.max, g.orden ?? orden, itemGrupoId],
        );
      } else {
        const insRows: { item_grupo_id: string }[] = await manager.query(
          `INSERT INTO item_grupos_modificadores (tenant_id, item_id, grupo_modificador_id, min, max, orden)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING item_grupo_id`,
          [
            tenantId,
            itemId,
            g.grupoModificadorId,
            g.min,
            g.max,
            g.orden ?? orden,
          ],
        );
        itemGrupoId = insRows[0].item_grupo_id;
      }
      orden++;

      // `??=`: el catálogo se lee UNA vez para todos los grupos, y solo si hay
      // al menos uno que asociar (un item sin grupos no paga la query).
      convertir ??= await this.catalogService.crearConversor();
      await this.upsertOverridesDeGrupo(
        manager,
        tenantId,
        itemGrupoId,
        g.grupoModificadorId,
        g.opciones ?? [],
        convertir,
      );
    }

    // Asociaciones que desaparecen: soft-delete de la asociación + sus overrides.
    const eliminadas = vivas.filter(
      (r) => !gruposEntrantes.has(r.grupo_modificador_id),
    );
    if (eliminadas.length) {
      // Antes de borrarlas: lo que una cuenta abierta ya eligió no se saca del
      // catálogo. Desasociar un grupo que una mesa eligió rompe su línea de una
      // de **dos** maneras según lo que quede vivo, y las dos hay que
      // bloquearlas (medidas el 2026-08-30, ver el docblock de
      // `cuentasAbiertasConGrupoElegido`): o la línea deja de poder tasarse
      // ("Grupo de modificadores no asociado a este item"), o —si era el último
      // grupo vivo de un componente de combo— la elección **desaparece en
      // silencio** y la mesa paga de menos. Igual que en las otras cuatro
      // puertas, se pregunta por el **diff**:
      // solo por los grupos que se van, así que cambiarles el orden, el min/max
      // o los overrides, y agregar grupos nuevos, siguen pasando.
      const elegidos = await this.cuentasAbiertasConGrupoElegido(
        manager,
        tenantId,
        itemId,
        eliminadas.map((r) => r.grupo_modificador_id),
      );
      if (elegidos.length) {
        throw new BadRequestException(
          `No se puede desasociar del ítem un grupo ya elegido: ${elegidos
            .map((e) => `"${e.grupo}" está elegido en ${e.cuenta}`)
            .join('; ')}`,
        );
      }

      const ids = eliminadas.map((r) => r.item_grupo_id);
      await manager.query(
        `UPDATE item_grupo_modificador_opciones SET eliminado_el = NOW(), actualizado_el = NOW()
         WHERE item_grupo_id = ANY($1::uuid[]) AND eliminado_el IS NULL`,
        [ids],
      );
      await manager.query(
        `UPDATE item_grupos_modificadores SET eliminado_el = NOW(), actualizado_el = NOW()
         WHERE item_grupo_id = ANY($1::uuid[]) AND eliminado_el IS NULL`,
        [ids],
      );
    }
  }

  /** Upsert-preservando de los overrides de un grupo asociado (por grupo_opcion_id). */
  private async upsertOverridesDeGrupo(
    manager: EntityManager,
    tenantId: string,
    itemGrupoId: string,
    grupoModificadorId: string,
    opciones: ItemGrupoOpcionOverrideInputDto[],
    convertir: ConvertirUnidad,
  ): Promise<void> {
    const vivos: { item_grupo_opcion_id: string; grupo_opcion_id: string }[] =
      await manager.query(
        `SELECT item_grupo_opcion_id, grupo_opcion_id FROM item_grupo_modificador_opciones
         WHERE item_grupo_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [itemGrupoId, tenantId],
      );
    const overrideIdPorOpcion = new Map(
      vivos.map((r) => [r.grupo_opcion_id, r.item_grupo_opcion_id]),
    );
    const opcionesEntrantes = new Set<string>();

    for (const o of opciones) {
      opcionesEntrantes.add(o.grupoOpcionId);
      // La opción debe pertenecer a ESTE grupo (viva). Se traen además tipo,
      // default y unidad base para validar la unidad de ingrediente (abajo).
      const perteneceRows: {
        grupo_opcion_id: string;
        tipo: string;
        default_cantidad: string | null;
        default_unidad: string | null;
        unidad_medida: string | null;
      }[] = await manager.query(
        `SELECT o.grupo_opcion_id, i.tipo, o.cantidad AS default_cantidad,
                o.unidad_codigo AS default_unidad, ip.unidad_medida
         FROM grupo_modificador_opciones o
         JOIN items i ON i.item_id = o.item_id AND i.eliminado_el IS NULL
         LEFT JOIN item_producto ip ON ip.item_id = o.item_id
         WHERE o.grupo_opcion_id = $1 AND o.grupo_modificador_id = $2 AND o.tenant_id = $3
           AND o.eliminado_el IS NULL`,
        [o.grupoOpcionId, grupoModificadorId, tenantId],
      );
      if (!perteneceRows.length) {
        throw new BadRequestException(
          `La opción ${o.grupoOpcionId} no pertenece al grupo asociado`,
        );
      }
      if (
        o.cantidad != null &&
        o.cantidad !== '' &&
        new Decimal(o.cantidad).lessThanOrEqualTo(0)
      ) {
        throw new BadRequestException(
          'La cantidad del override debe ser mayor a 0',
        );
      }
      if (
        o.precioExtra != null &&
        o.precioExtra !== '' &&
        new Decimal(o.precioExtra).lessThan(0)
      ) {
        throw new BadRequestException(
          'El precio extra del override debe ser mayor o igual a 0',
        );
      }
      const cantidad =
        o.cantidad != null && o.cantidad !== '' ? o.cantidad : null;
      const unidad = o.unidadCodigo || null;
      const precio =
        o.precioExtra != null && o.precioExtra !== '' ? o.precioExtra : null;

      // Igual que el path del default del grupo: una opción ingrediente con
      // cantidad efectiva debe tener unidad efectiva convertible a su unidad
      // base, o el motor de inventario descontaría el número crudo como unidad
      // base (mis-medición silenciosa). Efectivas = override ?? default.
      const pertenece = perteneceRows[0];
      const efectivaCantidad = cantidad ?? pertenece.default_cantidad;
      const efectivaUnidad = unidad ?? pertenece.default_unidad;
      if (pertenece.tipo === 'ingrediente' && efectivaCantidad != null) {
        if (!efectivaUnidad) {
          throw new BadRequestException(
            'La opción ingrediente requiere unidad de medida para la cantidad configurada',
          );
        }
        convertir(efectivaCantidad, efectivaUnidad, pertenece.unidad_medida!);
      }

      const existente = overrideIdPorOpcion.get(o.grupoOpcionId);
      if (existente) {
        await manager.query(
          `UPDATE item_grupo_modificador_opciones
           SET cantidad = $1, unidad_codigo = $2, precio_extra = $3, actualizado_el = NOW()
           WHERE item_grupo_opcion_id = $4 AND tenant_id = $5`,
          [cantidad, unidad, precio, existente, tenantId],
        );
      } else {
        await manager.query(
          `INSERT INTO item_grupo_modificador_opciones
             (tenant_id, item_grupo_id, grupo_opcion_id, cantidad, unidad_codigo, precio_extra)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [tenantId, itemGrupoId, o.grupoOpcionId, cantidad, unidad, precio],
        );
      }
    }

    // Overrides que ya no vienen: soft-delete (vuelven a heredar el default).
    const aBorrar = vivos.filter(
      (r) => !opcionesEntrantes.has(r.grupo_opcion_id),
    );
    if (aBorrar.length) {
      await manager.query(
        `UPDATE item_grupo_modificador_opciones SET eliminado_el = NOW(), actualizado_el = NOW()
         WHERE item_grupo_opcion_id = ANY($1::uuid[]) AND eliminado_el IS NULL`,
        [aBorrar.map((r) => r.item_grupo_opcion_id)],
      );
    }
  }
}
