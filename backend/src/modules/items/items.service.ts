import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { Item } from './entities/item.entity';
import { ItemProducto } from './entities/item-producto.entity';
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
  clasificacion_tributaria: string;
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

export interface DesfaseIngredienteDto {
  itemId: string;
  nombre: string;
  costoActual: string | null;
}

export interface DesfaseRecetaDto {
  recetaItemId: string;
  nombre: string;
  costoActual: string;
  costoPropuesto: string;
  deltaCosto: string;
  precioBase: string;
  margenPctActual: string | null;
  margenPctPropuesto: string | null;
  precioSugerido: string | null;
  ingredientesAfectados: DesfaseIngredienteDto[];
}

@Injectable()
export class ItemsService {
  constructor(
    @InjectRepository(Item)
    private readonly itemRepo: Repository<Item>,
    @InjectRepository(ItemProducto)
    private readonly itemProductoRepo: Repository<ItemProducto>,
    @InjectRepository(ItemServicio)
    private readonly itemServicioRepo: Repository<ItemServicio>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
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
    let where = ` WHERE i.tenant_id = $1 AND i.eliminado_el IS NULL`;

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

    return { where, params };
  }

  async findAll(
    tenantId: string,
    query: QueryItemsDto,
  ): Promise<
    PaginatedResponse<
      ReturnType<typeof this.mapRow> & { disponible: number | null }
    >
  > {
    const { page, pageSize, offset } = resolvePagination(query);
    const { where, params } = this.buildFindAllFilters(tenantId, query);

    const countRows: { total: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM items i${where}`,
      params,
    );
    const total = countRows[0]?.total ?? 0;

    const listParams = [...params, pageSize, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows: ItemRow[] = await this.dataSource.query(
      this.BASE_QUERY +
        where +
        ` ORDER BY i.nombre ASC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );

    // Los combo ids con grupos se cargan de una sola vez para no disparar
    // N queries extra (una por combo) al calcular disponibleCondicional.
    let comboIdsConGrupos = new Set<string>();
    if (rows.some((r) => r.tipo === 'combo')) {
      const grupoItemRows: { item_id: string }[] = await this.dataSource.query(
        `SELECT DISTINCT item_id FROM item_grupos_modificadores
         WHERE tenant_id = $1 AND eliminado_el IS NULL`,
        [tenantId],
      );
      comboIdsConGrupos = new Set(grupoItemRows.map((r) => r.item_id));
    }

    const data = await Promise.all(
      rows.map(async (r) => {
        const base = this.mapRow(r);
        const disponible =
          base.tipo === 'receta'
            ? await this.calcularDisponibleReceta(tenantId, base.id)
            : base.tipo === 'combo'
              ? await this.calcularDisponibleCombo(tenantId, base.id)
              : null;
        const disponibleCondicional =
          base.tipo === 'combo' && comboIdsConGrupos.has(base.id);
        return { ...base, disponible, disponibleCondicional };
      }),
    );

    return {
      data,
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async findOne(tenantId: string, itemId: string) {
    const rows: ItemRow[] = await this.dataSource.query(
      this.BASE_QUERY +
        ` WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
      [itemId, tenantId],
    );
    if (!rows.length) throw new NotFoundException('Item no encontrado');

    const impuestosRows: { impuesto_id: string }[] =
      await this.dataSource.query(
        `SELECT impuesto_id FROM item_impuestos WHERE item_id = $1`,
        [itemId],
      );
    const recargosRows: { recargo_id: string }[] = await this.dataSource.query(
      `SELECT recargo_id FROM item_recargos WHERE item_id = $1`,
      [itemId],
    );
    const descuentosRows: { descuento_id: string }[] =
      await this.dataSource.query(
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
    }[] = [];
    if (rows[0].tipo === 'receta') {
      const ingRows: {
        ingrediente_item_id: string;
        ingrediente_nombre: string;
        cantidad: string;
        unidad_codigo: string;
        bloqueante: boolean;
        stock: string;
      }[] = await this.dataSource.query(
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
      }[] = await this.dataSource.query(
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
      }[] = await this.dataSource.query(
        `SELECT cc.componente_item_id, i.nombre AS componente_nombre, i.tipo,
                cc.cantidad, cc.bloqueante, ip.stock
         FROM combo_componentes cc
         JOIN items i ON i.item_id = cc.componente_item_id AND i.eliminado_el IS NULL
         LEFT JOIN item_producto ip ON ip.item_id = cc.componente_item_id
         WHERE cc.combo_item_id = $1 AND cc.tenant_id = $2 AND cc.eliminado_el IS NULL`,
        [itemId, tenantId],
      );
      componentes = compRows.map((r) => ({
        componenteItemId: r.componente_item_id,
        componenteNombre: r.componente_nombre,
        tipo: r.tipo,
        cantidad: r.cantidad,
        bloqueante: r.bloqueante,
        stock: r.stock,
      }));
    }

    const grupos: {
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
    }[] = [];
    if (rows[0].tipo === 'combo' || rows[0].tipo === 'receta') {
      const grupoRows: {
        grupo_modificador_id: string;
        item_grupo_id: string;
        nombre: string;
        min: number;
        max: number;
        orden: number;
      }[] = await this.dataSource.query(
        `SELECT igm.grupo_modificador_id, igm.item_grupo_id, g.nombre, igm.min, igm.max, igm.orden
         FROM item_grupos_modificadores igm
         JOIN grupos_modificadores g ON g.grupo_modificador_id = igm.grupo_modificador_id
           AND g.eliminado_el IS NULL
         WHERE igm.item_id = $1 AND igm.tenant_id = $2 AND igm.eliminado_el IS NULL
         ORDER BY igm.orden ASC`,
        [itemId, tenantId],
      );
      for (const gr of grupoRows) {
        const opRows: {
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
        }[] = await this.dataSource.query(
          `SELECT o.grupo_opcion_id, o.item_id, i.nombre AS item_nombre, i.tipo,
                  COALESCE(ovr.cantidad, o.cantidad) AS cantidad_efectiva,
                  o.cantidad AS cantidad_default,
                  COALESCE(ovr.unidad_codigo, o.unidad_codigo) AS unidad_codigo,
                  COALESCE(ovr.precio_extra, o.precio_extra) AS precio_extra,
                  o.orden, ip.stock
           FROM grupo_modificador_opciones o
           JOIN items i ON i.item_id = o.item_id AND i.eliminado_el IS NULL
           LEFT JOIN item_producto ip ON ip.item_id = o.item_id
           LEFT JOIN item_grupo_modificador_opciones ovr
             ON ovr.grupo_opcion_id = o.grupo_opcion_id
            AND ovr.item_grupo_id = $3
            AND ovr.eliminado_el IS NULL
           WHERE o.grupo_modificador_id = $1 AND o.tenant_id = $2 AND o.eliminado_el IS NULL
           ORDER BY o.orden ASC`,
          [gr.grupo_modificador_id, tenantId, gr.item_grupo_id],
        );
        grupos.push({
          grupoModificadorId: gr.grupo_modificador_id,
          nombre: gr.nombre,
          min: gr.min,
          max: gr.max,
          orden: gr.orden,
          opciones: opRows.map((r) => ({
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
      }
    }

    return {
      ...this.mapRow(rows[0]),
      impuestosIds: impuestosRows.map((r) => r.impuesto_id),
      recargosIds: recargosRows.map((r) => r.recargo_id),
      descuentosIds: descuentosRows.map((r) => r.descuento_id),
      ingredientes,
      extrasPermitidos,
      componentes,
      grupos,
      disponibleCondicional: rows[0].tipo === 'combo' && grupos.length > 0,
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
    return this.dataSource.transaction(async (manager) => {
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
          dto.clasificacionTributaria ?? 'afecto',
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
        clasificacionTributaria: dto.clasificacionTributaria ?? 'afecto',
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

  async update(tenantId: string, itemId: string, dto: UpdateItemDto) {
    // Patch mergeable: solo campos tocados + RETURNING de columnas UPDATE.
    // El front hace `{ ...prev, ...saved }` — sin findOne post-write.
    return this.dataSource.transaction(async (manager) => {
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
        setClauses.push(`clasificacion_tributaria = $${idx++}`);
        params.push(dto.clasificacionTributaria);
        patch.clasificacionTributaria = dto.clasificacionTributaria;
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
          }[] = await manager.query(
            `SELECT modo_inventario, unidad_medida FROM item_producto WHERE item_id = $1`,
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
            const movRows: { cnt: string }[] = await manager.query(
              `SELECT COUNT(*) AS cnt FROM movimientos_inventario
               WHERE item_id = $1 AND eliminado_el IS NULL`,
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
        }

        const prodClauses: string[] = [];
        const prodParams: unknown[] = [];
        let pidx = 1;
        if (dto.modoInventario !== undefined && tipo === 'producto') {
          prodClauses.push(`modo_inventario = $${pidx++}`);
          prodParams.push(dto.modoInventario);
          patch.modoInventario = dto.modoInventario;
        }
        if (dto.stock !== undefined) {
          prodClauses.push(`stock = $${pidx++}`);
          prodParams.push(dto.stock);
          patch.stock = dto.stock;
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
        if (dto.costo !== undefined) {
          if (dto.costo != null) {
            this.validarCostoPositivo(dto.costo);
          }
          prodClauses.push(`costo_actual = $${pidx++}`);
          prodParams.push(dto.costo);
          patch.costoActual = dto.costo;
        }
        if (prodClauses.length) {
          prodParams.push(itemId);
          await manager.query(
            `UPDATE item_producto SET ${prodClauses.join(', ')} WHERE item_id = $${pidx++}`,
            prodParams,
          );
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
        await manager.query(
          `UPDATE item_combo SET costo_actual = $1 WHERE item_id = $2`,
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

  async remove(tenantId: string, itemId: string): Promise<void> {
    const item = await this.itemRepo.findOne({
      where: { id: itemId, tenantId },
    });
    if (!item) throw new NotFoundException('Item no encontrado');

    const usoRows: { nombre: string }[] = await this.dataSource.query(
      `SELECT DISTINCT ri_item.nombre
       FROM receta_ingredientes ri
       JOIN items ri_item ON ri_item.item_id = ri.receta_item_id
         AND ri_item.eliminado_el IS NULL
       WHERE ri.ingrediente_item_id = $1 AND ri.eliminado_el IS NULL`,
      [itemId],
    );
    if (usoRows.length) {
      throw new BadRequestException(
        `No se puede eliminar: es ingrediente de ${usoRows.map((r) => r.nombre).join(', ')}`,
      );
    }

    const comboRows: { nombre: string }[] = await this.dataSource.query(
      `SELECT DISTINCT c_item.nombre
       FROM combo_componentes cc
       JOIN items c_item ON c_item.item_id = cc.combo_item_id
         AND c_item.eliminado_el IS NULL
       WHERE cc.componente_item_id = $1 AND cc.eliminado_el IS NULL`,
      [itemId],
    );
    if (comboRows.length) {
      throw new BadRequestException(
        `No se puede eliminar: es componente de ${comboRows.map((r) => r.nombre).join(', ')}`,
      );
    }

    const opcionRows: { nombre: string }[] = await this.dataSource.query(
      `SELECT DISTINCT g.nombre FROM grupo_modificador_opciones o
       JOIN grupos_modificadores g ON g.grupo_modificador_id = o.grupo_modificador_id
         AND g.eliminado_el IS NULL
       WHERE o.item_id = $1 AND o.eliminado_el IS NULL`,
      [itemId],
    );
    if (opcionRows.length) {
      throw new BadRequestException(
        `No se puede eliminar: es opción de ${opcionRows.map((r) => r.nombre).join(', ')}`,
      );
    }

    await this.dataSource.query(
      `UPDATE items SET activo = false, eliminado_el = NOW(), actualizado_el = NOW()
       WHERE item_id = $1 AND tenant_id = $2`,
      [itemId, tenantId],
    );
  }

  async ajustarStock(
    tenantId: string,
    usuarioId: string,
    itemId: string,
    dto: AjusteStockDto,
  ) {
    return this.dataSource.transaction(async (manager) => {
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
          cantidad = await this.catalogService.convertirUnidad(
            cantidad,
            dto.unidadCodigo,
            unidadBase,
          );
        }
      }

      const { stockResultante } =
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
          costoUnitario: dto.costoUnitario ?? null,
        });

      return { stock: stockResultante };
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
    }[] = await this.dataSource.query(
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
    }[] = await this.dataSource.query(
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
    manager: EntityManager,
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
       WHERE ri.receta_item_id = $1 AND ri.tenant_id = $2 AND ri.eliminado_el IS NULL`,
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
    manager: EntityManager,
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
    manager: EntityManager,
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
   * Resuelve y congela la selección de grupos de modificadores de un item
   * (receta o combo): valida que cada opción elegida pertenezca al grupo,
   * que la suma de unidades elegidas por grupo esté entre min y max, y
   * calcula el recargo total (Σ precioExtra × unidades).
   */
  async resolverGruposDeItem(
    manager: EntityManager,
    tenantId: string,
    itemId: string,
    gruposDto: PersonalizacionGrupoInputDto[] | undefined,
  ): Promise<{ grupos: SnapshotGrupo[]; precioExtraTotal: string }> {
    const asociados: {
      grupo_modificador_id: string;
      item_grupo_id: string;
      nombre: string;
      min: number;
      max: number;
    }[] = await manager.query(
      `SELECT igm.grupo_modificador_id, igm.item_grupo_id, g.nombre, igm.min, igm.max
       FROM item_grupos_modificadores igm
       JOIN grupos_modificadores g ON g.grupo_modificador_id = igm.grupo_modificador_id
         AND g.eliminado_el IS NULL
       WHERE igm.item_id = $1 AND igm.tenant_id = $2 AND igm.eliminado_el IS NULL`,
      [itemId, tenantId],
    );

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
      const opcionesCat: {
        item_id: string;
        nombre: string;
        cantidad: string | null;
        unidad_codigo: string | null;
        precio_extra: string;
      }[] = await manager.query(
        `SELECT o.item_id, i.nombre,
                COALESCE(ovr.cantidad, o.cantidad) AS cantidad,
                COALESCE(ovr.unidad_codigo, o.unidad_codigo) AS unidad_codigo,
                COALESCE(ovr.precio_extra, o.precio_extra) AS precio_extra
         FROM grupo_modificador_opciones o
         JOIN items i ON i.item_id = o.item_id AND i.eliminado_el IS NULL
         LEFT JOIN item_grupo_modificador_opciones ovr
           ON ovr.grupo_opcion_id = o.grupo_opcion_id
          AND ovr.item_grupo_id = $3
          AND ovr.eliminado_el IS NULL
         WHERE o.grupo_modificador_id = $1 AND o.tenant_id = $2 AND o.eliminado_el IS NULL`,
        [asoc.grupo_modificador_id, tenantId, asoc.item_grupo_id],
      );

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
    manager: EntityManager,
    tenantId: string,
    comboItemId: string,
    dto?: PersonalizacionRecetaDto,
  ): Promise<{
    snapshot: PersonalizacionRecetaSnapshot;
    precioExtraTotal: string;
  }> {
    const { grupos, precioExtraTotal } = await this.resolverGruposDeItem(
      manager,
      tenantId,
      comboItemId,
      dto?.grupos,
    );
    return {
      snapshot: {
        omitidos: [],
        extras: [],
        comentario: dto?.comentario?.trim() || undefined,
        grupos: grupos.length ? grupos : undefined,
      },
      precioExtraTotal,
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
    },
  ): Promise<string[]> {
    const ingredientesBase = await this.obtenerIngredientesReceta(
      manager,
      params.tenantId,
      params.recetaItemId,
    );
    const omitidos = new Set(params.snapshot?.omitidos ?? []);
    const ingredientes = ingredientesBase.filter(
      (ing) => !omitidos.has(ing.ingredienteItemId),
    );

    const extrasCat = params.snapshot?.extras.length
      ? await this.obtenerExtrasPermitidos(
          manager,
          params.tenantId,
          params.recetaItemId,
        )
      : [];

    const extrasIngredientes =
      params.snapshot?.extras.map((extra) => {
        const cat = extrasCat.find(
          (x) => x.ingredienteItemId === extra.ingredienteItemId,
        );
        // Porción del extra × cuántas veces se agregó (unidades). Snapshots
        // antiguos sin `unidades` equivalen a 1.
        const cantidad = new Decimal(extra.cantidad)
          .mul(extra.unidades ?? '1')
          .toString();
        return {
          ingredienteItemId: extra.ingredienteItemId,
          ingredienteNombre: cat?.ingredienteNombre ?? 'Extra',
          ingredienteUnidadMedida:
            cat?.ingredienteUnidadMedida ?? extra.unidadCodigo,
          cantidad,
          unidadCodigo: extra.unidadCodigo,
          bloqueante: false,
        };
      }) ?? [];

    const todosIngredientes = [...ingredientes, ...extrasIngredientes];
    const advertencias: string[] = [];

    for (const ing of todosIngredientes) {
      const cantidadPorReceta = new Decimal(ing.cantidad)
        .mul(params.cantidadVendida)
        .toString();
      const cantidadConvertida = await this.catalogService.convertirUnidad(
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
    },
  ): Promise<string[]> {
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
       WHERE cc.combo_item_id = $1 AND cc.tenant_id = $2 AND cc.eliminado_el IS NULL`,
      [params.comboItemId, params.tenantId],
    );

    const advertencias: string[] = [];

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
          );
          if (
            disponible !== null &&
            new Decimal(disponible).lessThan(cantidadTotal)
          ) {
            advertencias.push(
              `${params.comboNombre}: no había stock suficiente de ${comp.componente_nombre}, se vendió sin ese componente`,
            );
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
      },
      params.snapshot?.grupos,
    );

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
    },
    grupos: SnapshotGrupo[] | undefined,
  ): Promise<void> {
    for (const grupo of grupos ?? []) {
      for (const op of grupo.opciones) {
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
          });
          continue;
        }

        // producto o ingrediente → salida (siempre bloqueante: el error se propaga)
        const cantidadSalida =
          tipo === 'ingrediente' && op.unidadCodigo
            ? await this.catalogService.convertirUnidad(
                cantidadTotal,
                op.unidadCodigo,
                unidad_medida!,
              )
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
  ): Promise<number | null> {
    const rows: {
      cantidad: string;
      unidad_codigo: string;
      ingrediente_unidad_medida: string;
      stock: string;
    }[] = await this.dataSource.query(
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
      const cantidadBase = await this.catalogService.convertirUnidad(
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
   * Mínimo, entre los componentes BLOQUEANTES de un combo, de las unidades que
   * alcanzan: producto → floor(stock/cantidad); receta → floor(disponibleReceta/
   * cantidad); servicio ignorado. null si no hay componentes bloqueantes.
   */
  private async calcularDisponibleCombo(
    tenantId: string,
    comboItemId: string,
  ): Promise<number | null> {
    const rows: {
      componente_item_id: string;
      tipo: string;
      cantidad: string;
      stock: string | null;
    }[] = await this.dataSource.query(
      `SELECT cc.componente_item_id, i.tipo, cc.cantidad, ip.stock
       FROM combo_componentes cc
       JOIN items i ON i.item_id = cc.componente_item_id AND i.eliminado_el IS NULL
       LEFT JOIN item_producto ip ON ip.item_id = cc.componente_item_id
       WHERE cc.combo_item_id = $1 AND cc.tenant_id = $2
         AND cc.bloqueante = true AND cc.eliminado_el IS NULL`,
      [comboItemId, tenantId],
    );

    let minimo: Decimal | null = null;
    for (const r of rows) {
      let posibles: Decimal;
      if (r.tipo === 'servicio') {
        continue;
      } else if (r.tipo === 'receta') {
        const dispReceta = await this.calcularDisponibleReceta(
          tenantId,
          r.componente_item_id,
        );
        if (dispReceta === null) continue;
        posibles = new Decimal(dispReceta).div(r.cantidad).floor();
      } else {
        posibles = new Decimal(r.stock ?? '0').div(r.cantidad).floor();
      }
      if (minimo === null || posibles.lessThan(minimo)) minimo = posibles;
    }
    return minimo === null ? null : minimo.toNumber();
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
    for (const ing of ingredientes) {
      let cantidad;
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
      const rows: {
        tipo: string;
        nombre: string;
        modo_inventario: string | null;
        unidad_medida: string | null;
        costo_actual: string | null;
      }[] = await manager.query(
        `SELECT i.tipo, i.nombre, ip.modo_inventario, ip.unidad_medida, ip.costo_actual
         FROM items i
         LEFT JOIN item_producto ip ON ip.item_id = i.item_id
         WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
        [ing.ingredienteItemId, tenantId],
      );
      if (!rows.length || rows[0].tipo !== 'ingrediente') {
        throw new BadRequestException(
          `El ingrediente ${ing.ingredienteItemId} no es un item de tipo ingrediente válido`,
        );
      }
      if (rows[0].modo_inventario !== 'cantidad') {
        throw new BadRequestException(
          'Los insumos de receta solo admiten modo de inventario "cantidad"',
        );
      }
      const cantidadBase = await this.catalogService.convertirUnidad(
        ing.cantidad,
        ing.unidadCodigo,
        rows[0].unidad_medida!,
      );
      const costoUnitario = new Decimal(rows[0].costo_actual ?? '0');
      costoTotal = costoTotal.plus(costoUnitario.mul(cantidadBase));
      detalle.push({
        ingredienteItemId: ing.ingredienteItemId,
        ingredienteNombre: rows[0].nombre,
        cantidad: ing.cantidad,
        unidadCodigo: ing.unidadCodigo,
        bloqueante: ing.bloqueante ?? true,
      });
    }
    return {
      costoActual: costoTotal
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
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
    const idsVistos = new Set<string>();
    for (const c of componentes) {
      if (idsVistos.has(c.componenteItemId)) {
        throw new BadRequestException(
          'Un item no puede aparecer más de una vez como componente del combo',
        );
      }
      idsVistos.add(c.componenteItemId);
    }
    let costoTotal = new Decimal(0);
    const detalle: {
      componenteItemId: string;
      componenteNombre: string;
      tipo: string;
      cantidad: string;
      bloqueante: boolean;
    }[] = [];
    for (const c of componentes) {
      const rows: {
        nombre: string;
        tipo: string;
        costo_actual: string | null;
      }[] = await manager.query(
        `SELECT i.nombre, i.tipo,
                  COALESCE(ip.costo_actual, ir.costo_actual) AS costo_actual
           FROM items i
           LEFT JOIN item_producto ip ON ip.item_id = i.item_id
           LEFT JOIN item_receta ir ON ir.item_id = i.item_id
           WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
        [c.componenteItemId, tenantId],
      );
      if (!rows.length) {
        throw new BadRequestException(
          `Componente no encontrado: ${c.componenteItemId}`,
        );
      }
      const { nombre, tipo, costo_actual } = rows[0];
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
    return {
      costoActual: costoTotal.toDecimalPlaces(4).toString(),
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
    for (const extra of extras) {
      let cantidad;
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
      let precioExtra;
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
      const rows: {
        tipo: string;
        nombre: string;
        modo_inventario: string | null;
        unidad_medida: string | null;
      }[] = await manager.query(
        `SELECT i.tipo, i.nombre, ip.modo_inventario, ip.unidad_medida
         FROM items i
         LEFT JOIN item_producto ip ON ip.item_id = i.item_id
         WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
        [extra.ingredienteItemId, tenantId],
      );
      if (!rows.length || rows[0].tipo !== 'ingrediente') {
        throw new BadRequestException(
          `El extra ${extra.ingredienteItemId} no es un item de tipo ingrediente válido`,
        );
      }
      if (rows[0].modo_inventario !== 'cantidad') {
        throw new BadRequestException(
          'Los extras permitidos solo admiten modo de inventario "cantidad"',
        );
      }
      await this.catalogService.convertirUnidad(
        extra.cantidad,
        extra.unidadCodigo,
        rows[0].unidad_medida!,
      );
      detalle.push({
        ingredienteItemId: extra.ingredienteItemId,
        ingredienteNombre: rows[0].nombre,
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
    return costoNuevo
      .mul(precioViejo)
      .div(costoViejo)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  }

  /**
   * Calcula costo propuesto de una receta ya persistida (ingredientes vivos).
   * Misma aritmética que validarYCostearIngredientes: convierte a unidad base × costo_actual.
   */
  private async calcularCostoPropuestoDesdeFilas(
    ings: {
      cantidad: string;
      unidad_codigo: string;
      unidad_base: string;
      costo_actual: string | null;
    }[],
  ): Promise<string> {
    let total = new Decimal(0);
    for (const ing of ings) {
      const cantidadBase = await this.catalogService.convertirUnidad(
        ing.cantidad,
        ing.unidad_codigo,
        ing.unidad_base,
      );
      total = total.plus(
        new Decimal(ing.costo_actual ?? '0').mul(cantidadBase),
      );
    }
    return total.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
  }

  private async construirFilasDesfase(
    tenantId: string,
    ingredienteItemId?: string,
  ): Promise<DesfaseRecetaDto[]> {
    const cabeceras: {
      receta_item_id: string;
      nombre: string;
      costo_actual: string;
      costo_propuesto_omitido: string | null;
      precio_base: string;
    }[] = await this.dataSource.query(
      ingredienteItemId
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
      ingredienteItemId ? [tenantId, ingredienteItemId] : [tenantId],
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
    }[] = await this.dataSource.query(
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

    const out: DesfaseRecetaDto[] = [];
    for (const cab of cabeceras) {
      const lista = byReceta.get(cab.receta_item_id) ?? [];
      if (!lista.length) continue;
      const propuesto = await this.calcularCostoPropuestoDesdeFilas(lista);
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
        recetaItemId: cab.receta_item_id,
        nombre: cab.nombre,
        costoActual: cacheado,
        costoPropuesto: propuesto,
        deltaCosto: costoPropD.minus(costoActualD).toFixed(4),
        precioBase: precio.toFixed(4),
        margenPctActual: mAct?.toFixed(4) ?? null,
        margenPctPropuesto: mProp?.toFixed(4) ?? null,
        precioSugerido: sug?.toFixed(4) ?? null,
        ingredientesAfectados: lista.map((i) => ({
          itemId: i.ingrediente_item_id,
          nombre: i.ingrediente_nombre,
          costoActual: i.costo_actual,
        })),
      });
    }
    return out;
  }

  async listarDesfases(
    tenantId: string,
    ingredienteItemId?: string,
  ): Promise<DesfaseRecetaDto[]> {
    return this.construirFilasDesfase(tenantId, ingredienteItemId);
  }

  async recetasAfectadasPorIngrediente(
    tenantId: string,
    ingredienteItemId: string,
  ): Promise<DesfaseRecetaDto[]> {
    const exists: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM items
     WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
       AND tipo = 'ingrediente'`,
      [ingredienteItemId, tenantId],
    );
    if (!exists.length) throw new NotFoundException('Item no encontrado');
    return this.construirFilasDesfase(tenantId, ingredienteItemId);
  }

  async aplicarDesfases(
    tenantId: string,
    items: {
      recetaItemId: string;
      actualizarPrecio?: boolean;
      precioBase?: string;
    }[],
  ): Promise<{ aplicados: number }> {
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

    return this.dataSource.transaction(async (manager) => {
      let aplicados = 0;
      for (const it of items) {
        const cab: {
          receta_item_id: string;
          tipo: string;
        }[] = await manager.query(
          `SELECT i.item_id AS receta_item_id, i.tipo
           FROM items i
           JOIN item_receta ir ON ir.item_id = i.item_id
           WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
          [it.recetaItemId, tenantId],
        );
        if (!cab.length || cab[0].tipo !== 'receta') {
          throw new NotFoundException(
            `Receta ${it.recetaItemId} no encontrada`,
          );
        }

        const ings: {
          cantidad: string;
          unidad_codigo: string;
          unidad_base: string;
          costo_actual: string | null;
        }[] = await manager.query(
          `SELECT ri.cantidad, ri.unidad_codigo, ip.unidad_medida AS unidad_base, ip.costo_actual
           FROM receta_ingredientes ri
           JOIN items ing ON ing.item_id = ri.ingrediente_item_id AND ing.eliminado_el IS NULL
           JOIN item_producto ip ON ip.item_id = ri.ingrediente_item_id
           WHERE ri.receta_item_id = $1 AND ri.tenant_id = $2 AND ri.eliminado_el IS NULL`,
          [it.recetaItemId, tenantId],
        );
        if (!ings.length) {
          throw new BadRequestException(
            `La receta ${it.recetaItemId} no tiene ingredientes`,
          );
        }

        const propuesto = await this.calcularCostoPropuestoDesdeFilas(ings);
        await manager.query(
          `UPDATE item_receta
           SET costo_actual = $1, costo_propuesto_omitido = NULL
           WHERE item_id = $2`,
          [propuesto, it.recetaItemId],
        );

        if (it.actualizarPrecio && it.precioBase) {
          const precio = new Decimal(it.precioBase)
            .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
            .toFixed(4);
          await manager.query(
            `UPDATE items SET precio_base = $1
             WHERE item_id = $2 AND tenant_id = $3 AND eliminado_el IS NULL`,
            [precio, it.recetaItemId, tenantId],
          );
        }
        aplicados += 1;
      }
      return { aplicados };
    });
  }

  async descartarDesfases(
    tenantId: string,
    recetaItemIds: string[],
  ): Promise<{ descartados: number }> {
    return this.dataSource.transaction(async (manager) => {
      let descartados = 0;
      for (const recetaItemId of recetaItemIds) {
        const cab: { tipo: string }[] = await manager.query(
          `SELECT i.tipo FROM items i
           JOIN item_receta ir ON ir.item_id = i.item_id
           WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
          [recetaItemId, tenantId],
        );
        if (!cab.length || cab[0].tipo !== 'receta') {
          throw new NotFoundException(`Receta ${recetaItemId} no encontrada`);
        }
        const ings: {
          cantidad: string;
          unidad_codigo: string;
          unidad_base: string;
          costo_actual: string | null;
        }[] = await manager.query(
          `SELECT ri.cantidad, ri.unidad_codigo, ip.unidad_medida AS unidad_base, ip.costo_actual
           FROM receta_ingredientes ri
           JOIN items ing ON ing.item_id = ri.ingrediente_item_id AND ing.eliminado_el IS NULL
           JOIN item_producto ip ON ip.item_id = ri.ingrediente_item_id
           WHERE ri.receta_item_id = $1 AND ri.tenant_id = $2 AND ri.eliminado_el IS NULL`,
          [recetaItemId, tenantId],
        );
        if (!ings.length) {
          throw new BadRequestException(
            `La receta ${recetaItemId} no tiene ingredientes`,
          );
        }
        const propuesto = await this.calcularCostoPropuestoDesdeFilas(ings);
        await manager.query(
          `UPDATE item_receta SET costo_propuesto_omitido = $1 WHERE item_id = $2`,
          [propuesto, recetaItemId],
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

  private async validarCategoria(
    manager: EntityManager,
    tenantId: string,
    categoriaId: string,
  ): Promise<string> {
    const rows: { nombre: string }[] = await manager.query(
      `SELECT nombre FROM categorias
       WHERE categoria_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [categoriaId, tenantId],
    );
    if (!rows.length) {
      throw new BadRequestException('La categoría no pertenece a este tenant');
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

  /** Impuestos válidos: personalizados del tenant o del catálogo del sistema del país del tenant. */
  private async validarImpuestos(
    manager: EntityManager,
    tenantId: string,
    ids: string[],
  ): Promise<void> {
    const rows: { cnt: string }[] = await manager.query(
      `SELECT COUNT(*) AS cnt FROM impuestos i
        WHERE i.impuesto_id = ANY($1::uuid[]) AND i.eliminado_el IS NULL
          AND (i.tenant_id = $2
               OR i.pais_id = (SELECT p.pais_id
                                 FROM tenants t
                                 JOIN provincia p ON p.provincia_id = t.provincia_id
                                WHERE t.tenant_id = $2 AND t.eliminado_el IS NULL))`,
      [ids, tenantId],
    );
    if (parseInt(rows[0].cnt) !== ids.length) {
      throw new BadRequestException(
        'Uno o más impuestos no están disponibles para este tenant',
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

      await this.upsertOverridesDeGrupo(
        manager,
        tenantId,
        itemGrupoId,
        g.grupoModificadorId,
        g.opciones ?? [],
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
  ): Promise<void> {
    const vivos: { item_grupo_opcion_id: string; grupo_opcion_id: string }[] =
      await manager.query(
        `SELECT item_grupo_opcion_id, grupo_opcion_id FROM item_grupo_modificador_opciones
         WHERE item_grupo_id = $1 AND eliminado_el IS NULL`,
        [itemGrupoId],
      );
    const overrideIdPorOpcion = new Map(
      vivos.map((r) => [r.grupo_opcion_id, r.item_grupo_opcion_id]),
    );
    const opcionesEntrantes = new Set<string>();

    for (const o of opciones) {
      opcionesEntrantes.add(o.grupoOpcionId);
      // La opción debe pertenecer a ESTE grupo (viva).
      const perteneceRows: { grupo_opcion_id: string }[] = await manager.query(
        `SELECT grupo_opcion_id FROM grupo_modificador_opciones
         WHERE grupo_opcion_id = $1 AND grupo_modificador_id = $2 AND tenant_id = $3
           AND eliminado_el IS NULL`,
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

      const existente = overrideIdPorOpcion.get(o.grupoOpcionId);
      if (existente) {
        await manager.query(
          `UPDATE item_grupo_modificador_opciones
           SET cantidad = $1, unidad_codigo = $2, precio_extra = $3, actualizado_el = NOW()
           WHERE item_grupo_opcion_id = $4`,
          [cantidad, unidad, precio, existente],
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
