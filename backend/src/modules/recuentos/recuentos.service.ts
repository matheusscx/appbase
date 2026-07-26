import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { unwrap } from '../../common/utils/pg-returning.util';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import type { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';
import { CreateRecuentoDto } from './dto/create-recuento.dto';

interface ItemParaRecuentoRow {
  item_id: string;
  nombre: string;
  tipo: string;
  stock: string;
  modo_inventario: string;
  unidad_medida: string;
}

interface RecuentoListRow {
  recuento_id: string;
  estado: string;
  comentario: string | null;
  creado_el: Date;
  aplicado_el: Date | null;
  cantidad_lineas: number;
  diferencia_neta: string;
}

interface RecuentoRow {
  recuento_id: string;
  estado: string;
  motivo_diferencia_default_id: string | null;
  comentario: string | null;
  creado_el: Date;
  aplicado_el: Date | null;
}

interface RecuentoLineaRow {
  linea_id: string;
  item_id: string;
  item_nombre: string;
  unidad_medida: string | null;
  stock_sistema: string;
  cantidad_contada: string | null;
  motivo_diferencia_id: string | null;
}

export interface RecuentoListItem {
  id: string;
  estado: string;
  comentario: string | null;
  creadoEl: Date;
  aplicadoEl: Date | null;
  cantidadLineas: number;
  diferenciaNeta: string;
}

export interface RecuentoLinea {
  lineaId: string;
  itemId: string;
  itemNombre: string;
  unidadMedida: string | null;
  stockSistema: string;
  cantidadContada: string | null;
  diferencia: string | null;
  motivoDiferenciaId: string | null;
}

export interface RecuentoDetalle {
  id: string;
  estado: string;
  motivoDiferenciaDefaultId: string | null;
  comentario: string | null;
  creadoEl: Date;
  aplicadoEl: Date | null;
  lineas: RecuentoLinea[];
}

@Injectable()
export class RecuentosService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async create(
    tenantId: string,
    usuarioId: string,
    dto: CreateRecuentoDto,
  ): Promise<{ id: string }> {
    if (!dto.itemIds.length) {
      throw new BadRequestException(
        'El recuento necesita al menos un producto',
      );
    }

    return this.dataSource.transaction(async (manager: EntityManager) => {
      // Una sola query trae todos los items pedidos con su stock vigente —
      // nunca una query por item.
      const rows: ItemParaRecuentoRow[] = await manager.query(
        `SELECT i.item_id, i.nombre, i.tipo, p.stock, p.modo_inventario, p.unidad_medida
           FROM items i
           JOIN item_producto p ON p.item_id = i.item_id
          WHERE i.item_id = ANY($1) AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
        [dto.itemIds, tenantId],
      );

      const rowsPorItemId = new Map(rows.map((r) => [r.item_id, r]));
      for (const itemId of dto.itemIds) {
        if (!rowsPorItemId.has(itemId)) {
          throw new BadRequestException('El item no tiene control de stock');
        }
      }
      for (const row of rows) {
        if (row.modo_inventario !== 'cantidad') {
          throw new BadRequestException(
            `El recuento solo admite productos por cantidad: ${row.nombre}`,
          );
        }
      }

      const sesionRows = unwrap<{ recuento_id: string }>(
        await manager.query(
          `INSERT INTO recuento_inventario (tenant_id, usuario_creador_id, comentario)
           VALUES ($1, $2, $3)
           RETURNING recuento_id`,
          [tenantId, usuarioId, dto.comentario ?? null],
        ),
      );
      const recuentoId = sesionRows[0].recuento_id;

      // Un solo INSERT multi-fila para todas las líneas.
      const values: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      for (const itemId of dto.itemIds) {
        const row = rowsPorItemId.get(itemId)!;
        values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        params.push(tenantId, recuentoId, itemId, row.stock);
      }
      await manager.query(
        `INSERT INTO recuento_inventario_linea (tenant_id, recuento_id, item_id, stock_sistema)
         VALUES ${values.join(', ')}`,
        params,
      );

      return { id: recuentoId };
    });
  }

  async findAll(
    tenantId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<RecuentoListItem>> {
    const { page, pageSize, offset } = resolvePagination(query);

    const countRows: { total: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM recuento_inventario
        WHERE tenant_id = $1 AND eliminado_el IS NULL`,
      [tenantId],
    );
    const total = countRows[0]?.total ?? 0;

    const rows: RecuentoListRow[] = await this.dataSource.query(
      `SELECT r.recuento_id, r.estado, r.comentario, r.creado_el, r.aplicado_el,
              COUNT(l.linea_id)::int AS cantidad_lineas,
              COALESCE(SUM(
                CASE WHEN l.cantidad_contada IS NOT NULL
                     THEN l.cantidad_contada - l.stock_sistema
                     ELSE 0
                END
              ), 0) AS diferencia_neta
         FROM recuento_inventario r
         LEFT JOIN recuento_inventario_linea l
           ON l.recuento_id = r.recuento_id AND l.eliminado_el IS NULL
        WHERE r.tenant_id = $1 AND r.eliminado_el IS NULL
        GROUP BY r.recuento_id
        ORDER BY r.creado_el DESC
        LIMIT $2 OFFSET $3`,
      [tenantId, pageSize, offset],
    );

    return {
      data: rows.map((r) => ({
        id: r.recuento_id,
        estado: r.estado,
        comentario: r.comentario,
        creadoEl: r.creado_el,
        aplicadoEl: r.aplicado_el,
        cantidadLineas: r.cantidad_lineas,
        diferenciaNeta: new Decimal(r.diferencia_neta).toFixed(4),
      })),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async findOne(
    tenantId: string,
    recuentoId: string,
  ): Promise<RecuentoDetalle> {
    const sesionRows: RecuentoRow[] = await this.dataSource.query(
      `SELECT recuento_id, estado, motivo_diferencia_default_id, comentario, creado_el, aplicado_el
         FROM recuento_inventario
        WHERE recuento_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [recuentoId, tenantId],
    );
    if (!sesionRows.length) {
      throw new NotFoundException(`Recuento ${recuentoId} no encontrado`);
    }
    const sesion = sesionRows[0];

    const lineaRows: RecuentoLineaRow[] = await this.dataSource.query(
      `SELECT l.linea_id, l.item_id, i.nombre AS item_nombre, p.unidad_medida,
              l.stock_sistema, l.cantidad_contada, l.motivo_diferencia_id
         FROM recuento_inventario_linea l
         JOIN items i ON i.item_id = l.item_id AND i.eliminado_el IS NULL
         LEFT JOIN item_producto p ON p.item_id = l.item_id
        WHERE l.recuento_id = $1 AND l.tenant_id = $2 AND l.eliminado_el IS NULL
        ORDER BY i.nombre ASC`,
      [recuentoId, tenantId],
    );

    return {
      id: sesion.recuento_id,
      estado: sesion.estado,
      motivoDiferenciaDefaultId: sesion.motivo_diferencia_default_id,
      comentario: sesion.comentario,
      creadoEl: sesion.creado_el,
      aplicadoEl: sesion.aplicado_el,
      lineas: lineaRows.map((l) => ({
        lineaId: l.linea_id,
        itemId: l.item_id,
        itemNombre: l.item_nombre,
        unidadMedida: l.unidad_medida,
        stockSistema: l.stock_sistema,
        cantidadContada: l.cantidad_contada,
        diferencia:
          l.cantidad_contada != null
            ? new Decimal(l.cantidad_contada).minus(l.stock_sistema).toFixed(4)
            : null,
        motivoDiferenciaId: l.motivo_diferencia_id,
      })),
    };
  }
}
