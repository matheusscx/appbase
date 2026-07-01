import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { Caja } from './entities/caja.entity';
import { MovimientoCaja } from './entities/movimiento-caja.entity';
import type { AbrirCajaDto } from './dto/abrir-caja.dto';
import type { CrearMovimientoDto } from './dto/crear-movimiento.dto';
import type { CerrarCajaDto } from './dto/cerrar-caja.dto';
import type { QueryMovimientosCajaDto } from './dto/query-movimientos-caja.dto';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';

export interface CajaAbierta {
  id: string;
  usuarioId: string | null;
  usuarioNombre: string;
  saldoInicial: string;
  saldoEsperado: string;
  fechaApertura: Date;
  esPropia: boolean;
}

export interface MovimientoCajaListItem {
  id: string;
  cajaId: string;
  tipo: string;
  concepto: string;
  monto: string;
  referencia: string | null;
  fecha: Date;
  ventaId: string | null;
}

export interface CajaTurnoResumen {
  saldoInicial: string;
  totalEntradas: string;
  totalSalidas: string;
  saldoEsperado: string;
  totalMovimientos: number;
}

@Injectable()
export class CajaService {
  constructor(
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    @InjectRepository(MovimientoCaja)
    private readonly movimientoCajaRepo: Repository<MovimientoCaja>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findActiva(tenantId: string, usuarioId: string): Promise<Caja | null> {
    return this.cajaRepo.findOne({
      where: {
        tenantId,
        usuarioId,
        tipo: 'fisica',
        estado: 'abierta',
        eliminadoEl: IsNull(),
      },
    });
  }

  async abrir(
    tenantId: string,
    usuarioId: string,
    dto: AbrirCajaDto,
  ): Promise<Caja> {
    const existente = await this.findActiva(tenantId, usuarioId);
    if (existente) {
      throw new ConflictException('Ya tienes una caja abierta');
    }

    const caja = this.cajaRepo.create({
      tenantId,
      usuarioId,
      tipo: 'fisica',
      estado: 'abierta',
      saldoInicial: dto.saldoInicial,
      comentario: dto.comentario,
    });

    return this.cajaRepo.save(caja);
  }

  async calcularSaldoEsperado(
    cajaId: string,
    manager: EntityManager,
  ): Promise<string> {
    const rows: {
      saldo_inicial: string;
      total_entradas: string | null;
      total_salidas: string | null;
    }[] = await manager.query(
      `SELECT c.saldo_inicial,
              SUM(m.monto) FILTER (WHERE m.tipo = 'entrada' AND m.eliminado_el IS NULL) AS total_entradas,
              SUM(m.monto) FILTER (WHERE m.tipo = 'salida'  AND m.eliminado_el IS NULL) AS total_salidas
       FROM cajas c
       LEFT JOIN movimientos_caja m ON m.caja_id = c.caja_id
       WHERE c.caja_id = $1
         AND c.eliminado_el IS NULL
       GROUP BY c.saldo_inicial`,
      [cajaId],
    );

    const row = rows[0];
    const saldoInicial = new Decimal(row?.saldo_inicial ?? '0');
    const entradas = new Decimal(row?.total_entradas ?? '0');
    const salidas = new Decimal(row?.total_salidas ?? '0');
    return saldoInicial.plus(entradas).minus(salidas).toFixed(4);
  }

  async cerrar(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    dto: CerrarCajaDto,
  ): Promise<Caja> {
    return this.dataSource.transaction(async (manager) => {
      const caja = await manager.findOne(Caja, {
        where: {
          id: cajaId,
          tenantId,
          estado: 'abierta',
          eliminadoEl: IsNull(),
        },
      });

      if (!caja) {
        throw new ForbiddenException('Caja no encontrada o no está abierta');
      }

      if (caja.usuarioId !== usuarioId) {
        throw new ForbiddenException('No tienes acceso a esta caja');
      }

      const saldoEsperado = await this.calcularSaldoEsperado(cajaId, manager);
      const diferencia = new Decimal(dto.montoContado).minus(saldoEsperado);

      caja.saldoFinal = saldoEsperado;
      caja.montoContado = dto.montoContado;
      caja.diferencia = diferencia.toFixed(4);
      caja.fechaCierre = new Date();
      caja.estado = 'cerrada';
      caja.comentario = dto.comentario ?? null;

      return manager.save(Caja, caja);
    });
  }

  async registrarMovimientoEnTransaccion(
    manager: EntityManager,
    params: {
      cajaId: string;
      tipo: string;
      concepto: string;
      monto: string;
      referencia?: string | null;
      ventaId?: string | null;
      pagoId?: string | null;
      metodoPagoId?: string | null;
    },
  ): Promise<MovimientoCaja> {
    const movimiento = manager.create(MovimientoCaja, {
      cajaId: params.cajaId,
      tipo: params.tipo,
      concepto: params.concepto,
      monto: params.monto,
      referencia: params.referencia ?? null,
      ventaId: params.ventaId ?? null,
      pagoId: params.pagoId ?? null,
      metodoPagoId: params.metodoPagoId ?? null,
    });
    return manager.save(MovimientoCaja, movimiento);
  }

  async registrarMovimiento(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    dto: CrearMovimientoDto,
  ): Promise<MovimientoCaja> {
    return this.dataSource.transaction(async (manager) => {
      const caja = await manager.findOne(Caja, {
        where: {
          id: cajaId,
          tenantId,
          estado: 'abierta',
          eliminadoEl: IsNull(),
        },
      });

      if (!caja) {
        throw new ForbiddenException('Caja no encontrada o no está abierta');
      }

      if (caja.usuarioId !== usuarioId) {
        throw new ForbiddenException('No tienes acceso a esta caja');
      }

      const saldoEsperado = await this.calcularSaldoEsperado(cajaId, manager);

      if (
        dto.tipo === 'salida' &&
        new Decimal(saldoEsperado).minus(dto.monto).lt(0)
      ) {
        throw new UnprocessableEntityException('Saldo insuficiente en caja');
      }

      return this.registrarMovimientoEnTransaccion(manager, {
        cajaId,
        tipo: dto.tipo,
        concepto: dto.concepto,
        monto: dto.monto,
        referencia: dto.referencia,
      });
    });
  }

  async historial(
    tenantId: string,
    usuarioId: string,
    todas: boolean,
  ): Promise<Caja[]> {
    const where: Record<string, unknown> = {
      tenantId,
      tipo: 'fisica',
      eliminadoEl: IsNull(),
    };
    if (!todas) {
      where.usuarioId = usuarioId;
    }
    return this.cajaRepo.find({
      where,
      order: { fechaApertura: 'DESC' },
    });
  }

  async abiertas(
    tenantId: string,
    usuarioId: string,
    tieneVerTodas: boolean,
  ): Promise<CajaAbierta[]> {
    const rows: {
      caja_id: string;
      usuario_id: string | null;
      usuario_nombre: string | null;
      usuario_apellido: string | null;
      saldo_inicial: string;
      fecha_apertura: Date;
      total_entradas: string | null;
      total_salidas: string | null;
    }[] = await this.dataSource.query(
      `SELECT c.caja_id,
              c.usuario_id,
              u.nombre   AS usuario_nombre,
              u.apellido AS usuario_apellido,
              c.saldo_inicial,
              c.fecha_apertura,
              SUM(m.monto) FILTER (WHERE m.tipo = 'entrada' AND m.eliminado_el IS NULL) AS total_entradas,
              SUM(m.monto) FILTER (WHERE m.tipo = 'salida'  AND m.eliminado_el IS NULL) AS total_salidas
       FROM cajas c
       LEFT JOIN usuarios u ON u.usuario_id = c.usuario_id AND u.eliminado_el IS NULL
       LEFT JOIN movimientos_caja m ON m.caja_id = c.caja_id
       WHERE c.tenant_id = $1
         AND c.tipo = 'fisica'
         AND c.estado = 'abierta'
         AND c.eliminado_el IS NULL
         AND ($2::boolean OR c.usuario_id = $3)
       GROUP BY c.caja_id, u.nombre, u.apellido
       ORDER BY c.fecha_apertura DESC`,
      [tenantId, tieneVerTodas, usuarioId],
    );

    return rows.map((r) => {
      const saldoEsperado = new Decimal(r.saldo_inicial)
        .plus(r.total_entradas ?? '0')
        .minus(r.total_salidas ?? '0')
        .toFixed(4);
      const nombre = [r.usuario_nombre, r.usuario_apellido]
        .filter((p): p is string => Boolean(p))
        .join(' ')
        .trim();
      return {
        id: r.caja_id,
        usuarioId: r.usuario_id,
        usuarioNombre: nombre || 'Sin usuario',
        saldoInicial: new Decimal(r.saldo_inicial).toFixed(4),
        saldoEsperado,
        fechaApertura: r.fecha_apertura,
        esPropia: r.usuario_id === usuarioId,
      };
    });
  }

  async findOne(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    tieneVerTodas: boolean,
  ): Promise<Caja> {
    const caja = await this.cajaRepo.findOne({
      where: { id: cajaId, tenantId, eliminadoEl: IsNull() },
    });
    if (!caja) {
      throw new NotFoundException('Caja no encontrada');
    }
    if (caja.usuarioId !== usuarioId && !tieneVerTodas) {
      throw new ForbiddenException('No tienes acceso a esta caja');
    }
    return caja;
  }

  async resumenMovimientos(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    tieneVerTodas = false,
  ): Promise<CajaTurnoResumen> {
    await this.verificarAccesoCaja(tenantId, usuarioId, cajaId, tieneVerTodas);

    const rows: {
      saldo_inicial: string;
      total_entradas: string;
      total_salidas: string;
      total_movimientos: number;
    }[] = await this.dataSource.query(
      `SELECT c.saldo_inicial,
              COALESCE(SUM(m.monto) FILTER (
                WHERE m.tipo = 'entrada' AND m.eliminado_el IS NULL
              ), 0)::text AS total_entradas,
              COALESCE(SUM(m.monto) FILTER (
                WHERE m.tipo = 'salida' AND m.eliminado_el IS NULL
              ), 0)::text AS total_salidas,
              COUNT(m.movimiento_id) FILTER (
                WHERE m.eliminado_el IS NULL
              )::int AS total_movimientos
       FROM cajas c
       LEFT JOIN movimientos_caja m ON m.caja_id = c.caja_id
       WHERE c.caja_id = $1
         AND c.tenant_id = $2
         AND c.eliminado_el IS NULL
       GROUP BY c.saldo_inicial`,
      [cajaId, tenantId],
    );

    const row = rows[0];
    const saldoInicial = new Decimal(row?.saldo_inicial ?? '0');
    const totalEntradas = new Decimal(row?.total_entradas ?? '0');
    const totalSalidas = new Decimal(row?.total_salidas ?? '0');

    return {
      saldoInicial: saldoInicial.toFixed(4),
      totalEntradas: totalEntradas.toFixed(4),
      totalSalidas: totalSalidas.toFixed(4),
      saldoEsperado: saldoInicial
        .plus(totalEntradas)
        .minus(totalSalidas)
        .toFixed(4),
      totalMovimientos: row?.total_movimientos ?? 0,
    };
  }

  async listarMovimientos(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    query: QueryMovimientosCajaDto,
    tieneVerTodas = false,
  ): Promise<PaginatedResponse<MovimientoCajaListItem>> {
    await this.verificarAccesoCaja(tenantId, usuarioId, cajaId, tieneVerTodas);

    const { page, pageSize, offset } = resolvePagination(query);
    const { filters, params } = this.buildMovimientosFilters(cajaId, query);

    const countRows: { total: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total
       FROM movimientos_caja m
       WHERE m.caja_id = $1
         AND m.eliminado_el IS NULL
         ${filters}`,
      params,
    );

    const total = countRows[0]?.total ?? 0;

    const listParams = [...params, pageSize, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows: {
      movimiento_id: string;
      caja_id: string;
      tipo: string;
      concepto: string;
      monto: string;
      referencia: string | null;
      fecha: Date;
      venta_id: string | null;
    }[] = await this.dataSource.query(
      `SELECT m.movimiento_id,
              m.caja_id,
              m.tipo,
              m.concepto,
              m.monto,
              m.referencia,
              m.fecha,
              m.venta_id
       FROM movimientos_caja m
       WHERE m.caja_id = $1
         AND m.eliminado_el IS NULL
         ${filters}
       ORDER BY m.fecha ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );

    return {
      data: rows.map((r) => ({
        id: r.movimiento_id,
        cajaId: r.caja_id,
        tipo: r.tipo,
        concepto: r.concepto,
        monto: new Decimal(r.monto).toFixed(4),
        referencia: r.referencia,
        fecha: r.fecha,
        ventaId: r.venta_id,
      })),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  private async verificarAccesoCaja(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    tieneVerTodas: boolean,
  ): Promise<Caja> {
    const caja = await this.cajaRepo.findOne({
      where: { id: cajaId, tenantId, eliminadoEl: IsNull() },
    });

    if (!caja) {
      throw new NotFoundException('Caja no encontrada');
    }

    if (caja.usuarioId !== usuarioId && !tieneVerTodas) {
      throw new ForbiddenException('No tienes acceso a esta caja');
    }

    return caja;
  }

  private buildMovimientosFilters(
    cajaId: string,
    query: QueryMovimientosCajaDto,
  ): { filters: string; params: unknown[] } {
    const params: unknown[] = [cajaId];
    let paramIdx = 2;
    let filters = '';

    if (query.tipo) {
      filters += ` AND m.tipo = $${paramIdx++}`;
      params.push(query.tipo);
    }

    return { filters, params };
  }
}
