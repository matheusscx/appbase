// backend/src/modules/inventario/inventario.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';
import { MovimientoInventario } from './entities/movimiento-inventario.entity';
import type { FindMovimientosDto } from './dto/find-movimientos.dto';

export interface SerieInput {
  serie: string;
  condicion?: string; // 'nuevo' | 'usado' | 'reacondicionado'
  garantiaHasta?: string; // ISO date string
  loteId?: string;
}

export interface LoteInput {
  codigoLote: string;
  fechaElaboracion?: string;
  fechaVencimiento?: string;
}

export interface RegistrarMovimientoParams {
  tenantId: string;
  itemId: string;
  tipo: 'entrada' | 'salida';
  motivo: string;
  cantidad: string;
  usuarioId: string | null;
  ventaId?: string | null;
  comentario?: string | null;
  // Costo (último costo): si viene en una entrada, congela y actualiza costo_actual;
  // si no viene, se congela el costo_actual vigente.
  costoUnitario?: string | null;
  // Modo 'serie'
  series?: SerieInput[]; // entrada serie: N unidades a crear
  unidadIds?: string[]; // salida serie: IDs de unidades a consumir
  // Modo 'lote'
  lote?: LoteInput; // entrada lote: crea o agrega a lote existente
  loteId?: string; // salida lote: lote a descontar
}

interface MoverResult {
  stockResultante: Decimal;
  unidadIds?: string[];
  loteId?: string;
  loteConsumos?: { loteId: string; cantidad: string }[];
}

@Injectable()
export class InventarioService {
  constructor(
    @InjectRepository(MovimientoInventario)
    private readonly movimientoRepo: Repository<MovimientoInventario>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async registrarMovimiento(
    manager: EntityManager,
    params: RegistrarMovimientoParams,
  ): Promise<{
    movimientoId: string;
    stockAnterior: string;
    stockResultante: string;
  }> {
    const productoRows: {
      stock: string;
      modo_inventario: string;
      costo_actual: string | null;
    }[] = await manager.query(
      `SELECT stock, modo_inventario, costo_actual FROM item_producto WHERE item_id = $1 FOR UPDATE`,
      [params.itemId],
    );
    if (!productoRows.length) {
      throw new BadRequestException('El item no tiene control de stock');
    }

    const modo = productoRows[0].modo_inventario;
    const stockAnterior = new Decimal(productoRows[0].stock);
    const cantidad = new Decimal(params.cantidad);

    if (cantidad.lessThanOrEqualTo(0)) {
      throw new BadRequestException('La cantidad debe ser mayor a cero');
    }

    const costoActualPrevio = productoRows[0].costo_actual ?? null;

    if (params.costoUnitario != null) {
      let costoIngresado: Decimal;
      try {
        costoIngresado = new Decimal(params.costoUnitario);
      } catch {
        throw new BadRequestException('El costo unitario debe ser mayor a 0');
      }
      if (costoIngresado.isNaN() || costoIngresado.lessThanOrEqualTo(0)) {
        throw new BadRequestException('El costo unitario debe ser mayor a 0');
      }
    }

    // Solo la compra actualiza costo_actual; otras entradas pueden congelar un
    // costoUnitario en el movimiento sin pisar el vigente del producto.
    const aplicaCostoNuevo =
      params.costoUnitario != null &&
      params.tipo === 'entrada' &&
      params.motivo === 'compra';
    const costoUnitarioCongelado =
      params.costoUnitario != null
        ? params.costoUnitario
        : costoActualPrevio;

    let result: MoverResult;

    if (modo === 'cantidad') {
      result = await this.moverCantidad(
        manager,
        params,
        stockAnterior,
        cantidad,
      );
    } else if (modo === 'serie') {
      result = await this.moverSerie(manager, params, cantidad);
    } else if (modo === 'lote') {
      result = await this.moverLote(manager, params, cantidad);
    } else {
      throw new BadRequestException(
        `Modo de inventario desconocido: ${String(modo)}`,
      );
    }

    const { stockResultante } = result;

    const insertRows: { movimiento_id: string }[] = await manager.query(
      `INSERT INTO movimientos_inventario
         (tenant_id, item_id, tipo, motivo, cantidad,
          stock_anterior, stock_resultante, venta_id, usuario_id, comentario, costo_unitario)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING movimiento_id`,
      [
        params.tenantId,
        params.itemId,
        params.tipo,
        params.motivo,
        cantidad.toString(),
        stockAnterior.toString(),
        stockResultante.toString(),
        params.ventaId ?? null,
        params.usuarioId,
        params.comentario ?? null,
        costoUnitarioCongelado,
      ],
    );

    const movimientoId = insertRows[0].movimiento_id;
    await this.insertarDetalleMovimiento(
      manager,
      movimientoId,
      params.cantidad,
      result,
    );

    if (aplicaCostoNuevo) {
      await manager.query(
        `UPDATE item_producto SET costo_actual = $1 WHERE item_id = $2`,
        [params.costoUnitario, params.itemId],
      );
    }

    return {
      movimientoId,
      stockAnterior: stockAnterior.toString(),
      stockResultante: stockResultante.toString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers por modo
  // ---------------------------------------------------------------------------

  private async moverCantidad(
    manager: EntityManager,
    params: RegistrarMovimientoParams,
    stockAnterior: Decimal,
    cantidad: Decimal,
  ): Promise<MoverResult> {
    const stockResultante =
      params.tipo === 'entrada'
        ? stockAnterior.plus(cantidad)
        : stockAnterior.minus(cantidad);

    if (stockResultante.lessThan(0)) {
      throw new BadRequestException('Stock insuficiente para la salida');
    }

    await manager.query(
      `UPDATE item_producto SET stock = $1 WHERE item_id = $2`,
      [stockResultante.toString(), params.itemId],
    );

    return { stockResultante };
  }

  private async moverSerie(
    manager: EntityManager,
    params: RegistrarMovimientoParams,
    cantidad: Decimal,
  ): Promise<MoverResult> {
    if (params.tipo === 'entrada') {
      const series = params.series ?? [];
      if (series.length === 0) {
        throw new BadRequestException(
          'Para entrada serie debe proveer las series/IMEIs',
        );
      }
      if (!new Decimal(series.length).equals(cantidad)) {
        throw new BadRequestException(
          `La cantidad (${cantidad.toString()}) no coincide con el número de series (${series.length})`,
        );
      }

      const unidadIds: string[] = [];
      for (const s of series) {
        const rows: { unidad_id: string }[] = await manager.query(
          `INSERT INTO item_unidad
             (tenant_id, item_id, lote_id, serie, estado, condicion, garantia_hasta)
           VALUES ($1,$2,$3,$4,'disponible',$5,$6)
           RETURNING unidad_id`,
          [
            params.tenantId,
            params.itemId,
            s.loteId ?? null,
            s.serie,
            s.condicion ?? 'nuevo',
            s.garantiaHasta ?? null,
          ],
        );
        unidadIds.push(rows[0].unidad_id);
      }

      const stockResultante = await this.recalcularStockSerie(
        manager,
        params.itemId,
        params.tenantId,
      );

      return { stockResultante, unidadIds };
    } else {
      // salida serie
      let unidadIds = params.unidadIds ?? [];
      if (unidadIds.length === 0) {
        // Auto-selección FIFO: las unidades disponibles más antiguas
        const disponibles: { unidad_id: string }[] = await manager.query(
          `SELECT u.unidad_id FROM item_unidad u
           WHERE u.item_id = $1 AND u.tenant_id = $2
             AND u.estado = 'disponible' AND u.eliminado_el IS NULL
           ORDER BY u.creado_el ASC
           LIMIT $3
           FOR UPDATE`,
          [params.itemId, params.tenantId, cantidad.toString()],
        );
        if (!new Decimal(disponibles.length).equals(cantidad)) {
          throw new BadRequestException(
            `Stock insuficiente: se requieren ${cantidad.toString()} unidades disponibles, hay ${disponibles.length}`,
          );
        }
        unidadIds = disponibles.map((u) => u.unidad_id);
      } else if (!new Decimal(unidadIds.length).equals(cantidad)) {
        throw new BadRequestException(
          `La cantidad (${cantidad.toString()}) no coincide con el número de unidades (${unidadIds.length})`,
        );
      }

      const estadoDestino = params.motivo === 'venta' ? 'vendido' : 'baja';

      for (const uid of unidadIds) {
        const rows: { estado: string; item_id: string; tenant_id: string }[] =
          await manager.query(
            `SELECT estado, item_id, tenant_id FROM item_unidad
             WHERE unidad_id = $1 AND eliminado_el IS NULL FOR UPDATE`,
            [uid],
          );
        if (!rows.length) {
          throw new BadRequestException(`Unidad ${uid} no encontrada`);
        }
        if (rows[0].tenant_id !== params.tenantId) {
          throw new BadRequestException(`Unidad ${uid} no pertenece al tenant`);
        }
        if (rows[0].item_id !== params.itemId) {
          throw new BadRequestException(`Unidad ${uid} no pertenece al item`);
        }
        if (rows[0].estado !== 'disponible') {
          throw new BadRequestException(
            `Unidad ${uid} no está disponible (estado: ${rows[0].estado})`,
          );
        }

        await manager.query(
          `UPDATE item_unidad SET estado = $1, venta_id = $2 WHERE unidad_id = $3`,
          [estadoDestino, params.ventaId ?? null, uid],
        );
      }

      const stockResultante = await this.recalcularStockSerie(
        manager,
        params.itemId,
        params.tenantId,
      );

      return { stockResultante, unidadIds };
    }
  }

  private async moverLote(
    manager: EntityManager,
    params: RegistrarMovimientoParams,
    cantidad: Decimal,
  ): Promise<MoverResult> {
    if (params.tipo === 'entrada') {
      const loteInput = params.lote;
      if (!loteInput) {
        throw new BadRequestException(
          'Para entrada lote debe proveer los datos del lote',
        );
      }

      const existentes: { lote_id: string; cantidad_disponible: string }[] =
        await manager.query(
          `SELECT lote_id, cantidad_disponible FROM item_lote
           WHERE item_id = $1 AND codigo_lote = $2 AND eliminado_el IS NULL
           FOR UPDATE`,
          [params.itemId, loteInput.codigoLote],
        );

      let loteId: string;

      if (existentes.length) {
        loteId = existentes[0].lote_id;
        const nuevaDisp = new Decimal(existentes[0].cantidad_disponible).plus(
          cantidad,
        );
        await manager.query(
          `UPDATE item_lote
           SET cantidad_disponible = $1, cantidad_inicial = cantidad_inicial + $2
           WHERE lote_id = $3`,
          [nuevaDisp.toString(), cantidad.toString(), loteId],
        );
      } else {
        const rows: { lote_id: string }[] = await manager.query(
          `INSERT INTO item_lote
             (tenant_id, item_id, codigo_lote, fecha_elaboracion, fecha_vencimiento,
              cantidad_inicial, cantidad_disponible)
           VALUES ($1,$2,$3,$4,$5,$6,$6)
           RETURNING lote_id`,
          [
            params.tenantId,
            params.itemId,
            loteInput.codigoLote,
            loteInput.fechaElaboracion ?? null,
            loteInput.fechaVencimiento ?? null,
            cantidad.toString(),
          ],
        );
        loteId = rows[0].lote_id;
      }

      const stockResultante = await this.recalcularStockLote(
        manager,
        params.itemId,
      );

      return { stockResultante, loteId };
    } else {
      // salida lote
      const loteId = params.loteId;
      if (!loteId) {
        // Auto-selección FIFO: descuenta de los lotes más antiguos
        const lotes: { lote_id: string; cantidad_disponible: string }[] =
          await manager.query(
            `SELECT lote_id, cantidad_disponible FROM item_lote
             WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
               AND cantidad_disponible > 0
             ORDER BY creado_el ASC
             FOR UPDATE`,
            [params.itemId, params.tenantId],
          );

        const totalDisponible = lotes.reduce(
          (acc, l) => acc.plus(l.cantidad_disponible),
          new Decimal(0),
        );
        if (totalDisponible.lessThan(cantidad)) {
          throw new BadRequestException(
            `Stock insuficiente en lotes (disponible: ${totalDisponible.toString()}, requerido: ${cantidad.toString()})`,
          );
        }

        let restante = cantidad;
        const loteConsumos: { loteId: string; cantidad: string }[] = [];
        for (const l of lotes) {
          if (restante.lessThanOrEqualTo(0)) break;
          const disp = new Decimal(l.cantidad_disponible);
          const tomar = Decimal.min(disp, restante);
          await manager.query(
            `UPDATE item_lote SET cantidad_disponible = $1 WHERE lote_id = $2`,
            [disp.minus(tomar).toString(), l.lote_id],
          );
          loteConsumos.push({
            loteId: l.lote_id,
            cantidad: tomar.toString(),
          });
          restante = restante.minus(tomar);
        }

        const stockResultante = await this.recalcularStockLote(
          manager,
          params.itemId,
        );

        return { stockResultante, loteConsumos };
      }

      const rows: { cantidad_disponible: string; tenant_id: string }[] =
        await manager.query(
          `SELECT cantidad_disponible, tenant_id FROM item_lote
           WHERE lote_id = $1 AND item_id = $2 AND eliminado_el IS NULL
           FOR UPDATE`,
          [loteId, params.itemId],
        );

      if (!rows.length) {
        throw new BadRequestException('Lote no encontrado');
      }
      if (rows[0].tenant_id !== params.tenantId) {
        throw new BadRequestException('El lote no pertenece al tenant');
      }

      const disponible = new Decimal(rows[0].cantidad_disponible);
      if (disponible.lessThan(cantidad)) {
        throw new BadRequestException(
          `Stock insuficiente en el lote (disponible: ${disponible.toString()})`,
        );
      }

      await manager.query(
        `UPDATE item_lote SET cantidad_disponible = $1 WHERE lote_id = $2`,
        [disponible.minus(cantidad).toString(), loteId],
      );

      const stockResultante = await this.recalcularStockLote(
        manager,
        params.itemId,
      );

      return { stockResultante, loteId };
    }
  }

  // ---------------------------------------------------------------------------
  // Recálculo de saldo materializado
  // ---------------------------------------------------------------------------

  private async recalcularStockSerie(
    manager: EntityManager,
    itemId: string,
    tenantId: string,
  ): Promise<Decimal> {
    const rows: { cnt: string }[] = await manager.query(
      `SELECT COUNT(*) AS cnt FROM item_unidad
       WHERE item_id = $1 AND tenant_id = $2
         AND estado = 'disponible' AND eliminado_el IS NULL`,
      [itemId, tenantId],
    );
    const nuevo = new Decimal(rows[0].cnt);
    await manager.query(
      `UPDATE item_producto SET stock = $1 WHERE item_id = $2`,
      [nuevo.toString(), itemId],
    );
    return nuevo;
  }

  private async recalcularStockLote(
    manager: EntityManager,
    itemId: string,
  ): Promise<Decimal> {
    const rows: { total: string }[] = await manager.query(
      `SELECT COALESCE(SUM(cantidad_disponible), 0) AS total
       FROM item_lote
       WHERE item_id = $1 AND eliminado_el IS NULL`,
      [itemId],
    );
    const nuevo = new Decimal(rows[0].total);
    await manager.query(
      `UPDATE item_producto SET stock = $1 WHERE item_id = $2`,
      [nuevo.toString(), itemId],
    );
    return nuevo;
  }

  // ---------------------------------------------------------------------------
  // Detalle del movimiento
  // ---------------------------------------------------------------------------

  private async insertarDetalleMovimiento(
    manager: EntityManager,
    movimientoId: string,
    cantidad: string,
    result: MoverResult,
  ): Promise<void> {
    if (result.unidadIds?.length) {
      for (const uid of result.unidadIds) {
        await manager.query(
          `INSERT INTO movimiento_inventario_detalle
             (movimiento_id, unidad_id, cantidad)
           VALUES ($1, $2, '1')`,
          [movimientoId, uid],
        );
      }
    } else if (result.loteConsumos?.length) {
      for (const c of result.loteConsumos) {
        await manager.query(
          `INSERT INTO movimiento_inventario_detalle
             (movimiento_id, lote_id, cantidad)
           VALUES ($1, $2, $3)`,
          [movimientoId, c.loteId, c.cantidad],
        );
      }
    } else if (result.loteId) {
      await manager.query(
        `INSERT INTO movimiento_inventario_detalle
           (movimiento_id, lote_id, cantidad)
         VALUES ($1, $2, $3)`,
        [movimientoId, result.loteId, cantidad],
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Lectura
  // ---------------------------------------------------------------------------

  async findMovimientos(
    tenantId: string,
    query: FindMovimientosDto,
  ): Promise<PaginatedResponse<MovimientoListItem>> {
    const { page, pageSize, offset } = resolvePagination(query);
    const { filters, params } = this.buildMovimientosFilters(tenantId, query);

    const countRows: { total: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total
       FROM movimientos_inventario mv
       JOIN items i ON i.item_id = mv.item_id AND i.eliminado_el IS NULL
       WHERE mv.tenant_id = $1 AND mv.eliminado_el IS NULL
         ${filters}`,
      params,
    );

    const total = countRows[0]?.total ?? 0;
    const listParams = [...params, pageSize, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows: MovimientoRow[] = await this.dataSource.query(
      `SELECT
         mv.movimiento_id, mv.item_id, i.nombre AS item_nombre,
         mv.tipo, mv.motivo, mv.cantidad,
         mv.stock_anterior, mv.stock_resultante,
         mv.usuario_id, u.nombre AS usuario_nombre,
         mv.comentario, mv.creado_el, mv.costo_unitario
       FROM movimientos_inventario mv
       JOIN items i ON i.item_id = mv.item_id AND i.eliminado_el IS NULL
       LEFT JOIN usuarios u ON u.usuario_id = mv.usuario_id AND u.eliminado_el IS NULL
       WHERE mv.tenant_id = $1 AND mv.eliminado_el IS NULL
         ${filters}
       ORDER BY mv.creado_el DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );

    return {
      data: rows.map((r) => this.mapMovimientoRow(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  private buildMovimientosFilters(
    tenantId: string,
    query: FindMovimientosDto,
  ): { filters: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let paramIdx = 2;
    let filters = '';

    if (query.itemId) {
      filters += ` AND mv.item_id = $${paramIdx++}`;
      params.push(query.itemId);
    }
    if (query.motivo) {
      filters += ` AND mv.motivo = $${paramIdx++}`;
      params.push(query.motivo);
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

  private mapMovimientoRow(r: MovimientoRow): MovimientoListItem {
    return {
      id: r.movimiento_id,
      itemId: r.item_id,
      itemNombre: r.item_nombre,
      tipo: r.tipo,
      motivo: r.motivo,
      cantidad: r.cantidad,
      stockAnterior: r.stock_anterior,
      stockResultante: r.stock_resultante,
      usuarioId: r.usuario_id,
      usuarioNombre: r.usuario_nombre,
      comentario: r.comentario,
      creadoEl: r.creado_el,
      costoUnitario: r.costo_unitario,
    };
  }
}

export interface MovimientoListItem {
  id: string;
  itemId: string;
  itemNombre: string;
  tipo: string;
  motivo: string;
  cantidad: string;
  stockAnterior: string;
  stockResultante: string;
  usuarioId: string | null;
  usuarioNombre: string | null;
  comentario: string | null;
  creadoEl: Date;
  costoUnitario: string | null;
}

interface MovimientoRow {
  movimiento_id: string;
  item_id: string;
  item_nombre: string;
  tipo: string;
  motivo: string;
  cantidad: string;
  stock_anterior: string;
  stock_resultante: string;
  usuario_id: string | null;
  usuario_nombre: string | null;
  comentario: string | null;
  creado_el: Date;
  costo_unitario: string | null;
}
