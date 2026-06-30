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

  async listarMovimientos(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    tieneVerTodas = false,
  ): Promise<MovimientoCaja[]> {
    const caja = await this.cajaRepo.findOne({
      where: { id: cajaId, tenantId, eliminadoEl: IsNull() },
    });

    if (!caja) {
      throw new NotFoundException('Caja no encontrada');
    }

    if (caja.usuarioId !== usuarioId && !tieneVerTodas) {
      throw new ForbiddenException('No tienes acceso a esta caja');
    }

    return this.movimientoCajaRepo.find({
      where: { cajaId, eliminadoEl: IsNull() },
      order: { fecha: 'ASC' },
    });
  }
}
