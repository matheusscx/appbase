import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';
import { convertirCostoUnitario } from '../../common/utils/costo-conversion-unidad.util';
import {
  bordeFechaSql,
  requiereZonaTenant,
  zonaHorariaTenant,
} from '../../common/utils/rango-fecha.util';
import { InventarioService } from '../inventario/inventario.service';
import { CatalogService } from '../catalog/catalog.service';
import { CausasMermaService } from './causas-merma.service';
import { CreateMermaDto } from './dto/create-merma.dto';
import { FindMermasDto } from './dto/find-mermas.dto';

export interface MermaResponse {
  movimientoId: string;
  stockResultante: string;
  costoUnitario: string;
  costoPerdido: string;
  causaNombre: string;
  /** Fila lista para upsert en el front (sin re-fetch). */
  merma: MermaListItem;
}

export interface MermaListItem {
  id: string;
  itemId: string;
  itemNombre: string;
  cantidad: string;
  costoUnitario: string | null;
  costoPerdido: string | null;
  causaMermaId: string | null;
  causaNombre: string | null;
  comentario: string | null;
  creadoEl: Date;
  usuarioNombre: string | null;
  unidadMedida: string | null;
  /**
   * Moneda del ítem, no la oficial del tenant. El listado de mermas mezcla
   * ítems de distintas monedas igual que el kardex global: sin esto la UI
   * formatea todo costo con la oficial y un ítem importado en USD se lee como
   * si fueran pesos. Mismo motivo y misma solución que
   * `InventarioService` (kardex).
   */
  monedaId: string;
  /** El producto fue dado de baja después de esta merma. La fila se conserva. */
  itemEliminado: boolean;
}

interface MermaRow {
  movimiento_id: string;
  item_id: string;
  // No nullable pese al `LEFT JOIN`: `movimientos_inventario.item_id` es
  // `NOT NULL REFERENCES items`. El LEFT solo saca el filtro de borrado.
  item_nombre: string;
  cantidad: string;
  costo_unitario: string | null;
  causa_merma_id: string | null;
  causa_nombre: string | null;
  comentario: string | null;
  creado_el: Date;
  usuario_nombre: string | null;
  unidad_medida: string | null;
  moneda_id: string;
  item_eliminado: boolean;
}

@Injectable()
export class MermasService {
  constructor(
    private readonly db: Db,
    private readonly inventarioService: InventarioService,
    private readonly catalogService: CatalogService,
    private readonly causasService: CausasMermaService,
  ) {}

  async registrar(
    tenantId: string,
    usuarioId: string,
    dto: CreateMermaDto,
  ): Promise<MermaResponse> {
    return this.db.transaccion(async (manager) => {
      const itemRows: {
        tipo: string;
        unidad_medida: string | null;
        modo_inventario: string | null;
        costo_actual: string | null;
        nombre: string;
        moneda_id: string;
      }[] = await manager.query(
        // `i.moneda_id`: la fila que este POST devuelve se inserta en el
        // listado sin refetch, así que sin la moneda del ítem la merma recién
        // creada se formatea con la oficial del tenant hasta que alguien
        // recargue. Mismo motivo que en el SELECT de `findAll`.
        `SELECT i.tipo, i.nombre, p.unidad_medida, p.modo_inventario, p.costo_actual,
                i.moneda_id
         FROM items i
         LEFT JOIN item_producto p ON p.item_id = i.item_id
         WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL
         FOR UPDATE OF i`,
        [dto.itemId, tenantId],
      );
      if (!itemRows.length) {
        throw new NotFoundException('Item no encontrado');
      }
      if (
        itemRows[0].tipo !== 'producto' &&
        itemRows[0].tipo !== 'ingrediente'
      ) {
        throw new BadRequestException(
          'Solo se puede mermar un producto o un ingrediente',
        );
      }

      const causa = await this.causasService.assertCausaActiva(
        manager,
        tenantId,
        dto.causaMermaId,
      );

      const cantidad = new Decimal(dto.cantidad);
      if (cantidad.lessThanOrEqualTo(0) || cantidad.isNaN()) {
        throw new BadRequestException('La cantidad debe ser mayor a cero');
      }
      let cantidadStr = cantidad.toString();

      const unidadBase = itemRows[0].unidad_medida ?? 'unidad';
      const cantidadIngresada = cantidad;
      const huboConversion =
        !!dto.unidadCodigo && dto.unidadCodigo !== unidadBase;
      if (huboConversion) {
        if (itemRows[0].modo_inventario !== 'cantidad') {
          throw new BadRequestException(
            'Los productos por serie o lote solo admiten su unidad base',
          );
        }
        cantidadStr = await this.catalogService.convertirUnidad(
          cantidadStr,
          dto.unidadCodigo!,
          unidadBase,
        );
      }

      const costoActual = itemRows[0].costo_actual;
      let costoUnitarioParam: string | null | undefined =
        dto.costoUnitario ?? null;
      if (
        costoActual == null &&
        (dto.costoUnitario == null || dto.costoUnitario === '')
      ) {
        throw new BadRequestException(
          'El producto no tiene costo actual; indica costoUnitario para valorizar esta merma',
        );
      }
      if (dto.costoUnitario != null && dto.costoUnitario !== '') {
        const c = new Decimal(dto.costoUnitario);
        if (c.isNaN() || c.lessThanOrEqualTo(0)) {
          throw new BadRequestException('El costo unitario debe ser mayor a 0');
        }
        // costoUnitario es "costo por la unidad ingresada" (dto.unidadCodigo),
        // no por la unidad base: si hubo conversión de cantidad, se convierte
        // junto con ella preservando el valor total. costo_actual, en cambio,
        // ya está en unidad base y nunca pasa por acá.
        costoUnitarioParam = huboConversion
          ? convertirCostoUnitario(
              cantidadIngresada.toString(),
              dto.costoUnitario,
              cantidadStr,
            )
          : c.toString();
      } else {
        costoUnitarioParam = undefined;
      }

      const mov = await this.inventarioService.registrarMovimiento(manager, {
        tenantId,
        itemId: dto.itemId,
        usuarioId,
        tipo: 'salida',
        motivo: 'merma',
        cantidad: cantidadStr,
        comentario: dto.comentario ?? null,
        causaMermaId: dto.causaMermaId,
        costoUnitario: costoUnitarioParam,
      });

      const costoCongelado = costoUnitarioParam ?? costoActual!;
      const costoPerdido = new Decimal(cantidadStr)
        .mul(costoCongelado)
        .toFixed(4);

      return {
        movimientoId: mov.movimientoId,
        stockResultante: mov.stockResultante,
        costoUnitario: costoCongelado,
        costoPerdido,
        causaNombre: causa.nombre,
        merma: {
          id: mov.movimientoId,
          itemId: dto.itemId,
          itemNombre: itemRows[0].nombre,
          cantidad: cantidadStr,
          costoUnitario: costoCongelado,
          costoPerdido,
          causaMermaId: dto.causaMermaId,
          causaNombre: causa.nombre,
          comentario: dto.comentario ?? null,
          creadoEl: new Date(),
          usuarioNombre: null,
          unidadMedida: itemRows[0].unidad_medida,
          monedaId: itemRows[0].moneda_id,
          // El SELECT de arriba exige `eliminado_el IS NULL`: no se puede mermar
          // un producto dado de baja, así que la fila recién creada nunca nace
          // marcada. Solo llega a `true` releyendo el listado tras la baja.
          itemEliminado: false,
        },
      };
    });
  }

  async findAll(
    tenantId: string,
    query: FindMermasDto,
  ): Promise<PaginatedResponse<MermaListItem>> {
    const { page, pageSize, offset } = resolvePagination(query);
    // Solo si hay borde de fecha que expandir: ver `rango-fecha.util.ts`.
    const zona = requiereZonaTenant(query.desde, query.hasta)
      ? await zonaHorariaTenant(this.db, tenantId)
      : null;
    const { filters, params } = this.buildFilters(tenantId, query, zona);

    // Sin filtro de borrado del ítem, y en las DOS consultas: una merma
    // registrada es plata perdida que ya ocurrió, así que dar de baja el
    // producto después no puede borrarla del informe ni —peor— bajar el total
    // sin avisar. Mismo criterio que el kardex (`InventarioService`).
    const countRows: { total: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total
       FROM movimientos_inventario mv
       LEFT JOIN items i ON i.item_id = mv.item_id
       WHERE mv.tenant_id = $1 AND mv.eliminado_el IS NULL
         AND mv.motivo = 'merma'
         ${filters}`,
      params,
    );

    const total = countRows[0]?.total ?? 0;
    const listParams = [...params, pageSize, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows: MermaRow[] = await this.db.query(
      `SELECT
         mv.movimiento_id, mv.item_id, i.nombre AS item_nombre,
         mv.cantidad, mv.costo_unitario,
         mv.causa_merma_id, cm.nombre AS causa_nombre,
         mv.comentario, mv.creado_el, u.nombre AS usuario_nombre,
         p.unidad_medida, i.moneda_id,
         (i.eliminado_el IS NOT NULL) AS item_eliminado
       FROM movimientos_inventario mv
       LEFT JOIN items i ON i.item_id = mv.item_id
       LEFT JOIN item_producto p ON p.item_id = mv.item_id
       LEFT JOIN usuarios u ON u.usuario_id = mv.usuario_id AND u.eliminado_el IS NULL
       LEFT JOIN causas_merma cm ON cm.causa_merma_id = mv.causa_merma_id AND cm.eliminado_el IS NULL
       WHERE mv.tenant_id = $1 AND mv.eliminado_el IS NULL
         AND mv.motivo = 'merma'
         ${filters}
       ORDER BY mv.creado_el DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );

    return {
      data: rows.map((r) => this.mapRow(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  private buildFilters(
    tenantId: string,
    query: FindMermasDto,
    zona: string | null,
  ): { filters: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let filters = '';

    let idxZona = 0;
    if (zona != null) {
      params.push(zona);
      idxZona = params.length;
    }

    if (query.itemId) {
      params.push(query.itemId);
      filters += ` AND mv.item_id = $${params.length}`;
    }
    if (query.causaMermaId) {
      params.push(query.causaMermaId);
      filters += ` AND mv.causa_merma_id = $${params.length}`;
    }
    if (query.desde) {
      params.push(query.desde);
      filters += bordeFechaSql(
        'mv.creado_el',
        '>=',
        query.desde,
        params.length,
        idxZona,
      );
    }
    if (query.hasta) {
      params.push(query.hasta);
      filters += bordeFechaSql(
        'mv.creado_el',
        '<=',
        query.hasta,
        params.length,
        idxZona,
      );
    }

    return { filters, params };
  }

  private mapRow(r: MermaRow): MermaListItem {
    return {
      id: r.movimiento_id,
      itemId: r.item_id,
      itemNombre: r.item_nombre,
      cantidad: r.cantidad,
      costoUnitario: r.costo_unitario,
      costoPerdido:
        r.costo_unitario != null
          ? new Decimal(r.cantidad).mul(r.costo_unitario).toFixed(4)
          : null,
      causaMermaId: r.causa_merma_id,
      causaNombre: r.causa_nombre,
      comentario: r.comentario,
      creadoEl: r.creado_el,
      usuarioNombre: r.usuario_nombre,
      unidadMedida: r.unidad_medida,
      monedaId: r.moneda_id,
      itemEliminado: r.item_eliminado,
    };
  }
}
