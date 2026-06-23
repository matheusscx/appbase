// backend/src/modules/inventario/inventario.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { MovimientoInventario } from './entities/movimiento-inventario.entity';

export interface RegistrarMovimientoParams {
  tenantId: string;
  itemId: string;
  tipo: 'entrada' | 'salida';
  motivo: string;
  cantidad: string;
  usuarioId: string | null;
  ventaId?: string | null;
  comentario?: string | null;
}

@Injectable()
export class InventarioService {
  constructor(
    @InjectRepository(MovimientoInventario)
    private readonly movimientoRepo: Repository<MovimientoInventario>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Registra un movimiento y muta el saldo materializado en item_producto
   * dentro de la transacción del caller (manager-aware). Reutilizable por
   * ventas: cada línea generará salida/motivo='venta' con el mismo manager.
   */
  async registrarMovimiento(
    manager: EntityManager,
    params: RegistrarMovimientoParams,
  ): Promise<{
    movimientoId: string;
    stockAnterior: string;
    stockResultante: string;
  }> {
    const productoRows: { stock: string }[] = await manager.query(
      `SELECT stock FROM item_producto WHERE item_id = $1 FOR UPDATE`,
      [params.itemId],
    );
    if (!productoRows.length) {
      throw new BadRequestException('El item no tiene control de stock');
    }

    const stockAnterior = new Decimal(productoRows[0].stock);
    const cantidad = new Decimal(params.cantidad);
    if (cantidad.lessThanOrEqualTo(0)) {
      throw new BadRequestException('La cantidad debe ser mayor a cero');
    }

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

    const insertRows: { movimiento_id: string }[] = await manager.query(
      `INSERT INTO movimientos_inventario
         (tenant_id, item_id, tipo, motivo, cantidad,
          stock_anterior, stock_resultante, venta_id, usuario_id, comentario)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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
      ],
    );

    return {
      movimientoId: insertRows[0].movimiento_id,
      stockAnterior: stockAnterior.toString(),
      stockResultante: stockResultante.toString(),
    };
  }
}
