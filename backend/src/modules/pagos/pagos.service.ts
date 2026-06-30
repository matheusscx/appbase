import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { CajaService } from '../caja/caja.service';
import { EstadoVenta } from '../ventas/entities/venta.entity';
import { Pago } from './entities/pago.entity';
import type { CreatePagoDto, PagoItemDto } from './dto/create-pago.dto';
import type { QueryPagosDto } from './dto/query-pagos.dto';

// ─── helper puro (exportado para tests) ──────────────────────────────────────

export function calcularEstadoVenta(
  totalFinal: string,
  montoAplicadoTotal: string,
): EstadoVenta {
  const total = new Decimal(totalFinal);
  const aplicado = new Decimal(montoAplicadoTotal);
  if (aplicado.gte(total)) return EstadoVenta.PAGADA;
  if (aplicado.lte(0)) return EstadoVenta.PENDIENTE;
  return EstadoVenta.PAGADA_PARCIAL;
}

// ─── tipos de respuesta ───────────────────────────────────────────────────────

export interface PagoListItem {
  id: string;
  ventaId: string;
  monto: string;
  vuelto: string;
  fecha: Date;
  cajaId: string | null;
  referencia: string | null;
  metodoNombre: string;
  ventaEstado: string;
  totalFinal: string;
  customerNombre: string | null;
}

// ─── service ─────────────────────────────────────────────────────────────────

@Injectable()
export class PagosService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly cajaService: CajaService,
  ) {}

  /**
   * Lógica compartida de creación de pagos dentro de una transacción existente.
   * Usada tanto en VentasService (al crear) como en PagosService.registrarAbono.
   */
  async registrar(
    manager: EntityManager,
    params: {
      tenantId: string;
      ventaId: string;
      pagos: PagoItemDto[];
      cajaId: string;
      monedaOficialId: string;
      target: string;
    },
  ): Promise<Pago[]> {
    const { tenantId, ventaId, pagos, cajaId, monedaOficialId, target } =
      params;

    // Ventas sin pago = cuentas por cobrar
    if (pagos.length === 0) return [];

    // Resolver nombre + permite_vuelto de cada método de pago
    const metodoPagoRows: {
      metodo_pago_id: string;
      nombre: string;
      permite_vuelto: boolean;
    }[] = await manager.query(
      `SELECT tmp.metodo_pago_id, mp.nombre, tmp.permite_vuelto
       FROM tenant_metodo_pago tmp
       JOIN metodos_pago mp ON mp.metodo_pago_id = tmp.metodo_pago_id
                            AND mp.eliminado_el IS NULL
       WHERE tmp.tenant_id = $1
         AND tmp.metodo_pago_id = ANY($2::uuid[])
         AND tmp.eliminado_el IS NULL`,
      [tenantId, pagos.map((p) => p.metodoPagoId)],
    );

    const metodoPagoMap = new Map(
      metodoPagoRows.map((r) => [
        r.metodo_pago_id,
        { nombre: r.nombre, permiteVuelto: r.permite_vuelto },
      ]),
    );

    // Calcular excedente (vuelto global)
    const sumaPagos = pagos.reduce(
      (acc, p) => acc.plus(p.monto),
      new Decimal(0),
    );
    const targetDecimal = new Decimal(target);
    const excedente = Decimal.max(0, sumaPagos.minus(targetDecimal));

    let pagoConVueltoIdx = -1;
    if (excedente.gt(0)) {
      pagoConVueltoIdx = pagos.findIndex(
        (p) => metodoPagoMap.get(p.metodoPagoId)?.permiteVuelto === true,
      );
      if (pagoConVueltoIdx === -1) {
        throw new BadRequestException(
          'El pago supera el total pero ningún método de pago permite vuelto',
        );
      }
    }

    // Guardar pagos + movimientos de caja
    const pagosGuardados: Pago[] = [];
    for (let i = 0; i < pagos.length; i++) {
      const p = pagos[i];
      const vuelto = i === pagoConVueltoIdx ? excedente.toFixed(4) : '0.0000';
      const pago = await manager.save(
        Pago,
        manager.create(Pago, {
          tenantId,
          ventaId,
          metodoPagoId: p.metodoPagoId,
          monedaOficialId,
          cajaId,
          monto: p.monto,
          vuelto,
          referencia: p.referencia ?? null,
        }),
      );
      pagosGuardados.push(pago);
    }

    // Movimiento de caja por cada pago
    for (let i = 0; i < pagos.length; i++) {
      const p = pagos[i];
      const vueltoDecimal = new Decimal(pagosGuardados[i].vuelto ?? '0');
      const montoNeto = new Decimal(p.monto).minus(vueltoDecimal).toFixed(4);
      await this.cajaService.registrarMovimientoEnTransaccion(manager, {
        cajaId,
        tipo: 'entrada',
        concepto: `Venta · ${metodoPagoMap.get(p.metodoPagoId)?.nombre ?? 'Pago'}`,
        monto: montoNeto,
        ventaId,
        pagoId: pagosGuardados[i].id,
        metodoPagoId: p.metodoPagoId,
      });
    }

    return pagosGuardados;
  }

  /**
   * Registra un abono sobre una venta pendiente o pagada_parcial.
   */
  async registrarAbono(
    tenantId: string,
    usuarioId: string,
    dto: CreatePagoDto,
  ): Promise<{
    pagos: Pago[];
    venta: { id: string; estado: EstadoVenta; saldo: string };
  }> {
    return this.dataSource.transaction(async (manager) => {
      // Cargar venta
      const ventaRows: {
        venta_id: string;
        total_final: string;
        estado: string;
        moneda_id: string;
      }[] = await manager.query(
        `SELECT venta_id, total_final, estado, moneda_id
         FROM ventas
         WHERE venta_id = $1
           AND tenant_id = $2
           AND eliminado_el IS NULL`,
        [dto.ventaId, tenantId],
      );

      if (!ventaRows.length) {
        throw new NotFoundException('Venta no encontrada');
      }

      const venta = ventaRows[0];

      if (!['pendiente', 'pagada_parcial'].includes(venta.estado)) {
        throw new BadRequestException(
          'Solo se puede abonar a ventas pendientes o pagadas parcialmente',
        );
      }

      // Verificar caja abierta
      const caja = await this.cajaService.findActiva(tenantId, usuarioId);
      if (!caja) {
        throw new BadRequestException('No tienes una caja abierta');
      }

      // Calcular monto ya aplicado
      const pagosAplicadosRows: { monto_aplicado: string }[] =
        await manager.query(
          `SELECT COALESCE(SUM(monto - vuelto), 0) AS monto_aplicado
           FROM pagos
           WHERE venta_id = $1
             AND eliminado_el IS NULL`,
          [dto.ventaId],
        );

      const montoAplicado = new Decimal(
        pagosAplicadosRows[0]?.monto_aplicado ?? '0',
      );
      const totalFinal = new Decimal(venta.total_final);
      const saldo = Decimal.max(0, totalFinal.minus(montoAplicado));

      // Registrar los nuevos pagos
      const savedPagos = await this.registrar(manager, {
        tenantId,
        ventaId: dto.ventaId,
        pagos: dto.pagos,
        cajaId: caja.id,
        monedaOficialId: venta.moneda_id,
        target: saldo.toFixed(4),
      });

      // Recalcular monto total aplicado y nuevo estado
      const montoNuevosPagos = savedPagos.reduce(
        (acc, p) =>
          acc.plus(new Decimal(p.monto).minus(new Decimal(p.vuelto ?? '0'))),
        new Decimal(0),
      );
      const newMontoAplicado = montoAplicado.plus(montoNuevosPagos);
      const newEstado = calcularEstadoVenta(
        venta.total_final,
        newMontoAplicado.toFixed(4),
      );
      const newSaldo = Decimal.max(
        0,
        totalFinal.minus(newMontoAplicado),
      ).toFixed(4);

      // Actualizar estado de la venta
      await manager.query(
        `UPDATE ventas SET estado = $1, actualizado_el = NOW() WHERE venta_id = $2`,
        [newEstado, dto.ventaId],
      );

      return {
        pagos: savedPagos,
        venta: { id: dto.ventaId, estado: newEstado, saldo: newSaldo },
      };
    });
  }

  /**
   * Listado de pagos con filtros opcionales.
   */
  async listar(
    tenantId: string,
    query: QueryPagosDto,
  ): Promise<PagoListItem[]> {
    const params: unknown[] = [tenantId];
    let paramIdx = 2;
    let filters = '';

    if (query.fechaDesde) {
      filters += ` AND p.fecha >= $${paramIdx++}`;
      params.push(query.fechaDesde);
    }
    if (query.fechaHasta) {
      filters += ` AND p.fecha <= $${paramIdx++}`;
      params.push(query.fechaHasta);
    }
    if (query.metodoPagoId) {
      filters += ` AND p.metodo_pago_id = $${paramIdx++}`;
      params.push(query.metodoPagoId);
    }
    if (query.cajaId) {
      filters += ` AND p.caja_id = $${paramIdx++}`;
      params.push(query.cajaId);
    }
    if (query.ventaId) {
      filters += ` AND p.venta_id = $${paramIdx++}`;
      params.push(query.ventaId);
    }

    const rows: {
      pago_id: string;
      venta_id: string;
      monto: string;
      vuelto: string;
      fecha: Date;
      caja_id: string | null;
      referencia: string | null;
      metodo_nombre: string;
      venta_estado: string;
      total_final: string;
      customer_nombre: string | null;
    }[] = await this.dataSource.query(
      `SELECT p.pago_id,
              p.venta_id,
              p.monto,
              p.vuelto,
              p.fecha,
              p.caja_id,
              p.referencia,
              mp.nombre      AS metodo_nombre,
              v.estado       AS venta_estado,
              v.total_final,
              vc.nombre      AS customer_nombre
       FROM pagos p
       JOIN ventas v
         ON v.venta_id = p.venta_id
        AND v.eliminado_el IS NULL
       JOIN tenant_metodo_pago tmp
         ON tmp.metodo_pago_id = p.metodo_pago_id
        AND tmp.tenant_id = p.tenant_id
        AND tmp.eliminado_el IS NULL
       JOIN metodos_pago mp
         ON mp.metodo_pago_id = p.metodo_pago_id
        AND mp.eliminado_el IS NULL
       LEFT JOIN venta_customer vc
         ON vc.venta_id = p.venta_id
        AND vc.eliminado_el IS NULL
       WHERE p.tenant_id = $1
         AND p.eliminado_el IS NULL
         ${filters}
       ORDER BY p.creado_el DESC`,
      params,
    );

    return rows.map((r) => ({
      id: r.pago_id,
      ventaId: r.venta_id,
      monto: r.monto,
      vuelto: r.vuelto,
      fecha: r.fecha,
      cajaId: r.caja_id,
      referencia: r.referencia,
      metodoNombre: r.metodo_nombre,
      ventaEstado: r.venta_estado,
      totalFinal: r.total_final,
      customerNombre: r.customer_nombre,
    }));
  }
}
