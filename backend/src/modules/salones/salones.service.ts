import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { Salon } from './entities/salon.entity';
import { Mesa, FormaMesa, TamanoMesa } from './entities/mesa.entity';
import { Cuenta, EstadoCuenta } from './entities/cuenta.entity';
import { CuentaLinea } from './entities/cuenta-linea.entity';
import { CreateSalonDto } from './dto/create-salon.dto';
import { UpdateSalonDto } from './dto/update-salon.dto';
import { CreateMesaDto } from './dto/create-mesa.dto';
import { UpdateMesaDto } from './dto/update-mesa.dto';
import { UpdateLayoutDto } from './dto/update-layout.dto';
import { CreateCuentaDto } from './dto/create-cuenta.dto';
import { AddLineaDto } from './dto/add-linea.dto';
import { UpdateLineaDto } from './dto/update-linea.dto';
import { CerrarCuentaDto } from './dto/cerrar-cuenta.dto';
import { FusionarCuentasDto } from './dto/fusionar-cuentas.dto';
import { VentasService } from '../ventas/ventas.service';
import type { CreateVentaDto } from '../ventas/dto/create-venta.dto';

export interface MesaResumen {
  id: string;
  nombre: string;
  posX: string;
  posY: string;
  forma: FormaMesa;
  tamano: TamanoMesa;
  cuentasAbiertas: number;
  ocupada: boolean;
}

export interface SalonConMesas {
  id: string;
  nombre: string;
  mesas: MesaResumen[];
}

export interface CuentaLineaDetalle {
  id: string;
  itemId: string;
  nombre: string;
  precioBase: string;
  monedaId: string;
  cantidad: string;
}

export interface CuentaDetalle {
  id: string;
  numero: number;
  nombre: string | null;
  estado: EstadoCuenta;
  mesaId: string;
  ventaId: string | null;
  lineas: CuentaLineaDetalle[];
}

@Injectable()
export class SalonesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Salon) private readonly salonRepo: Repository<Salon>,
    @InjectRepository(Mesa) private readonly mesaRepo: Repository<Mesa>,
    @InjectRepository(Cuenta) private readonly cuentaRepo: Repository<Cuenta>,
    @InjectRepository(CuentaLinea)
    private readonly cuentaLineaRepo: Repository<CuentaLinea>,
    private readonly ventasService: VentasService,
  ) {}

  // ── Administración: salones ──────────────────────────────────────────────

  /** Salones del tenant con sus mesas (para la vista de administración). */
  async listarSalones(tenantId: string): Promise<SalonConMesas[]> {
    const rows: {
      salon_id: string;
      salon_nombre: string;
      mesa_id: string | null;
      mesa_nombre: string | null;
      pos_x: string | null;
      pos_y: string | null;
      forma: string | null;
      tamano: string | null;
      cuentas_abiertas: string;
    }[] = await this.dataSource.query(
      `SELECT s.salon_id, s.nombre AS salon_nombre,
              m.mesa_id, m.nombre AS mesa_nombre, m.pos_x, m.pos_y,
              m.forma, m.tamano,
              COALESCE(c.abiertas, 0) AS cuentas_abiertas
         FROM salones s
         LEFT JOIN mesas m
           ON m.salon_id = s.salon_id AND m.eliminado_el IS NULL
         LEFT JOIN (
           SELECT mesa_id, COUNT(*) AS abiertas
             FROM cuentas
            WHERE tenant_id = $1 AND estado = 'abierta' AND eliminado_el IS NULL
            GROUP BY mesa_id
         ) c ON c.mesa_id = m.mesa_id
        WHERE s.tenant_id = $1 AND s.eliminado_el IS NULL
        ORDER BY s.nombre ASC, m.nombre ASC`,
      [tenantId],
    );
    return this.agruparSalones(rows);
  }

  /** Igual que listarSalones — la operación del garzón usa la misma foto. */
  listarSalonesOperacion(tenantId: string): Promise<SalonConMesas[]> {
    return this.listarSalones(tenantId);
  }

  private agruparSalones(
    rows: {
      salon_id: string;
      salon_nombre: string;
      mesa_id: string | null;
      mesa_nombre: string | null;
      pos_x: string | null;
      pos_y: string | null;
      forma: string | null;
      tamano: string | null;
      cuentas_abiertas: string;
    }[],
  ): SalonConMesas[] {
    const map = new Map<string, SalonConMesas>();
    for (const r of rows) {
      let salon = map.get(r.salon_id);
      if (!salon) {
        salon = { id: r.salon_id, nombre: r.salon_nombre, mesas: [] };
        map.set(r.salon_id, salon);
      }
      if (r.mesa_id) {
        const abiertas = Number(r.cuentas_abiertas);
        salon.mesas.push({
          id: r.mesa_id,
          nombre: r.mesa_nombre ?? '',
          posX: r.pos_x ?? '0',
          posY: r.pos_y ?? '0',
          forma: (r.forma as FormaMesa) ?? FormaMesa.CUADRADA,
          tamano: (r.tamano as TamanoMesa) ?? TamanoMesa.MEDIANO,
          cuentasAbiertas: abiertas,
          ocupada: abiertas > 0,
        });
      }
    }
    return [...map.values()];
  }

  crearSalon(tenantId: string, dto: CreateSalonDto): Promise<Salon> {
    const salon = this.salonRepo.create({ tenantId, nombre: dto.nombre });
    return this.salonRepo.save(salon);
  }

  async actualizarSalon(
    tenantId: string,
    id: string,
    dto: UpdateSalonDto,
  ): Promise<Salon> {
    const salon = await this.salonRepo.findOne({ where: { id, tenantId } });
    if (!salon) throw new NotFoundException(`Salón ${id} no encontrado`);
    Object.assign(salon, dto);
    return this.salonRepo.save(salon);
  }

  async eliminarSalon(tenantId: string, id: string): Promise<void> {
    const salon = await this.salonRepo.findOne({ where: { id, tenantId } });
    if (!salon) throw new NotFoundException(`Salón ${id} no encontrado`);
    const abiertas = await this.cuentaRepo
      .createQueryBuilder('c')
      .innerJoin(Mesa, 'm', 'm.mesa_id = c.mesa_id')
      .where('m.salon_id = :id', { id })
      .andWhere('c.estado = :estado', { estado: EstadoCuenta.ABIERTA })
      .getCount();
    if (abiertas > 0) {
      throw new BadRequestException(
        'No se puede eliminar un salón con cuentas abiertas',
      );
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(Mesa, { salonId: id, tenantId });
      await manager.softDelete(Salon, { id, tenantId });
    });
  }

  // ── Administración: mesas ────────────────────────────────────────────────

  async crearMesa(
    tenantId: string,
    salonId: string,
    dto: CreateMesaDto,
  ): Promise<Mesa> {
    await this.getSalonOrThrow(tenantId, salonId);
    const mesa = this.mesaRepo.create({
      tenantId,
      salonId,
      nombre: dto.nombre,
      posX: (dto.posX ?? 0).toString(),
      posY: (dto.posY ?? 0).toString(),
      forma: dto.forma ?? FormaMesa.CUADRADA,
      tamano: dto.tamano ?? TamanoMesa.MEDIANO,
    });
    return this.mesaRepo.save(mesa);
  }

  async actualizarMesa(
    tenantId: string,
    id: string,
    dto: UpdateMesaDto,
  ): Promise<Mesa> {
    const mesa = await this.mesaRepo.findOne({ where: { id, tenantId } });
    if (!mesa) throw new NotFoundException(`Mesa ${id} no encontrada`);
    if (dto.nombre !== undefined) mesa.nombre = dto.nombre;
    if (dto.posX !== undefined) mesa.posX = dto.posX.toString();
    if (dto.posY !== undefined) mesa.posY = dto.posY.toString();
    if (dto.forma !== undefined) mesa.forma = dto.forma;
    if (dto.tamano !== undefined) mesa.tamano = dto.tamano;
    return this.mesaRepo.save(mesa);
  }

  async eliminarMesa(tenantId: string, id: string): Promise<void> {
    const mesa = await this.mesaRepo.findOne({ where: { id, tenantId } });
    if (!mesa) throw new NotFoundException(`Mesa ${id} no encontrada`);
    const abiertas = await this.cuentaRepo.count({
      where: { mesaId: id, tenantId, estado: EstadoCuenta.ABIERTA },
    });
    if (abiertas > 0) {
      throw new BadRequestException(
        'No se puede eliminar una mesa con cuentas abiertas',
      );
    }
    await this.mesaRepo.softDelete({ id, tenantId });
  }

  /** Persiste las posiciones (drag & drop) de varias mesas de un salón. */
  async guardarLayout(
    tenantId: string,
    salonId: string,
    dto: UpdateLayoutDto,
  ): Promise<SalonConMesas[]> {
    await this.getSalonOrThrow(tenantId, salonId);
    await this.dataSource.transaction(async (manager) => {
      for (const m of dto.mesas) {
        const res = await manager.update(
          Mesa,
          { id: m.mesaId, tenantId, salonId },
          { posX: m.posX.toString(), posY: m.posY.toString() },
        );
        if (!res.affected) {
          throw new NotFoundException(`Mesa ${m.mesaId} no pertenece al salón`);
        }
      }
    });
    return this.listarSalones(tenantId);
  }

  // ── Operación: cuentas ───────────────────────────────────────────────────

  /** Cuentas ABIERTAS de una mesa, con sus líneas y datos del ítem. */
  async listarCuentasDeMesa(
    tenantId: string,
    mesaId: string,
  ): Promise<CuentaDetalle[]> {
    await this.getMesaOrThrow(tenantId, mesaId);
    const cuentas = await this.cuentaRepo.find({
      where: { tenantId, mesaId, estado: EstadoCuenta.ABIERTA },
      order: { numero: 'ASC' },
    });
    return Promise.all(cuentas.map((c) => this.armarDetalle(tenantId, c)));
  }

  async abrirCuenta(
    tenantId: string,
    mesaId: string,
    dto: CreateCuentaDto,
  ): Promise<CuentaDetalle> {
    await this.getMesaOrThrow(tenantId, mesaId);
    const cuenta = await this.dataSource.transaction(async (manager) => {
      // Numeración por mesa, basada solo en las cuentas actualmente abiertas:
      // se reinicia en 1 cada vez que la mesa queda completamente libre (todas
      // sus cuentas cerradas/canceladas), en vez de ser un correlativo histórico.
      const row: { next: string }[] = await manager.query(
        `SELECT COALESCE(MAX(numero), 0) + 1 AS next
           FROM cuentas WHERE tenant_id = $1 AND mesa_id = $2 AND estado = $3`,
        [tenantId, mesaId, EstadoCuenta.ABIERTA],
      );
      const numero = Number(row[0].next);
      return manager.save(
        Cuenta,
        manager.create(Cuenta, {
          tenantId,
          mesaId,
          numero,
          nombre: dto.nombre ?? null,
          estado: EstadoCuenta.ABIERTA,
        }),
      );
    });
    return this.armarDetalle(tenantId, cuenta);
  }

  async agregarLinea(
    tenantId: string,
    cuentaId: string,
    dto: AddLineaDto,
  ): Promise<CuentaDetalle> {
    const cuenta = await this.getCuentaAbiertaOrThrow(tenantId, cuentaId);
    await this.getItemVendibleOrThrow(tenantId, dto.itemId);
    if (new Decimal(dto.cantidad).lte(0)) {
      throw new BadRequestException('La cantidad debe ser mayor a cero');
    }
    // Merge por ítem: si ya hay una línea del mismo ítem, suma la cantidad.
    const existente = await this.cuentaLineaRepo.findOne({
      where: { tenantId, cuentaId, itemId: dto.itemId },
    });
    if (existente) {
      existente.cantidad = new Decimal(existente.cantidad)
        .plus(dto.cantidad)
        .toString();
      await this.cuentaLineaRepo.save(existente);
    } else {
      await this.cuentaLineaRepo.save(
        this.cuentaLineaRepo.create({
          tenantId,
          cuentaId,
          itemId: dto.itemId,
          cantidad: dto.cantidad,
        }),
      );
    }
    return this.armarDetalle(tenantId, cuenta);
  }

  async actualizarLinea(
    tenantId: string,
    cuentaId: string,
    lineaId: string,
    dto: UpdateLineaDto,
  ): Promise<CuentaDetalle> {
    const cuenta = await this.getCuentaAbiertaOrThrow(tenantId, cuentaId);
    if (new Decimal(dto.cantidad).lte(0)) {
      throw new BadRequestException('La cantidad debe ser mayor a cero');
    }
    const linea = await this.cuentaLineaRepo.findOne({
      where: { id: lineaId, tenantId, cuentaId },
    });
    if (!linea) throw new NotFoundException(`Línea ${lineaId} no encontrada`);
    linea.cantidad = dto.cantidad;
    await this.cuentaLineaRepo.save(linea);
    return this.armarDetalle(tenantId, cuenta);
  }

  async quitarLinea(
    tenantId: string,
    cuentaId: string,
    lineaId: string,
  ): Promise<CuentaDetalle> {
    const cuenta = await this.getCuentaAbiertaOrThrow(tenantId, cuentaId);
    const res = await this.cuentaLineaRepo.softDelete({
      id: lineaId,
      tenantId,
      cuentaId,
    });
    if (!res.affected) {
      throw new NotFoundException(`Línea ${lineaId} no encontrada`);
    }
    return this.armarDetalle(tenantId, cuenta);
  }

  async cancelarCuenta(
    tenantId: string,
    cuentaId: string,
  ): Promise<CuentaDetalle> {
    const cuenta = await this.getCuentaAbiertaOrThrow(tenantId, cuentaId);
    cuenta.estado = EstadoCuenta.CANCELADA;
    await this.cuentaRepo.save(cuenta);
    return this.armarDetalle(tenantId, cuenta);
  }

  /**
   * Fusiona varias cuentas abiertas de una misma mesa en una sola (ej: "1 y 3",
   * o todas). Las líneas de las cuentas de origen se mueven a la de destino
   * (la de menor `numero`), mergeando por ítem igual que agregarLinea; las
   * cuentas de origen quedan `cancelada` (sin venta, absorbidas por el destino).
   */
  async fusionarCuentas(
    tenantId: string,
    mesaId: string,
    dto: FusionarCuentasDto,
  ): Promise<CuentaDetalle> {
    await this.getMesaOrThrow(tenantId, mesaId);
    const ids = [...new Set(dto.cuentaIds)];
    if (ids.length < 2) {
      throw new BadRequestException(
        'Selecciona al menos dos cuentas para fusionar',
      );
    }
    return this.dataSource.transaction(async (manager) => {
      const cuentas = await manager.find(Cuenta, {
        where: { id: In(ids), tenantId, mesaId, estado: EstadoCuenta.ABIERTA },
      });
      if (cuentas.length !== ids.length) {
        throw new BadRequestException(
          'Todas las cuentas a fusionar deben pertenecer a la mesa y estar abiertas',
        );
      }
      cuentas.sort((a, b) => a.numero - b.numero);
      const [destino, ...origenes] = cuentas;

      for (const origen of origenes) {
        const lineas = await manager.find(CuentaLinea, {
          where: { tenantId, cuentaId: origen.id },
        });
        for (const linea of lineas) {
          const existente = await manager.findOne(CuentaLinea, {
            where: { tenantId, cuentaId: destino.id, itemId: linea.itemId },
          });
          if (existente) {
            existente.cantidad = new Decimal(existente.cantidad)
              .plus(linea.cantidad)
              .toString();
            await manager.save(CuentaLinea, existente);
            await manager.softDelete(CuentaLinea, {
              id: linea.id,
              tenantId,
            });
          } else {
            linea.cuentaId = destino.id;
            await manager.save(CuentaLinea, linea);
          }
        }
        origen.estado = EstadoCuenta.CANCELADA;
        await manager.save(Cuenta, origen);
      }

      return this.armarDetalle(tenantId, destino, manager);
    });
  }

  /**
   * Cierra la cuenta generando la venta real (canal físico → requiere caja
   * abierta). Venta + cierre de cuenta ocurren en una sola transacción vía
   * VentasService.crearEnTransaccion, para que ambos commiteen juntos.
   */
  async cerrarCuenta(
    tenantId: string,
    usuarioId: string,
    cuentaId: string,
    dto: CerrarCuentaDto,
  ): Promise<{ cuenta: CuentaDetalle; ventaId: string }> {
    return this.dataSource.transaction(async (manager) => {
      const cuenta = await manager.findOne(Cuenta, {
        where: { id: cuentaId, tenantId },
      });
      if (!cuenta)
        throw new NotFoundException(`Cuenta ${cuentaId} no encontrada`);
      if (cuenta.estado !== EstadoCuenta.ABIERTA) {
        throw new BadRequestException('La cuenta no está abierta');
      }
      const lineas = await manager.find(CuentaLinea, {
        where: { tenantId, cuentaId },
      });
      if (lineas.length === 0) {
        throw new BadRequestException('La cuenta no tiene productos');
      }

      const ventaDto: CreateVentaDto = {
        lineas: lineas.map((l) => ({ itemId: l.itemId, cantidad: l.cantidad })),
        pagos: dto.pagos,
        tipoDocumentoId: dto.tipoDocumentoId,
        customer: dto.customer,
        canal: 'fisico',
      };
      const venta = await this.ventasService.crearEnTransaccion(
        manager,
        tenantId,
        usuarioId,
        ventaDto,
      );

      cuenta.estado = EstadoCuenta.CERRADA;
      cuenta.ventaId = venta.id;
      cuenta.cerradaEl = new Date();
      await manager.save(Cuenta, cuenta);

      const detalle = await this.armarDetalle(tenantId, cuenta, manager);
      return { cuenta: detalle, ventaId: venta.id };
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async armarDetalle(
    tenantId: string,
    cuenta: Cuenta,
    manager?: DataSource['manager'],
  ): Promise<CuentaDetalle> {
    const runner = manager ?? this.dataSource.manager;
    const lineas: {
      cuenta_linea_id: string;
      item_id: string;
      cantidad: string;
      nombre: string;
      precio_base: string;
      moneda_id: string;
    }[] = await runner.query(
      `SELECT cl.cuenta_linea_id, cl.item_id, cl.cantidad,
              i.nombre, i.precio_base, i.moneda_id
         FROM cuenta_lineas cl
         JOIN items i ON i.item_id = cl.item_id AND i.eliminado_el IS NULL
        WHERE cl.cuenta_id = $1 AND cl.tenant_id = $2 AND cl.eliminado_el IS NULL
        ORDER BY cl.creado_el ASC`,
      [cuenta.id, tenantId],
    );
    return {
      id: cuenta.id,
      numero: cuenta.numero,
      nombre: cuenta.nombre,
      estado: cuenta.estado,
      mesaId: cuenta.mesaId,
      ventaId: cuenta.ventaId,
      lineas: lineas.map((l) => ({
        id: l.cuenta_linea_id,
        itemId: l.item_id,
        nombre: l.nombre,
        precioBase: l.precio_base,
        monedaId: l.moneda_id,
        cantidad: l.cantidad,
      })),
    };
  }

  private async getSalonOrThrow(tenantId: string, id: string): Promise<Salon> {
    const salon = await this.salonRepo.findOne({ where: { id, tenantId } });
    if (!salon) throw new NotFoundException(`Salón ${id} no encontrado`);
    return salon;
  }

  private async getMesaOrThrow(tenantId: string, id: string): Promise<Mesa> {
    const mesa = await this.mesaRepo.findOne({ where: { id, tenantId } });
    if (!mesa) throw new NotFoundException(`Mesa ${id} no encontrada`);
    return mesa;
  }

  private async getCuentaAbiertaOrThrow(
    tenantId: string,
    id: string,
  ): Promise<Cuenta> {
    const cuenta = await this.cuentaRepo.findOne({ where: { id, tenantId } });
    if (!cuenta) throw new NotFoundException(`Cuenta ${id} no encontrada`);
    if (cuenta.estado !== EstadoCuenta.ABIERTA) {
      throw new BadRequestException('La cuenta no está abierta');
    }
    return cuenta;
  }

  private async getItemVendibleOrThrow(
    tenantId: string,
    itemId: string,
  ): Promise<void> {
    const rows: { item_id: string }[] = await this.dataSource.query(
      `SELECT item_id FROM items
        WHERE item_id = $1 AND tenant_id = $2
          AND activo = true AND eliminado_el IS NULL`,
      [itemId, tenantId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Ítem ${itemId} no encontrado`);
    }
  }
}
