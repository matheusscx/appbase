import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';
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
}

interface MermaRow {
  movimiento_id: string;
  item_id: string;
  item_nombre: string;
  cantidad: string;
  costo_unitario: string | null;
  causa_merma_id: string | null;
  causa_nombre: string | null;
  comentario: string | null;
  creado_el: Date;
  usuario_nombre: string | null;
}

@Injectable()
export class MermasService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly inventarioService: InventarioService,
    private readonly catalogService: CatalogService,
    private readonly causasService: CausasMermaService,
  ) {}

  async registrar(
    tenantId: string,
    usuarioId: string,
    dto: CreateMermaDto,
  ): Promise<MermaResponse> {
    return this.dataSource.transaction(async (manager) => {
      const itemRows: {
        tipo: string;
        unidad_medida: string | null;
        modo_inventario: string | null;
        costo_actual: string | null;
        nombre: string;
      }[] = await manager.query(
        `SELECT i.tipo, i.nombre, p.unidad_medida, p.modo_inventario, p.costo_actual
         FROM items i
         LEFT JOIN item_producto p ON p.item_id = i.item_id
         WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL
         FOR UPDATE OF i`,
        [dto.itemId, tenantId],
      );
      if (!itemRows.length) {
        throw new NotFoundException('Item no encontrado');
      }
      if (itemRows[0].tipo !== 'producto' && itemRows[0].tipo !== 'ingrediente') {
        throw new BadRequestException(
          'Solo se puede mermar un producto o un ingrediente',
        );
      }

      const causa = await this.causasService.assertCausaActiva(
        manager,
        tenantId,
        dto.causaMermaId,
      );

      let cantidad = new Decimal(dto.cantidad);
      if (cantidad.lessThanOrEqualTo(0) || cantidad.isNaN()) {
        throw new BadRequestException('La cantidad debe ser mayor a cero');
      }
      let cantidadStr = cantidad.toString();

      const unidadBase = itemRows[0].unidad_medida ?? 'unidad';
      if (dto.unidadCodigo && dto.unidadCodigo !== unidadBase) {
        if (itemRows[0].modo_inventario !== 'cantidad') {
          throw new BadRequestException(
            'Los productos por serie o lote solo admiten su unidad base',
          );
        }
        cantidadStr = await this.catalogService.convertirUnidad(
          cantidadStr,
          dto.unidadCodigo,
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
        costoUnitarioParam = c.toString();
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
      };
    });
  }

  async findAll(
    tenantId: string,
    query: FindMermasDto,
  ): Promise<PaginatedResponse<MermaListItem>> {
    const { page, pageSize, offset } = resolvePagination(query);
    const { filters, params } = this.buildFilters(tenantId, query);

    const countRows: { total: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total
       FROM movimientos_inventario mv
       JOIN items i ON i.item_id = mv.item_id AND i.eliminado_el IS NULL
       WHERE mv.tenant_id = $1 AND mv.eliminado_el IS NULL
         AND mv.motivo = 'merma'
         ${filters}`,
      params,
    );

    const total = countRows[0]?.total ?? 0;
    const listParams = [...params, pageSize, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows: MermaRow[] = await this.dataSource.query(
      `SELECT
         mv.movimiento_id, mv.item_id, i.nombre AS item_nombre,
         mv.cantidad, mv.costo_unitario,
         mv.causa_merma_id, cm.nombre AS causa_nombre,
         mv.comentario, mv.creado_el, u.nombre AS usuario_nombre
       FROM movimientos_inventario mv
       JOIN items i ON i.item_id = mv.item_id AND i.eliminado_el IS NULL
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
  ): { filters: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let paramIdx = 2;
    let filters = '';

    if (query.itemId) {
      filters += ` AND mv.item_id = $${paramIdx++}`;
      params.push(query.itemId);
    }
    if (query.causaMermaId) {
      filters += ` AND mv.causa_merma_id = $${paramIdx++}`;
      params.push(query.causaMermaId);
    }
    if (query.desde) {
      filters += ` AND mv.creado_el >= $${paramIdx++}`;
      params.push(query.desde);
    }
    if (query.hasta) {
      filters += ` AND mv.creado_el <= $${paramIdx++}`;
      params.push(query.hasta);
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
    };
  }
}
