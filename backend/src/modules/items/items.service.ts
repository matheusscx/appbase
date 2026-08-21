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
import { convertirCostoUnitario } from '../../common/utils/costo-conversion-unidad.util';
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
    esPendiente: boolean;
  }[];
};

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

    return { where, params };
  }

  async findAll(
    tenantId: string,
    query: QueryItemsDto,
  ): Promise<
    PaginatedResponse<
      ReturnType<typeof this.mapRow> & {
        disponible: number | null;
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

    // Disponibilidad de recetas/combos en un nº CONSTANTE de queries (batch),
    // no una por fila (N+1).
    const recetaIds = rows
      .filter((r) => r.tipo === 'receta')
      .map((r) => r.item_id);
    const comboIds = rows
      .filter((r) => r.tipo === 'combo')
      .map((r) => r.item_id);
    const disponibilidad = await this.calcularDisponibilidadBatch(
      tenantId,
      recetaIds,
      comboIds,
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
      const disponible =
        base.tipo === 'receta' || base.tipo === 'combo'
          ? (disponibilidad.get(base.id) ?? null)
          : null;
      const disponibleCondicional =
        base.tipo === 'combo' && comboIdsConGrupos.has(base.id);
      if (!query.incluirEliminados) {
        return { ...base, disponible, disponibleCondicional };
      }
      const audit = auditoriaPorId.get(r.item_id);
      return {
        ...base,
        disponible,
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
   */
  private async cargarGruposPorItem(
    tenantId: string,
    itemIds: string[],
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

    let ingredientes: {
      ingredienteItemId: string;
      ingredienteNombre: string;
      cantidad: string;
      unidadCodigo: string;
      bloqueante: boolean;
      stock: string;
    }[] = [];
    let extrasPermitidos: {
      ingredienteItemId: string;
      ingredienteNombre: string;
      cantidad: string;
      unidadCodigo: string;
      precioExtra: string;
      stock: string;
    }[] = [];
    let componentes: {
      componenteItemId: string;
      componenteNombre: string;
      tipo: string;
      cantidad: string;
      bloqueante: boolean;
      stock: string | null;
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
      );
      componentes = compRows.map((r) => ({
        componenteItemId: r.componente_item_id,
        componenteNombre: r.componente_nombre,
        tipo: r.tipo,
        cantidad: r.cantidad,
        bloqueante: r.bloqueante,
        stock: r.stock,
        grupos: gruposPorComp.get(r.componente_item_id) ?? [],
      }));
    }

    // Los grupos del propio ítem salen de la misma función batcheada que ya se
    // usa arriba para los componentes de un combo: 2 queries fijas en vez de 1
    // por los grupos + 1 de opciones POR CADA grupo. Con `[]` no consulta nada,
    // así que un ítem sin grupos sigue costando cero.
    const grupos: GrupoDetalle[] =
      rows[0].tipo === 'combo' || rows[0].tipo === 'receta'
        ? ((await this.cargarGruposPorItem(tenantId, [itemId])).get(itemId) ??
          [])
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
      this.validarCostoPositivo(dto.costo);
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
   * Los cinco lugares donde un item puede estar en uso, en una sola query.
   * `UNION` y no `UNION ALL`: el dedupe es el mismo `DISTINCT` que hacía cada
   * query por separado. El `ORDER BY` es por determinismo — sin él el orden lo
   * decide el plan y el modal lista los motivos distinto entre llamadas.
   *
   * Cuatro son de **catálogo** y la quinta (`cuenta_lineas`) es **operativa**:
   * el ítem está pedido en una cuenta de salón abierta. Esa se acota además por
   * `estado = 'abierta'` y por el borrado de la línea, la cuenta y la mesa —sin
   * el filtro de estado, una cuenta ya cerrada volvería el ítem inborrable para
   * siempre—, y va primero en el mensaje de `remove()` porque es la única con
   * alguien esperando en la mesa.
   *
   * El filtro por tenant va sobre la entidad padre de cada rama (`items`, o
   * `grupos_modificadores` en la de opciones), no sobre la tabla puente. A
   * diferencia de `cargarReglasPorIds` —donde el JOIN a `items` es la única
   * defensa posible porque sus tablas puente (`item_impuestos`, `item_descuentos`,
   * `item_recargos`) no tienen `tenant_id` propio—, acá las cinco tablas puente
   * (`receta_ingredientes`, `combo_componentes`, `grupo_modificador_opciones`,
   * `receta_extras_permitidos`, `cuenta_lineas`) sí lo tienen. En la de cuentas
   * se filtra por la puente **y** por los padres, que es lo que hace falta para
   * no contar cuentas o mesas en la papelera.
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
            costoUnitario = convertirCostoUnitario(
              cantidadIngresada,
              costoUnitario,
              cantidad,
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

  async obtenerIngredientesReceta(
    manager: EntityManager | Db,
    tenantId: string,
    recetaItemId: string,
  ): Promise<
    {
      ingredienteItemId: string;
      ingredienteNombre: string;
      ingredienteUnidadMedida: string;
      cantidad: string;
      unidadCodigo: string;
      bloqueante: boolean;
    }[]
  > {
    const rows: {
      ingrediente_item_id: string;
      ingrediente_nombre: string;
      ingrediente_unidad_medida: string;
      cantidad: string;
      unidad_codigo: string;
      bloqueante: boolean;
    }[] = await manager.query(
      `SELECT ri.ingrediente_item_id, i.nombre AS ingrediente_nombre,
              ip.unidad_medida AS ingrediente_unidad_medida,
              ri.cantidad, ri.unidad_codigo, ri.bloqueante
       FROM receta_ingredientes ri
       JOIN items i ON i.item_id = ri.ingrediente_item_id AND i.eliminado_el IS NULL
       JOIN item_producto ip ON ip.item_id = ri.ingrediente_item_id
       WHERE ri.receta_item_id = $1 AND ri.tenant_id = $2 AND ri.eliminado_el IS NULL
       ORDER BY ri.ingrediente_item_id`,
      [recetaItemId, tenantId],
    );
    return rows.map((r) => ({
      ingredienteItemId: r.ingrediente_item_id,
      ingredienteNombre: r.ingrediente_nombre,
      ingredienteUnidadMedida: r.ingrediente_unidad_medida,
      cantidad: r.cantidad,
      unidadCodigo: r.unidad_codigo,
      bloqueante: r.bloqueante,
    }));
  }

  async obtenerExtrasPermitidos(
    manager: EntityManager | Db,
    tenantId: string,
    recetaItemId: string,
  ): Promise<
    {
      ingredienteItemId: string;
      ingredienteNombre: string;
      ingredienteUnidadMedida: string;
      cantidad: string;
      unidadCodigo: string;
      precioExtra: string;
    }[]
  > {
    const rows: {
      ingrediente_item_id: string;
      ingrediente_nombre: string;
      ingrediente_unidad_medida: string;
      cantidad: string;
      unidad_codigo: string;
      precio_extra: string;
    }[] = await manager.query(
      `SELECT re.ingrediente_item_id, i.nombre AS ingrediente_nombre,
              ip.unidad_medida AS ingrediente_unidad_medida,
              re.cantidad, re.unidad_codigo, re.precio_extra
       FROM receta_extras_permitidos re
       JOIN items i ON i.item_id = re.ingrediente_item_id AND i.eliminado_el IS NULL
       JOIN item_producto ip ON ip.item_id = re.ingrediente_item_id
       WHERE re.receta_item_id = $1 AND re.tenant_id = $2 AND re.eliminado_el IS NULL`,
      [recetaItemId, tenantId],
    );
    return rows.map((r) => ({
      ingredienteItemId: r.ingrediente_item_id,
      ingredienteNombre: r.ingrediente_nombre,
      ingredienteUnidadMedida: r.ingrediente_unidad_medida,
      cantidad: r.cantidad,
      unidadCodigo: r.unidad_codigo,
      precioExtra: r.precio_extra,
    }));
  }

  async resolverPersonalizacionReceta(
    manager: EntityManager | Db,
    tenantId: string,
    recetaItemId: string,
    dto?: PersonalizacionRecetaDto,
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

    const ingredientes = await this.obtenerIngredientesReceta(
      manager,
      tenantId,
      recetaItemId,
    );
    const extrasCat = await this.obtenerExtrasPermitidos(
      manager,
      tenantId,
      recetaItemId,
    );

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
  ): Promise<{
    snapshot: PersonalizacionRecetaSnapshot;
    precioExtraTotal: string;
  }> {
    // 1. Componentes receta del combo con sus cantidades (para validar
    //    pertenencia y rango de unidad, y saber cuántas unidades esperar).
    const compRows: {
      componente_item_id: string;
      nombre: string;
      cantidad: string;
    }[] = await manager.query(
      `SELECT cc.componente_item_id, i.nombre, cc.cantidad
       FROM combo_componentes cc
       JOIN items i ON i.item_id = cc.componente_item_id AND i.eliminado_el IS NULL
       WHERE cc.combo_item_id = $1 AND cc.tenant_id = $2
         AND cc.eliminado_el IS NULL AND i.tipo = 'receta'`,
      [comboItemId, tenantId],
    );
    const compById = new Map(compRows.map((c) => [c.componente_item_id, c]));

    // 2. El catálogo de grupos del combo Y de sus componentes receta, de una.
    //    Antes esto eran dos cosas distintas: un `SELECT DISTINCT` para saber
    //    quién tenía grupos, y después el catálogo releído entero una vez por
    //    (componente × unidad). El lote contesta las dos con dos consultas
    //    fijas: quien no aparece con grupos asociados, no tiene.
    const recetaIds = compRows.map((c) => c.componente_item_id);
    const catalogos = await this.cargarCatalogoGrupos(manager, tenantId, [
      comboItemId,
      ...recetaIds,
    ]);
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
    const omitidos = new Set(params.snapshot?.omitidos ?? []);
    const ingredientes = ingredientesBase.filter(
      (ing) => !omitidos.has(ing.ingredienteItemId),
    );

    // La unidad de STOCK de un extra es propiedad del ingrediente
    // (`item_producto.unidad_medida`), no de la lista de extras de la receta.
    // Resolverla desde el catálogo de extras la ataba a que el extra siguiera
    // en la carta, con un fallback a la unidad de la PORCIÓN que hacía que
    // `convertirUnidad` convirtiera una unidad a sí misma (20 g de queso
    // descontados como 20 kg). Hoy ese fallback no se alcanza —todo snapshot se
    // re-resuelve contra la carta viva en esta misma transacción, así que un
    // extra fuera de carta ya falló con 400 más arriba—, pero la dependencia
    // entre unidad de stock y carta no tenía por qué existir.
    const idsExtras = [
      ...new Set(params.snapshot?.extras.map((e) => e.ingredienteItemId) ?? []),
    ];
    const extrasCatRows: {
      item_id: string;
      nombre: string;
      unidad_medida: string;
    }[] = idsExtras.length
      ? await manager.query(
          `SELECT i.item_id, i.nombre, ip.unidad_medida
             FROM items i
             JOIN item_producto ip ON ip.item_id = i.item_id
            WHERE i.item_id = ANY($1::uuid[]) AND i.tenant_id = $2
              AND i.eliminado_el IS NULL`,
          [idsExtras, params.tenantId],
        )
      : [];
    const extrasCat = new Map(extrasCatRows.map((r) => [r.item_id, r]));

    const advertencias: string[] = [];

    const extrasIngredientes = (params.snapshot?.extras ?? []).flatMap(
      (extra) => {
        const cat = extrasCat.get(extra.ingredienteItemId);
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
      },
    );

    // Ordenado por id, no concatenado: `ingredientes` viene ordenado de la
    // query, pero `extrasIngredientes` sale del snapshot —o sea del orden en
    // que el cliente agregó los extras al carrito—, así que pegarlos uno detrás
    // del otro devolvía el orden del cliente a la mitad del bloqueo. Es el
    // mismo defecto que en `venderOpcionesGrupos`, un nivel adentro.
    // Efecto lateral aceptado: el orden de las advertencias de stock ahora es
    // por id y no el del snapshot. Determinista, que es lo que se busca.
    const todosIngredientes = [...ingredientes, ...extrasIngredientes].sort(
      (a, b) => a.ingredienteItemId.localeCompare(b.ingredienteItemId),
    );

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

  // ── private helpers ────────────────────────────────────────────────────────

  /** Rechaza costos presentes que no sean > 0 (NULL = sin costo sigue permitido). */
  private validarCostoPositivo(costo: string): void {
    let value: Decimal;
    try {
      value = new Decimal(costo);
    } catch {
      throw new BadRequestException('El costo debe ser mayor a 0');
    }
    if (value.isNaN() || value.lessThanOrEqualTo(0)) {
      throw new BadRequestException('El costo debe ser mayor a 0');
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
   * Disponibilidad de todas las recetas/combos de una página en un nº CONSTANTE
   * de queries, en vez de una por fila (N+1). Mismo resultado que
   * `calcularDisponibleReceta`/`calcularDisponibleCombo` fila a fila: el mínimo
   * de unidades que el stock de los componentes BLOQUEANTES permite armar.
   */
  private async calcularDisponibilidadBatch(
    tenantId: string,
    recetaIds: string[],
    comboIds: string[],
  ): Promise<Map<string, number | null>> {
    const resultado = new Map<string, number | null>();
    if (!recetaIds.length && !comboIds.length) return resultado;

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
      cantidad: string;
      unidad_codigo: string;
      ingrediente_unidad_medida: string;
      stock: string;
    }[] = todasRecetas.length
      ? await this.db.query(
          `SELECT ri.receta_item_id, ri.cantidad, ri.unidad_codigo,
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
          : new Decimal(r.stock).div(cantidadBase).floor();
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
        posibles = new Decimal(r.stock ?? '0').div(r.cantidad).floor();
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

    return resultado;
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
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .eq(new Decimal(b).toDecimalPlaces(4, Decimal.ROUND_HALF_UP));
  }

  private margenPct(precio: Decimal, costo: Decimal): Decimal | null {
    if (precio.lessThanOrEqualTo(0)) return null;
    return precio
      .minus(costo)
      .div(precio)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
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

  private async filasDesfaseRecetas(
    tenantId: string,
    insumoItemId?: string,
  ): Promise<DesfaseItemDto[]> {
    const cabeceras: {
      receta_item_id: string;
      nombre: string;
      costo_actual: string;
      costo_propuesto_omitido: string | null;
      precio_base: string;
    }[] = await this.db.query(
      insumoItemId
        ? `SELECT DISTINCT i.item_id AS receta_item_id, i.nombre,
                ir.costo_actual, ir.costo_propuesto_omitido, i.precio_base
         FROM items i
         JOIN item_receta ir ON ir.item_id = i.item_id
         JOIN receta_ingredientes ri
           ON ri.receta_item_id = i.item_id AND ri.eliminado_el IS NULL
         WHERE i.tenant_id = $1 AND i.tipo = 'receta' AND i.eliminado_el IS NULL
           AND ri.ingrediente_item_id = $2
         ORDER BY i.nombre`
        : `SELECT i.item_id AS receta_item_id, i.nombre,
                ir.costo_actual, ir.costo_propuesto_omitido, i.precio_base
         FROM items i
         JOIN item_receta ir ON ir.item_id = i.item_id
         WHERE i.tenant_id = $1 AND i.tipo = 'receta' AND i.eliminado_el IS NULL
         ORDER BY i.nombre`,
      insumoItemId ? [tenantId, insumoItemId] : [tenantId],
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
    }[] = await this.db.query(
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

    const convertir = await this.catalogService.crearConversor();

    const out: DesfaseItemDto[] = [];
    for (const cab of cabeceras) {
      const lista = byReceta.get(cab.receta_item_id) ?? [];
      if (!lista.length) continue;
      const propuesto = this.costoPropuesto(convertir, lista);
      // Sin costo proponible (unidad rota en algún ingrediente) la receta se
      // omite de la bandeja, en vez de tumbar la respuesta para todas.
      if (propuesto === null) continue;
      const cacheado = new Decimal(cab.costo_actual ?? '0').toFixed(4);
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
        deltaCosto: costoPropD.minus(costoActualD).toFixed(4),
        precioBase: precio.toFixed(4),
        margenPctActual: mAct?.toFixed(4) ?? null,
        margenPctPropuesto: mProp?.toFixed(4) ?? null,
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
    const recetas = await this.filasDesfaseRecetas(tenantId, insumoItemId);
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
      const cacheado = new Decimal(cab.costo_actual ?? '0').toFixed(4);
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
        deltaCosto: costoPropD.minus(costoActualD).toFixed(4),
        precioBase: precio.toFixed(4),
        margenPctActual:
          this.margenPct(precio, costoActualD)?.toFixed(4) ?? null,
        margenPctPropuesto:
          this.margenPct(precio, costoPropD)?.toFixed(4) ?? null,
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

  async descartarDesfases(
    tenantId: string,
    itemIds: string[],
  ): Promise<{ descartados: number }> {
    return this.db.transaccion(async (manager) => {
      // Mismo batch que `aplicarDesfases`: 2 lecturas para todo el lote, loop
      // conservado para no alterar el orden de las validaciones.
      const ids = [...new Set(itemIds)];
      const cabPorId = await this.cabecerasCompuestas(manager, tenantId, ids);
      for (const itemId of itemIds) {
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
      // dos lotes las traían en sentidos opuestos. `Array.prototype.sort` es
      // estable, así que un id duplicado en el lote no cambia de posición
      // relativa entre sí y `descartados` sigue contando cada ocurrencia.
      //
      // Efecto observable asumido: en un lote mixto con errores en los dos
      // tipos, ahora falla primero el de la receta (misma precedencia que ya
      // tenía `aplicarDesfases`); y dentro de una misma pasada, si hay
      // errores en más de un id, ahora sale primero el de `item_id` menor,
      // no el que vino primero en el lote del cliente.
      const recetasDelLote = itemIds
        .filter((id) => cabPorId.get(id)!.tipo === 'receta')
        .sort();
      const combosDelLote = itemIds
        .filter((id) => cabPorId.get(id)!.tipo === 'combo')
        .sort();

      for (const itemId of recetasDelLote) {
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
        await manager.query(
          `UPDATE item_receta SET costo_propuesto_omitido = $1 WHERE item_id = $2`,
          [propuesto, itemId],
        );
        descartados += 1;
      }

      for (const itemId of combosDelLote) {
        const comps = compsPorCombo.get(itemId) ?? [];
        if (!comps.length) {
          throw new BadRequestException(
            `El combo ${itemId} no tiene componentes`,
          );
        }
        // Sin caso de error propio: `costoPropuestoCombo` nunca devuelve
        // null, así que el 400 de unidad incompatible no aplica acá.
        const propuestoCombo = this.costoPropuestoCombo(comps);
        await manager.query(
          `UPDATE item_combo SET costo_propuesto_omitido = $1 WHERE item_id = $2`,
          [propuestoCombo, itemId],
        );
        descartados += 1;
      }
      return { descartados };
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

  private async validarReglas(
    manager: EntityManager,
    tenantId: string,
    ids: string[],
    tabla: string,
    pkCol: string,
  ): Promise<void> {
    const rows: { cnt: string }[] = await manager.query(
      `SELECT COUNT(*) AS cnt FROM ${tabla}
       WHERE ${pkCol} = ANY($1::uuid[]) AND tenant_id = $2 AND eliminado_el IS NULL`,
      [ids, tenantId],
    );
    if (parseInt(rows[0].cnt) !== ids.length) {
      throw new BadRequestException(
        `Una o más reglas de ${tabla} no pertenecen a este tenant`,
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
