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
import { ConfirmarComandaDto } from './dto/confirmar-comanda.dto';
import { VentasService } from '../ventas/ventas.service';
import type { CreateVentaDto } from '../ventas/dto/create-venta.dto';
import { EstrategiaAsignacionPropina } from '../propinas/enums/estrategia-asignacion-propina.enum';
import { GarzonesService } from '../garzones/garzones.service';
import { ItemsService } from '../items/items.service';
import { CatalogService } from '../catalog/catalog.service';
import { SesionesGarzonService } from '../turnos/sesiones-garzon.service';
import { CuentaAsignacionesService } from './cuenta-asignaciones.service';
import type { CuentaAsignacionDetalle } from './cuenta-asignaciones.service';
import {
  assertPresentacionPareada,
  resolverCantidadDesdePresentacion,
  type UnidadCat,
} from '../../common/utils/cantidad-presentacion.util';
import type { PersonalizacionRecetaSnapshot } from '../../common/dto/personalizacion-receta.dto';
import {
  detallePersonalizacion,
  hashPersonalizacion,
  textoComandaPersonalizacion,
  type PersonalizacionDetalleLinea,
} from '../../common/utils/personalizacion-receta.util';

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
  cantidadPresentacion?: string | null;
  unidadCodigoPresentacion?: string | null;
  personalizacion?: PersonalizacionRecetaSnapshot | null;
  personalizacionTexto?: string;
  personalizacionDetalle?: PersonalizacionDetalleLinea[];
}

export interface ComandaEstacion {
  impresoraId: string;
  nombre: string;
  items: {
    cuentaLineaId: string;
    nombre: string;
    cantidad: string;
    cantidadEnviada: string;
    nota?: string;
  }[];
}

export interface CuentaDetalle {
  id: string;
  numero: number;
  nombre: string | null;
  estado: EstadoCuenta;
  mesaId: string;
  ventaId: string | null;
  garzonAperturaId: string | null;
  garzonAperturaNombre: string | null;
  garzonResponsableId: string | null;
  garzonResponsableNombre: string | null;
  garzonCierreId: string | null;
  garzonCierreNombre: string | null;
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
    private readonly garzonesService: GarzonesService,
    private readonly sesionesGarzonService: SesionesGarzonService,
    private readonly cuentaAsignacionesService: CuentaAsignacionesService,
    private readonly itemsService: ItemsService,
    private readonly catalogService: CatalogService,
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
  ): Promise<void> {
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
    // Identifica al garzón responsable por su PIN (lanza 400 si es inválido).
    const garzon = await this.garzonesService.resolverGarzonPorPin(
      tenantId,
      dto.pin,
    );
    await this.sesionesGarzonService.assertSesionAbierta(tenantId, garzon.id);
    const cuenta = await this.dataSource.transaction(async (manager) => {
      // Ancla de serialización por mesa: sin este lock, dos aperturas concurrentes
      // pueden calcular el mismo MAX(numero)+1.
      const locked: { mesa_id: string }[] = await manager.query(
        `SELECT mesa_id FROM mesas
          WHERE mesa_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
          FOR UPDATE`,
        [mesaId, tenantId],
      );
      if (!locked.length) {
        throw new NotFoundException(`Mesa ${mesaId} no encontrada`);
      }

      // Numeración por mesa, basada solo en las cuentas actualmente abiertas:
      // se reinicia en 1 cada vez que la mesa queda completamente libre (todas
      // sus cuentas cerradas/canceladas), en vez de ser un correlativo histórico.
      const row: { next: string }[] = await manager.query(
        `SELECT COALESCE(MAX(numero), 0) + 1 AS next
           FROM cuentas WHERE tenant_id = $1 AND mesa_id = $2 AND estado = $3`,
        [tenantId, mesaId, EstadoCuenta.ABIERTA],
      );
      const numero = Number(row[0].next);
      const creada = await manager.save(
        Cuenta,
        manager.create(Cuenta, {
          tenantId,
          mesaId,
          numero,
          nombre: dto.nombre ?? null,
          estado: EstadoCuenta.ABIERTA,
          garzonAperturaId: garzon.id,
          garzonResponsableId: garzon.id,
        }),
      );
      await this.cuentaAsignacionesService.registrarApertura(
        manager,
        creada,
        garzon.id,
      );
      return creada;
    });
    return this.armarDetalle(tenantId, cuenta);
  }

  async agregarLinea(
    tenantId: string,
    cuentaId: string,
    dto: AddLineaDto,
  ): Promise<CuentaDetalle> {
    const cuenta = await this.getCuentaAbiertaOrThrow(tenantId, cuentaId);
    const item = await this.getItemVendibleOrThrow(tenantId, dto.itemId);
    const catalogo = await this.loadCatalogoUnidades();
    const resuelta = this.resolverCantidadLinea({
      cantidad: dto.cantidad,
      cantidadPresentacion: dto.cantidadPresentacion,
      unidadCodigoPresentacion: dto.unidadCodigoPresentacion,
      item,
      catalogo,
    });
    if (new Decimal(resuelta.cantidadCanonica).lte(0)) {
      throw new BadRequestException('La cantidad debe ser mayor a cero');
    }

    let snapshot: PersonalizacionRecetaSnapshot | null = null;
    if (dto.personalizacion) {
      if (item.tipo !== 'receta' && item.tipo !== 'combo') {
        throw new BadRequestException(
          'La personalización solo aplica a recetas y combos',
        );
      }
      const resolved =
        item.tipo === 'combo'
          ? await this.itemsService.resolverPersonalizacionCombo(
              this.dataSource.manager,
              tenantId,
              dto.itemId,
              dto.personalizacion,
            )
          : await this.itemsService.resolverPersonalizacionReceta(
              this.dataSource.manager,
              tenantId,
              dto.itemId,
              dto.personalizacion,
            );
      snapshot = resolved.snapshot;
    }

    const hash = hashPersonalizacion(snapshot);
    const existentes = await this.cuentaLineaRepo.find({
      where: { tenantId, cuentaId, itemId: dto.itemId },
    });
    const match = existentes.find(
      (l) => hashPersonalizacion(l.personalizacion) === hash,
    );
    if (match) {
      match.cantidad = new Decimal(match.cantidad)
        .plus(resuelta.cantidadCanonica)
        .toString();
      await this.cuentaLineaRepo.save(match);
    } else {
      await this.cuentaLineaRepo.save(
        this.cuentaLineaRepo.create({
          tenantId,
          cuentaId,
          itemId: dto.itemId,
          cantidad: resuelta.cantidadCanonica,
          cantidadPresentacion: resuelta.cantidadPresentacion,
          unidadCodigoPresentacion: resuelta.unidadCodigoPresentacion,
          personalizacion: snapshot,
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
    const linea = await this.cuentaLineaRepo.findOne({
      where: { id: lineaId, tenantId, cuentaId },
    });
    if (!linea) throw new NotFoundException(`Línea ${lineaId} no encontrada`);

    const item = await this.getItemVendibleOrThrow(tenantId, linea.itemId);
    const catalogo = await this.loadCatalogoUnidades();
    const resuelta = this.resolverCantidadLinea({
      cantidad: dto.cantidad,
      cantidadPresentacion: dto.cantidadPresentacion,
      unidadCodigoPresentacion: dto.unidadCodigoPresentacion,
      item,
      catalogo,
      syncPresentacionLegado: true,
    });
    if (new Decimal(resuelta.cantidadCanonica).lte(0)) {
      throw new BadRequestException('La cantidad debe ser mayor a cero');
    }

    linea.cantidad = resuelta.cantidadCanonica;
    linea.cantidadPresentacion = resuelta.cantidadPresentacion;
    linea.unidadCodigoPresentacion = resuelta.unidadCodigoPresentacion;
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
    return this.dataSource.transaction(async (manager) => {
      const cuenta = await manager.findOne(Cuenta, {
        where: { id: cuentaId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!cuenta) {
        throw new NotFoundException(`Cuenta ${cuentaId} no encontrada`);
      }
      if (cuenta.estado !== EstadoCuenta.ABIERTA) {
        throw new BadRequestException('La cuenta no está abierta');
      }
      cuenta.estado = EstadoCuenta.CANCELADA;
      cuenta.cerradaEl = new Date();
      await this.cuentaAsignacionesService.cerrarTramoVigente(
        manager,
        tenantId,
        cuenta.id,
        cuenta.cerradaEl,
      );
      await manager.save(Cuenta, cuenta);
      return this.armarDetalle(tenantId, cuenta, manager);
    });
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
      // Lock pesimista sobre todas las cuentas: serializa fusión↔transferencia
      // y doble fusión concurrente antes de validar/mover líneas/cancelar.
      const cuentas = await manager.find(Cuenta, {
        where: { id: In(ids), tenantId, mesaId, estado: EstadoCuenta.ABIERTA },
        lock: { mode: 'pessimistic_write' },
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
          const existentes = await manager.find(CuentaLinea, {
            where: { tenantId, cuentaId: destino.id, itemId: linea.itemId },
          });
          const hashOrigen = hashPersonalizacion(linea.personalizacion);
          const existente = existentes.find(
            (l) => hashPersonalizacion(l.personalizacion) === hashOrigen,
          );
          if (existente) {
            existente.cantidad = new Decimal(existente.cantidad)
              .plus(linea.cantidad)
              .toString();
            existente.cantidadEnviada = new Decimal(existente.cantidadEnviada)
              .plus(linea.cantidadEnviada)
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
        origen.cerradaEl = new Date();
        await this.cuentaAsignacionesService.cerrarTramoVigente(
          manager,
          tenantId,
          origen.id,
          origen.cerradaEl,
        );
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
    // Identifica al garzón que cierra la cuenta por su PIN (400 si inválido).
    const garzon = await this.garzonesService.resolverGarzonPorPin(
      tenantId,
      dto.pin,
    );
    await this.sesionesGarzonService.assertSesionAbierta(tenantId, garzon.id);
    return this.dataSource.transaction(async (manager) => {
      // Lock pesimista: evita doble cierre / doble venta concurrente.
      const cuenta = await manager.findOne(Cuenta, {
        where: { id: cuentaId, tenantId },
        lock: { mode: 'pessimistic_write' },
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
      if (!cuenta.garzonResponsableId) {
        throw new BadRequestException(
          'La cuenta no tiene garzón responsable asignado',
        );
      }

      const sesionResponsable =
        await this.sesionesGarzonService.obtenerSesionAbierta(
          tenantId,
          cuenta.garzonResponsableId,
        );

      const propinaMonto = dto.propinaMonto ?? '0';
      if (new Decimal(propinaMonto).lt(0)) {
        throw new BadRequestException('Propina inválida');
      }

      const ventaDto: CreateVentaDto = {
        lineas: lineas.map((l) => ({
          itemId: l.itemId,
          cantidad: l.cantidad,
          ...(l.cantidadPresentacion && l.unidadCodigoPresentacion
            ? {
                cantidadPresentacion: l.cantidadPresentacion,
                unidadCodigoPresentacion: l.unidadCodigoPresentacion,
              }
            : {}),
          personalizacion: l.personalizacion
            ? {
                omitidos: l.personalizacion.omitidos,
                extras: l.personalizacion.extras.map((e) => ({
                  ingredienteItemId: e.ingredienteItemId,
                  ...(e.unidades ? { unidades: Number(e.unidades) } : {}),
                })),
                comentario: l.personalizacion.comentario,
                ...(l.personalizacion.grupos?.length
                  ? {
                      grupos: l.personalizacion.grupos.map((g) => ({
                        grupoId: g.grupoId,
                        opciones: g.opciones.map((o) => ({
                          itemId: o.itemId,
                          unidades: Number(o.unidades),
                        })),
                      })),
                    }
                  : {}),
              }
            : undefined,
        })),
        pagos: dto.pagos,
        tipoDocumentoId: dto.tipoDocumentoId,
        customer: dto.customer,
        canal: 'fisico',
        propinaCierreMesa: {
          montoPagado: propinaMonto,
          montoSugerido: dto.propinaSugerida ?? propinaMonto,
          porcentajeSugerido: dto.propinaPorcentajeSugerido ?? '0.10',
          garzonId: cuenta.garzonResponsableId,
          sesionGarzonId: sesionResponsable.id,
          turnoId: sesionResponsable.turnoId,
          tipoGarzon: sesionResponsable.tipoGarzon,
          estrategia: EstrategiaAsignacionPropina.NO_VUELTO,
        },
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
      cuenta.garzonCierreId = garzon.id;
      await this.cuentaAsignacionesService.cerrarTramoVigente(
        manager,
        tenantId,
        cuenta.id,
        cuenta.cerradaEl,
      );
      await manager.save(Cuenta, cuenta);

      const detalle = await this.armarDetalle(tenantId, cuenta, manager);
      return { cuenta: detalle, ventaId: venta.id };
    });
  }

  /**
   * Calcula el diff (cantidad - cantidad_enviada) de cada línea, agrupado por la
   * impresora de la categoría del ítem. NO persiste: vista previa de solo lectura.
   */
  async previewComanda(
    tenantId: string,
    cuentaId: string,
  ): Promise<{ estaciones: ComandaEstacion[] }> {
    const cuenta = await this.cuentaRepo.findOne({
      where: { id: cuentaId, tenantId },
    });
    if (!cuenta) {
      throw new NotFoundException(`Cuenta ${cuentaId} no encontrada`);
    }
    if (cuenta.estado !== EstadoCuenta.ABIERTA) {
      throw new BadRequestException('La cuenta no está abierta');
    }

    const rows = await this.dataSource.query(
      this.sqlLineasComanda(),
      [cuentaId, tenantId],
    );
    const nombres = await this.nombresIngredientesPersonalizacion(
      tenantId,
      rows,
    );
    return { estaciones: this.agruparEstacionesComanda(rows, nombres) };
  }

  /**
   * Claim atómico: bajo FOR UPDATE calcula diffs, avanza cantidad_enviada y
   * devuelve lo a imprimir. Dos reclamaciones concurrentes no duplican cocina:
   * la segunda ve diffs vacíos. El FE imprime después del claim.
   */
  async reclamarComanda(
    tenantId: string,
    cuentaId: string,
  ): Promise<{ estaciones: ComandaEstacion[] }> {
    return this.dataSource.transaction(async (manager) => {
      const cuenta = await manager.findOne(Cuenta, {
        where: { id: cuentaId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!cuenta) {
        throw new NotFoundException(`Cuenta ${cuentaId} no encontrada`);
      }
      if (cuenta.estado !== EstadoCuenta.ABIERTA) {
        throw new BadRequestException('La cuenta no está abierta');
      }

      const rows: {
        cuenta_linea_id: string;
        cantidad: string;
        cantidad_enviada: string;
        nombre: string;
        impresora_id: string | null;
        impresora_nombre: string | null;
        personalizacion: PersonalizacionRecetaSnapshot | null;
      }[] = await manager.query(
        `${this.sqlLineasComanda()}
         FOR UPDATE OF cl`,
        [cuentaId, tenantId],
      );

      const nombres = await this.nombresIngredientesPersonalizacion(
        tenantId,
        rows,
      );
      const estaciones = this.agruparEstacionesComanda(rows, nombres);

      for (const estacion of estaciones) {
        for (const item of estacion.items) {
          await manager.query(
            `UPDATE cuenta_lineas
                SET cantidad_enviada = $1, actualizado_el = NOW()
              WHERE cuenta_linea_id = $2 AND tenant_id = $3`,
            [item.cantidadEnviada, item.cuentaLineaId, tenantId],
          );
        }
      }

      return { estaciones };
    });
  }

  private sqlLineasComanda(): string {
    return `SELECT cl.cuenta_linea_id, cl.cantidad, cl.cantidad_enviada,
              cl.personalizacion, i.nombre, imp.impresora_id, imp.nombre AS impresora_nombre
         FROM cuenta_lineas cl
         JOIN items i ON i.item_id = cl.item_id AND i.eliminado_el IS NULL
         LEFT JOIN categorias c
           ON c.categoria_id = i.categoria_id AND c.eliminado_el IS NULL
         LEFT JOIN impresoras imp
           ON imp.impresora_id = c.impresora_id AND imp.eliminado_el IS NULL
              AND imp.activo = true
        WHERE cl.cuenta_id = $1 AND cl.tenant_id = $2 AND cl.eliminado_el IS NULL`;
  }

  private agruparEstacionesComanda(
    rows: {
      cuenta_linea_id: string;
      cantidad: string;
      cantidad_enviada: string;
      nombre: string;
      impresora_id: string | null;
      impresora_nombre: string | null;
      personalizacion?: PersonalizacionRecetaSnapshot | null;
    }[],
    nombres: Map<string, string> = new Map(),
  ): ComandaEstacion[] {
    const estacionesMap = new Map<string, ComandaEstacion>();
    for (const row of rows) {
      const diff = new Decimal(row.cantidad).minus(row.cantidad_enviada);
      if (diff.lte(0) || !row.impresora_id) continue;

      const nota = textoComandaPersonalizacion(row.personalizacion, nombres);
      const estacion = estacionesMap.get(row.impresora_id) ?? {
        impresoraId: row.impresora_id,
        nombre: row.impresora_nombre ?? '',
        items: [],
      };
      estacion.items.push({
        cuentaLineaId: row.cuenta_linea_id,
        nombre: row.nombre,
        cantidad: diff.toString(),
        cantidadEnviada: row.cantidad,
        ...(nota ? { nota } : {}),
      });
      estacionesMap.set(row.impresora_id, estacion);
    }
    return [...estacionesMap.values()];
  }

  async transferirCuentaPorPin(
    tenantId: string,
    cuentaId: string,
    pin: string,
  ): Promise<CuentaDetalle> {
    const cuenta = await this.cuentaAsignacionesService.transferirPorPin(
      tenantId,
      cuentaId,
      pin,
    );
    return this.armarDetalle(tenantId, cuenta);
  }

  async transferirCuentaAdmin(
    tenantId: string,
    usuarioId: string,
    cuentaId: string,
    garzonId: string,
  ): Promise<CuentaDetalle> {
    const cuenta = await this.cuentaAsignacionesService.transferirAdmin(
      tenantId,
      usuarioId,
      cuentaId,
      garzonId,
    );
    return this.armarDetalle(tenantId, cuenta);
  }

  async listarAsignacionesCuenta(
    tenantId: string,
    cuentaId: string,
  ): Promise<CuentaAsignacionDetalle[]> {
    const cuenta = await this.cuentaRepo.findOne({
      where: { id: cuentaId, tenantId },
    });
    if (!cuenta) {
      throw new NotFoundException(`Cuenta ${cuentaId} no encontrada`);
    }
    return this.cuentaAsignacionesService.listar(tenantId, cuentaId);
  }

  /**
   * Marca cantidad_enviada = cantidadEnviada para las líneas (legado; el flujo
   * principal usa reclamarComanda). Idempotente ante reintentos.
   */
  async confirmarComanda(
    tenantId: string,
    cuentaId: string,
    dto: ConfirmarComandaDto,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const cuenta = await manager.findOne(Cuenta, {
        where: { id: cuentaId, tenantId },
      });
      if (!cuenta) {
        throw new NotFoundException(`Cuenta ${cuentaId} no encontrada`);
      }
      if (cuenta.estado !== EstadoCuenta.ABIERTA) {
        throw new BadRequestException('La cuenta no está abierta');
      }
      for (const linea of dto.lineas) {
        await manager.update(
          CuentaLinea,
          { id: linea.cuentaLineaId, tenantId },
          { cantidadEnviada: linea.cantidadEnviada },
        );
      }
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
      cantidad_presentacion: string | null;
      unidad_codigo_presentacion: string | null;
      nombre: string;
      precio_base: string;
      moneda_id: string;
      personalizacion: PersonalizacionRecetaSnapshot | null;
    }[] = await runner.query(
      `SELECT cl.cuenta_linea_id, cl.item_id, cl.cantidad,
              cl.cantidad_presentacion, cl.unidad_codigo_presentacion,
              cl.personalizacion,
              i.nombre, i.precio_base, i.moneda_id
         FROM cuenta_lineas cl
         JOIN items i ON i.item_id = cl.item_id AND i.eliminado_el IS NULL
        WHERE cl.cuenta_id = $1 AND cl.tenant_id = $2 AND cl.eliminado_el IS NULL
        ORDER BY cl.creado_el ASC`,
      [cuenta.id, tenantId],
    );
    const nombresGarzon = await this.nombresGarzon(
      runner,
      cuenta.garzonAperturaId,
      cuenta.garzonCierreId,
      cuenta.garzonResponsableId,
    );
    const nombres = await this.nombresIngredientesPersonalizacion(
      tenantId,
      lineas,
    );
    return {
      id: cuenta.id,
      numero: cuenta.numero,
      nombre: cuenta.nombre,
      estado: cuenta.estado,
      mesaId: cuenta.mesaId,
      ventaId: cuenta.ventaId,
      garzonAperturaId: cuenta.garzonAperturaId,
      garzonAperturaNombre: cuenta.garzonAperturaId
        ? (nombresGarzon[cuenta.garzonAperturaId] ?? null)
        : null,
      garzonResponsableId: cuenta.garzonResponsableId,
      garzonResponsableNombre: cuenta.garzonResponsableId
        ? (nombresGarzon[cuenta.garzonResponsableId] ?? null)
        : null,
      garzonCierreId: cuenta.garzonCierreId,
      garzonCierreNombre: cuenta.garzonCierreId
        ? (nombresGarzon[cuenta.garzonCierreId] ?? null)
        : null,
      lineas: lineas.map((l) => {
        const personalizacionTexto = textoComandaPersonalizacion(
          l.personalizacion,
          nombres,
        );
        const personalizacionDetalle = detallePersonalizacion(
          l.personalizacion,
          nombres,
        );
        return {
          id: l.cuenta_linea_id,
          itemId: l.item_id,
          nombre: l.nombre,
          precioBase: l.precio_base,
          monedaId: l.moneda_id,
          cantidad: l.cantidad,
          ...(l.cantidad_presentacion && l.unidad_codigo_presentacion
            ? {
                cantidadPresentacion: l.cantidad_presentacion,
                unidadCodigoPresentacion: l.unidad_codigo_presentacion,
              }
            : {}),
          personalizacion: l.personalizacion,
          ...(personalizacionTexto
            ? { personalizacionTexto }
            : {}),
          ...(personalizacionDetalle.length
            ? { personalizacionDetalle }
            : {}),
        };
      }),
    };
  }

  private async nombresIngredientesPersonalizacion(
    tenantId: string,
    rows: { personalizacion?: PersonalizacionRecetaSnapshot | null }[],
  ): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const row of rows) {
      const p = row.personalizacion;
      if (!p) continue;
      for (const id of p.omitidos ?? []) ids.add(id);
      for (const e of p.extras ?? []) ids.add(e.ingredienteItemId);
    }
    if (ids.size === 0) return new Map();
    const nameRows: { item_id: string; nombre: string }[] =
      await this.dataSource.query(
        `SELECT item_id, nombre FROM items
          WHERE item_id = ANY($1) AND tenant_id = $2 AND eliminado_el IS NULL`,
        [[...ids], tenantId],
      );
    return new Map(nameRows.map((r) => [r.item_id, r.nombre]));
  }

  /** Resuelve los nombres de los garzones de apertura/cierre en una query. */
  private async nombresGarzon(
    runner: DataSource['manager'],
    ...ids: (string | null)[]
  ): Promise<Record<string, string>> {
    const garzonIds = [...new Set(ids.filter((id): id is string => !!id))];
    if (garzonIds.length === 0) return {};
    // Sin filtro eliminado_el: el detalle histórico debe mostrar nombres
    // aunque el garzón haya sido soft-deleted después de la operación.
    const rows: { garzon_id: string; nombre: string }[] = await runner.query(
      `SELECT garzon_id, nombre FROM garzones
        WHERE garzon_id = ANY($1)`,
      [garzonIds],
    );
    return Object.fromEntries(rows.map((r) => [r.garzon_id, r.nombre]));
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

  private async loadCatalogoUnidades(): Promise<UnidadCat[]> {
    const unidades = await this.catalogService.findAllUnidadesMedida();
    return unidades.map((u) => ({
      codigo: u.codigo,
      magnitud: u.magnitud,
      factorBase: u.factorBase,
    }));
  }

  private resolverCantidadLinea(params: {
    cantidad: string;
    cantidadPresentacion?: string;
    unidadCodigoPresentacion?: string;
    item: { tipo: string; unidadMedida: string | null };
    catalogo: UnidadCat[];
    syncPresentacionLegado?: boolean;
  }): {
    cantidadCanonica: string;
    cantidadPresentacion: string | null;
    unidadCodigoPresentacion: string | null;
  } {
    const { cantidad, cantidadPresentacion, unidadCodigoPresentacion, item, catalogo } =
      params;
    assertPresentacionPareada(cantidadPresentacion, unidadCodigoPresentacion);

    const unidadBase =
      item.tipo === 'receta' ? 'unidad' : (item.unidadMedida ?? 'unidad');

    if (cantidadPresentacion && unidadCodigoPresentacion) {
      const res = resolverCantidadDesdePresentacion({
        cantidadPresentacion,
        unidadCodigoPresentacion,
        unidadBaseCodigo: unidadBase,
        catalogo,
        forzarConteo: item.tipo === 'receta',
      });
      return {
        cantidadCanonica: res.cantidadCanonica,
        cantidadPresentacion: res.cantidadPresentacion,
        unidadCodigoPresentacion: res.unidadCodigoPresentacion,
      };
    }

    if (params.syncPresentacionLegado) {
      return {
        cantidadCanonica: cantidad,
        cantidadPresentacion: cantidad,
        unidadCodigoPresentacion: unidadBase,
      };
    }

    return {
      cantidadCanonica: cantidad,
      cantidadPresentacion: null,
      unidadCodigoPresentacion: null,
    };
  }

  private async getItemVendibleOrThrow(
    tenantId: string,
    itemId: string,
  ): Promise<{ itemId: string; tipo: string; unidadMedida: string | null }> {
    const rows: {
      item_id: string;
      tipo: string;
      unidad_medida: string | null;
    }[] = await this.dataSource.query(
      `SELECT i.item_id, i.tipo, ip.unidad_medida
         FROM items i
         LEFT JOIN item_producto ip ON ip.item_id = i.item_id
        WHERE i.item_id = $1 AND i.tenant_id = $2
          AND i.activo = true AND i.eliminado_el IS NULL`,
      [itemId, tenantId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Ítem ${itemId} no encontrado`);
    }
    return {
      itemId: rows[0].item_id,
      tipo: rows[0].tipo,
      unidadMedida: rows[0].unidad_medida,
    };
  }
}
