import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { unwrap } from '../../common/utils/pg-returning.util';
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
  presentacionDesdeCanonica,
  resolverCantidadDesdePresentacion,
  resolverUnidadBaseDeItem,
  type UnidadCat,
} from '../../common/utils/cantidad-presentacion.util';
import type { PersonalizacionRecetaSnapshot } from '../../common/dto/personalizacion-receta.dto';
import {
  detallePersonalizacion,
  hashPersonalizacion,
  textoComandaPersonalizacion,
  type PersonalizacionDetalleLinea,
} from '../../common/utils/personalizacion-receta.util';

// `eliminadoEl`/`eliminadoPorNombre` solo se completan cuando se pide
// `incluirEliminados`: el listado normal sigue devolviendo la forma de
// siempre, sin esas columnas (ver categorias.service.ts → findAll).
export interface MesaResumen {
  id: string;
  nombre: string;
  posX: string;
  posY: string;
  forma: FormaMesa;
  tamano: TamanoMesa;
  cuentasAbiertas: number;
  ocupada: boolean;
  eliminadoEl?: string | null;
  eliminadoPorNombre?: string | null;
}

/**
 * Lo que `crear`/`actualizar` devuelven de un salón y una mesa. Los cuatro
 * métodos devolvían `repo.save(...)` crudo, con `tenantId`, timestamps y
 * `eliminadoPor` adentro: no es fuga cross-tenant —el usuario ya pertenece a ese
 * tenant— pero era el único lugar del módulo que exponía el interno, mientras
 * `listarSalones` arma una vista curada y `garzones`/`turnos` tienen su
 * `toPublico()`. Los campos son exactamente los que el frontend lee de esas
 * cuatro respuestas.
 */
export interface SalonPublico {
  id: string;
  nombre: string;
}

export interface MesaPublica {
  id: string;
  nombre: string;
  posX: string;
  posY: string;
  forma: FormaMesa;
  tamano: TamanoMesa;
}

export interface SalonConMesas {
  id: string;
  nombre: string;
  mesas: MesaResumen[];
  eliminadoEl?: string | null;
  eliminadoPorNombre?: string | null;
}

// Fila cruda de `listarSalones`. Los campos `*_eliminado_*` solo vienen
// seleccionados cuando `incluirEliminados` es true — `undefined` (no `null`)
// distingue "no se pidió la papelera" de "esta fila no está borrada".
interface SalonMesaRow {
  salon_id: string;
  salon_nombre: string;
  salon_eliminado_el?: string | null;
  salon_eliminado_por_nombre?: string | null;
  mesa_id: string | null;
  mesa_nombre: string | null;
  pos_x: string | null;
  pos_y: string | null;
  forma: string | null;
  tamano: string | null;
  mesa_eliminado_el?: string | null;
  mesa_eliminado_por_nombre?: string | null;
  cuentas_abiertas: string;
}

/** Fila cruda del JOIN `cuenta_lineas` × `items` que arma el detalle. */
interface LineaDetalleRow {
  cuenta_id: string;
  cuenta_linea_id: string;
  item_id: string;
  cantidad: string;
  cantidad_presentacion: string | null;
  unidad_codigo_presentacion: string | null;
  nombre: string;
  precio_base: string;
  moneda_id: string;
  personalizacion: PersonalizacionRecetaSnapshot | null;
  cantidad_enviada: string;
  item_eliminado: boolean;
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
  /**
   * Cuánto de esta línea YA se despachó a cocina. Viaja al cliente desde el
   * 2026-08-16: la pantalla necesita saberlo para no ofrecer un tacho que el
   * backend rechaza, y el modal de anulación lo va a necesitar para nacer
   * destildado (ver `docs/agent/pendientes.md`). El backend ya lo emitía, pero
   * solo dentro del preview de comanda (`ComandaEstacion`), que es otro flujo.
   */
  cantidadEnviada: string;
  /**
   * El ítem se eliminó del catálogo con la cuenta ya abierta. La línea se
   * sigue mostrando —esconderla dejaba la cuenta imposible de cobrar y de
   * corregir— para que el garzón pueda quitarla. `cerrarCuenta` la rechaza.
   */
  itemEliminado?: true;
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
    private readonly ventasService: VentasService,
    private readonly garzonesService: GarzonesService,
    private readonly sesionesGarzonService: SesionesGarzonService,
    private readonly cuentaAsignacionesService: CuentaAsignacionesService,
    private readonly itemsService: ItemsService,
    private readonly catalogService: CatalogService,
  ) {}

  // ── Administración: salones ──────────────────────────────────────────────

  /** Salones del tenant con sus mesas (para la vista de administración). */
  async listarSalones(
    tenantId: string,
    incluirEliminados = false,
  ): Promise<SalonConMesas[]> {
    if (!incluirEliminados) {
      const rows: SalonMesaRow[] = await this.dataSource.query(
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

    // Papelera: incluye salones y mesas borrados (sin filtrar sus
    // eliminado_el) y el nombre de quien borró cada uno, resuelto por JOIN
    // en la misma query — una por fila sería N+1 sobre un listado que puede
    // tener decenas de salones. El JOIN a `usuarios` no filtra su propio
    // `eliminado_el` a propósito: el autor de un borrado es un hecho
    // histórico (docs/patterns/backend.md, ver categorias.service.ts →
    // findAll).
    // Solo lo que borró una persona: `eliminado_por IS NULL` es un borrado
    // del sistema, no restaurable ni visible — decisión del owner,
    // docs/features/papelera.md. Se aplica por separado a salón y mesa: una
    // mesa borrada por el sistema bajo un salón borrado por una persona no
    // debe colarse (y viceversa), así que el filtro de la mesa va en el
    // JOIN (para no perder el salón cuando la mesa queda afuera) y el del
    // salón en el WHERE.
    const rows: SalonMesaRow[] = await this.dataSource.query(
      `SELECT s.salon_id, s.nombre AS salon_nombre,
              s.eliminado_el AS salon_eliminado_el,
              us.nombre_usuario AS salon_eliminado_por_nombre,
              m.mesa_id, m.nombre AS mesa_nombre, m.pos_x, m.pos_y,
              m.forma, m.tamano,
              m.eliminado_el AS mesa_eliminado_el,
              um.nombre_usuario AS mesa_eliminado_por_nombre,
              COALESCE(c.abiertas, 0) AS cuentas_abiertas
         FROM salones s
         LEFT JOIN mesas m ON m.salon_id = s.salon_id
              AND (m.eliminado_el IS NULL OR m.eliminado_por IS NOT NULL)
         LEFT JOIN usuarios us ON us.usuario_id = s.eliminado_por
         LEFT JOIN usuarios um ON um.usuario_id = m.eliminado_por
         LEFT JOIN (
           SELECT mesa_id, COUNT(*) AS abiertas
             FROM cuentas
            WHERE tenant_id = $1 AND estado = 'abierta' AND eliminado_el IS NULL
            GROUP BY mesa_id
         ) c ON c.mesa_id = m.mesa_id
        WHERE s.tenant_id = $1
          AND (s.eliminado_el IS NULL OR s.eliminado_por IS NOT NULL)
        ORDER BY s.nombre ASC, m.nombre ASC`,
      [tenantId],
    );
    return this.agruparSalones(rows);
  }

  /** Igual que listarSalones — la operación del garzón usa la misma foto. */
  listarSalonesOperacion(tenantId: string): Promise<SalonConMesas[]> {
    return this.listarSalones(tenantId);
  }

  private agruparSalones(rows: SalonMesaRow[]): SalonConMesas[] {
    const map = new Map<string, SalonConMesas>();
    for (const r of rows) {
      let salon = map.get(r.salon_id);
      if (!salon) {
        salon = { id: r.salon_id, nombre: r.salon_nombre, mesas: [] };
        if (r.salon_eliminado_el !== undefined) {
          salon.eliminadoEl = r.salon_eliminado_el;
          salon.eliminadoPorNombre = r.salon_eliminado_por_nombre ?? null;
        }
        map.set(r.salon_id, salon);
      }
      if (r.mesa_id) {
        const abiertas = Number(r.cuentas_abiertas);
        const mesa: MesaResumen = {
          id: r.mesa_id,
          nombre: r.mesa_nombre ?? '',
          posX: r.pos_x ?? '0',
          posY: r.pos_y ?? '0',
          forma: (r.forma as FormaMesa) ?? FormaMesa.CUADRADA,
          tamano: (r.tamano as TamanoMesa) ?? TamanoMesa.MEDIANO,
          cuentasAbiertas: abiertas,
          ocupada: abiertas > 0,
        };
        if (r.mesa_eliminado_el !== undefined) {
          mesa.eliminadoEl = r.mesa_eliminado_el;
          mesa.eliminadoPorNombre = r.mesa_eliminado_por_nombre ?? null;
        }
        salon.mesas.push(mesa);
      }
    }
    return [...map.values()];
  }

  async crearSalon(
    tenantId: string,
    dto: CreateSalonDto,
  ): Promise<SalonPublico> {
    const salon = this.salonRepo.create({ tenantId, nombre: dto.nombre });
    return this.toSalonPublico(await this.salonRepo.save(salon));
  }

  async actualizarSalon(
    tenantId: string,
    id: string,
    dto: UpdateSalonDto,
  ): Promise<SalonPublico> {
    const salon = await this.salonRepo.findOne({ where: { id, tenantId } });
    if (!salon) throw new NotFoundException(`Salón ${id} no encontrado`);
    Object.assign(salon, dto);
    return this.toSalonPublico(await this.salonRepo.save(salon));
  }

  private toSalonPublico(s: Salon): SalonPublico {
    return { id: s.id, nombre: s.nombre };
  }

  private toMesaPublica(m: Mesa): MesaPublica {
    return {
      id: m.id,
      nombre: m.nombre,
      posX: m.posX,
      posY: m.posY,
      forma: m.forma,
      tamano: m.tamano,
    };
  }

  async eliminarSalon(
    tenantId: string,
    usuarioId: string,
    id: string,
  ): Promise<void> {
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
    // Un solo `ahora` compartido entre las dos escrituras: las mesas
    // colaterales quedan con el MISMO `eliminado_el` que el salón, para que
    // `restaurarSalon` pueda acotar por ese valor exacto más adelante (ver
    // el comentario ahí). `manager.softDelete()` (que usaba antes) escribe
    // `CURRENT_TIMESTAMP` en SQL —estable dentro de una misma transacción,
    // así que ya hubiera coincidido— pero no puede escribir `eliminado_por`
    // en la misma sentencia, así que de todas formas hace falta este
    // `update()` explícito (mismo cambio que categorias.service.ts →
    // remove()). El filtro `eliminadoEl: IsNull()` en las mesas es lo que
    // evita pisar el `eliminado_el` de una mesa que ya estaba borrada por
    // otro motivo: sin él, este borrado le robaría su timestamp original y
    // `restaurarSalon` la revivería por error.
    const ahora = new Date();
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        Mesa,
        { salonId: id, tenantId, eliminadoEl: IsNull() },
        { eliminadoEl: ahora, eliminadoPor: usuarioId },
      );
      await manager.update(
        Salon,
        { id, tenantId },
        { eliminadoEl: ahora, eliminadoPor: usuarioId },
      );
    });
  }

  /**
   * Papelera: revierte `eliminarSalon()`. Revive el salón y, en la misma
   * sentencia, las mesas que ESE borrado se llevó — acotado por el
   * `eliminado_el` exacto que dejó, nunca por un valor leído a JS y pasado
   * de vuelta como parámetro (pierde precisión de microsegundos entre el
   * `Date` de `pg` y `timestamptz`; ver el comentario largo en
   * `items.service.ts → restaurar()`, que documenta el fallo silencioso
   * medido contra Postgres real). La comparación va sin cast de zona: desde
   * ADR-019 (docs/adr/019-timestamptz-en-toda-columna-de-fecha.md)
   * TODA columna de fecha del esquema es `timestamptz`, así que
   * `salones.eliminado_el` y `mesas.eliminado_el` son del mismo tipo y
   * comparar uno contra el otro no depende del `TimeZone` de ninguna sesión.
   * (Hasta el 2026-08-06 acá decía que las dos eran `timestamp` SIN zona y
   * que por eso no hacía falta el cast que sí usaba `items`. Las dos mitades
   * quedaron obsoletas el mismo día: el esquema se uniformó y `items` perdió
   * su cast, que con el tipo nuevo pasó a ser el bug en vez del arreglo.)
   *
   * Una mesa borrada ANTES que el salón (otro motivo, otro `eliminado_el`)
   * NO matchea esta comparación y sigue borrada — es el "acotamiento por
   * timestamp" que motiva esta task.
   */
  async restaurarSalon(tenantId: string, id: string): Promise<Salon> {
    const rows = unwrap<{ salon_id: string }>(
      await this.dataSource.query(
        `WITH restaurado AS (
           UPDATE salones
              SET eliminado_el = NULL, eliminado_por = NULL,
                  actualizado_el = NOW()
            WHERE salon_id = $1 AND tenant_id = $2 AND eliminado_el IS NOT NULL
              AND eliminado_por IS NOT NULL
           RETURNING salon_id,
                     (SELECT eliminado_el FROM salones
                        WHERE salon_id = $1 AND tenant_id = $2) AS eliminado_el_previo
         ),
         mesas_restauradas AS (
           UPDATE mesas
              SET eliminado_el = NULL, eliminado_por = NULL,
                  actualizado_el = NOW()
            WHERE salon_id = $1 AND tenant_id = $2
              AND eliminado_el = (SELECT eliminado_el_previo FROM restaurado)
           RETURNING mesa_id
         )
         SELECT salon_id FROM restaurado`,
        [id, tenantId],
      ),
    );
    if (!rows.length) {
      // `AND eliminado_por IS NOT NULL` arriba: decisión del owner — la
      // papelera solo restaura lo que borró una persona (docs/features/papelera.md).
      throw new NotFoundException(`Salón ${id} no está en la papelera`);
    }
    return this.salonRepo.findOneOrFail({ where: { id, tenantId } });
  }

  // ── Administración: mesas ────────────────────────────────────────────────

  async crearMesa(
    tenantId: string,
    salonId: string,
    dto: CreateMesaDto,
  ): Promise<MesaPublica> {
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
    return this.toMesaPublica(await this.mesaRepo.save(mesa));
  }

  async actualizarMesa(
    tenantId: string,
    id: string,
    dto: UpdateMesaDto,
  ): Promise<MesaPublica> {
    const mesa = await this.mesaRepo.findOne({ where: { id, tenantId } });
    if (!mesa) throw new NotFoundException(`Mesa ${id} no encontrada`);
    if (dto.nombre !== undefined) mesa.nombre = dto.nombre;
    if (dto.posX !== undefined) mesa.posX = dto.posX.toString();
    if (dto.posY !== undefined) mesa.posY = dto.posY.toString();
    if (dto.forma !== undefined) mesa.forma = dto.forma;
    if (dto.tamano !== undefined) mesa.tamano = dto.tamano;
    return this.toMesaPublica(await this.mesaRepo.save(mesa));
  }

  async eliminarMesa(
    tenantId: string,
    usuarioId: string,
    id: string,
  ): Promise<void> {
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
    // Una sola escritura en vez de `softDelete()` + `update()`: dos
    // sentencias sueltas pueden quedar a medias y dejar una fila borrada
    // sin autor (mismo cambio que categorias.service.ts → remove()).
    await this.mesaRepo.update(
      { id, tenantId },
      { eliminadoEl: new Date(), eliminadoPor: usuarioId },
    );
  }

  /**
   * Papelera: revierte `eliminarMesa()`. NO toca el salón: si sigue
   * borrado, la mesa queda huérfana y visible solo en el listado con
   * `incluirEliminados` — "huérfano tolerado", igual que restaurar un ítem
   * cuya categoría sigue borrada. Cascada hacia arriba (revivir el salón
   * porque se restauró una mesa) no es la conducta que pide la spec.
   */
  async restaurarMesa(tenantId: string, id: string): Promise<Mesa> {
    const rows = unwrap<{ mesa_id: string }>(
      await this.dataSource.query(
        `UPDATE mesas
            SET eliminado_el = NULL, eliminado_por = NULL,
                actualizado_el = NOW()
          WHERE mesa_id = $1 AND tenant_id = $2 AND eliminado_el IS NOT NULL
            AND eliminado_por IS NOT NULL
          RETURNING mesa_id`,
        [id, tenantId],
      ),
    );
    if (!rows.length) {
      // `AND eliminado_por IS NOT NULL` arriba: decisión del owner — la
      // papelera solo restaura lo que borró una persona (docs/features/papelera.md).
      throw new NotFoundException(`Mesa ${id} no está en la papelera`);
    }
    return this.mesaRepo.findOneOrFail({ where: { id, tenantId } });
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
    return this.armarDetalles(tenantId, cuentas);
  }

  async abrirCuenta(
    tenantId: string,
    usuarioId: string,
    mesaId: string,
    dto: CreateCuentaDto,
  ): Promise<CuentaDetalle> {
    await this.getMesaOrThrow(tenantId, mesaId);
    // Quién es el garzón responsable: del JWT si opera desde su propia tablet,
    // del PIN si el dispositivo es compartido (400 si no hay ni una cosa ni la
    // otra).
    const garzon = await this.garzonesService.resolverGarzonActuante(
      tenantId,
      usuarioId,
      dto,
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
    // El catálogo y la personalización se resuelven ANTES de tomar el lock:
    // son varias queries y no dependen del estado de la cuenta, así que no
    // tienen por qué alargar el lock que serializa contra `cerrarCuenta`.
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

    return this.dataSource.transaction(async (manager) => {
      const cuenta = await this.getCuentaAbiertaConLock(
        manager,
        tenantId,
        cuentaId,
      );
      const existentes = await manager.find(CuentaLinea, {
        where: { tenantId, cuentaId, itemId: dto.itemId },
      });
      const match = existentes.find(
        (l) => hashPersonalizacion(l.personalizacion) === hash,
      );
      if (match) {
        match.cantidad = new Decimal(match.cantidad)
          .plus(resuelta.cantidadCanonica)
          .toString();
        // La presentación se REESCRIBE, no se suma: la línea puede estar
        // mostrando `g` y lo que entra venir en `kg`, así que sumar los dos
        // números daría una unidad que no existe. Se recalcula desde la
        // canónica ya sumada, en la unidad que esa línea ya mostraba.
        this.sincronizarPresentacion(match, item, catalogo);
        await manager.save(CuentaLinea, match);
      } else {
        await manager.save(
          CuentaLinea,
          manager.create(CuentaLinea, {
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
      return this.armarDetalle(tenantId, cuenta, manager);
    });
  }

  async actualizarLinea(
    tenantId: string,
    cuentaId: string,
    lineaId: string,
    dto: UpdateLineaDto,
  ): Promise<CuentaDetalle> {
    // El catálogo de unidades es global: no depende de la cuenta ni de la
    // línea, así que se carga fuera del lock. El ítem no puede salir de acá
    // —depende de `linea.itemId`, que se lee bajo lock— y por eso va con el
    // manager de la transacción: pedir una segunda conexión del pool mientras
    // se sostiene el `FOR UPDATE` es un doble checkout que puede estancarse.
    const catalogo = await this.loadCatalogoUnidades();
    return this.dataSource.transaction(async (manager) => {
      const cuenta = await this.getCuentaAbiertaConLock(
        manager,
        tenantId,
        cuentaId,
      );
      const linea = await manager.findOne(CuentaLinea, {
        where: { id: lineaId, tenantId, cuentaId },
      });
      if (!linea) throw new NotFoundException(`Línea ${lineaId} no encontrada`);

      const item = await this.getItemVendibleOrThrow(
        tenantId,
        linea.itemId,
        manager,
      );
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
      // Mismo motivo que el guard de `quitarLinea`, por el otro camino: bajar
      // la cantidad por debajo de lo ya despachado regala la diferencia sin
      // registro. `actualizarLinea` recibe un valor ABSOLUTO, no un delta, así
      // que sin este chequeo "2 → 1" sobre una línea con 2 enviados pasa igual
      // que cualquier corrección. Subirla sigue siendo libre.
      if (
        new Decimal(resuelta.cantidadCanonica).lessThan(linea.cantidadEnviada)
      ) {
        throw new BadRequestException(
          `Ya se despacharon ${linea.cantidadEnviada} a cocina: no se puede ` +
            `bajar la cantidad por debajo de eso. Si lo despachado no se va a ` +
            `cobrar, registralo como merma o cortesía para que quede el rastro.`,
        );
      }

      linea.cantidad = resuelta.cantidadCanonica;
      linea.cantidadPresentacion = resuelta.cantidadPresentacion;
      linea.unidadCodigoPresentacion = resuelta.unidadCodigoPresentacion;
      await manager.save(CuentaLinea, linea);
      return this.armarDetalle(tenantId, cuenta, manager);
    });
  }

  async quitarLinea(
    tenantId: string,
    cuentaId: string,
    lineaId: string,
  ): Promise<CuentaDetalle> {
    return this.dataSource.transaction(async (manager) => {
      const cuenta = await this.getCuentaAbiertaConLock(
        manager,
        tenantId,
        cuentaId,
      );
      // Se lee ANTES de borrar. Hasta el 2026-08-16 esto era un `softDelete`
      // por criterio, sin mirar la fila: una línea ya despachada a cocina se
      // borraba en silencio. La comida ya se hizo, así que quitarla del
      // sistema la regala **sin registro** — decisión del owner (2026-08-08):
      // se bloquea. Para anular de verdad tiene que existir un camino con
      // motivo (merma o cortesía), que es lo que falta diseñar.
      //
      // ℹ️ Efecto colateral de leer primero, anotado porque es un cambio real:
      // repetir el DELETE sobre una línea YA borrada ahora da 404. Antes el
      // `softDelete` por criterio no filtraba `eliminado_el`, así que el
      // segundo intento respondía 200 sin hacer nada. El 404 es más honesto.
      const linea = await manager.findOne(CuentaLinea, {
        where: { id: lineaId, tenantId, cuentaId },
      });
      if (!linea) {
        throw new NotFoundException(`Línea ${lineaId} no encontrada`);
      }
      if (new Decimal(linea.cantidadEnviada).greaterThan(0)) {
        throw new BadRequestException(
          `Esa línea ya se despachó a cocina (${linea.cantidadEnviada}): no se ` +
            `puede quitar. Si el plato no se va a cobrar, registralo como merma ` +
            `o cortesía para que quede el rastro.`,
        );
      }
      const res = await manager.softDelete(CuentaLinea, {
        id: lineaId,
        tenantId,
        cuentaId,
      });
      if (!res.affected) {
        throw new NotFoundException(`Línea ${lineaId} no encontrada`);
      }
      return this.armarDetalle(tenantId, cuenta, manager);
    });
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
    // Ordenado antes de pedir el lock. NO cierra un deadlock demostrado —un
    // solo `SELECT … FOR UPDATE` lockea en orden de plan, igual para dos
    // transacciones con la misma forma de query— pero cuesta una línea y saca
    // del medio la pregunta la próxima vez que alguien lea esto.
    const ids = [...new Set(dto.cuentaIds)].sort();
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

      // Las dos lecturas van FUERA del loop: esto corre sosteniendo el
      // `pessimistic_write` sobre todas las cuentas, así que cada query de más
      // alarga el lock que bloquea agregar líneas y cerrar en esa mesa. Antes
      // era una lectura por línea de cada origen.
      const lineasOrigen = await manager.find(CuentaLinea, {
        where: { tenantId, cuentaId: In(origenes.map((o) => o.id)) },
      });
      const porOrigen = new Map<string, CuentaLinea[]>();
      for (const l of lineasOrigen) {
        const acc = porOrigen.get(l.cuentaId);
        if (acc) acc.push(l);
        else porOrigen.set(l.cuentaId, [l]);
      }

      const claveFusion = (l: CuentaLinea) =>
        `${l.itemId}|${hashPersonalizacion(l.personalizacion)}`;
      const enDestino = new Map<string, CuentaLinea>();
      for (const l of await manager.find(CuentaLinea, {
        where: { tenantId, cuentaId: destino.id },
      })) {
        // Si el destino ya trajera dos líneas con la misma clave —estado que
        // `agregarLinea` no produce, porque mergea— da igual sobre cuál se
        // sume: el total de la cuenta es el mismo.
        enDestino.set(claveFusion(l), l);
      }

      // Las dos lecturas que necesita reescribir la presentación al mergear, en
      // BLOQUE y fuera del bucle: una por línea sería un N+1 sostenido encima
      // del lock de la fusión, que es peor que uno de lectura suelta.
      // Solo se piden si hay algo que reescribir: si ninguna línea de destino
      // muestra presentación, no se emite ninguna de las dos.
      const itemsFusion = new Map<
        string,
        { tipo: string; unidadMedida: string | null }
      >();
      let catalogo: UnidadCat[] = [];
      // Incluye las líneas de ORIGEN y no solo las de destino: una línea que no
      // matchea se muda al destino (rama `else`) y puede recibir después otra de
      // un origen posterior, así que ahí también hay presentación que reescribir.
      const idsAResolver = [
        ...new Set(
          [...lineasOrigen, ...enDestino.values()]
            .filter((l) => l.unidadCodigoPresentacion)
            .map((l) => l.itemId),
        ),
      ];
      if (idsAResolver.length) {
        catalogo = await this.loadCatalogoUnidades();
        const filas: {
          item_id: string;
          tipo: string;
          unidad_medida: string | null;
        }[] = await manager.query(
          // `item_producto` NO tiene columna de borrado (verificado contra el
          // esquema y contra la BD viva): filtrarla ahí es un error de sintaxis,
          // no una precaución.
          //
          // Y el JOIN de `items` NO filtra `eliminado_el`, con el mismo
          // argumento que ya usa `armarDetalles` unas líneas más abajo: estas
          // líneas YA están en la cuenta, y si el ítem se borró del catálogo
          // después, filtrarlo dejaría su presentación sin reescribir — o sea
          // el bug de esta misma entrada, reaparecido justo en el caso más
          // difícil de notar. La lectura sigue acotada al tenant por
          // `i.tenant_id`.
          `SELECT i.item_id, i.tipo, ip.unidad_medida
             FROM items i
             LEFT JOIN item_producto ip ON ip.item_id = i.item_id
            WHERE i.item_id = ANY($1::uuid[]) AND i.tenant_id = $2`,
          [idsAResolver, tenantId],
        );
        for (const f of filas) {
          itemsFusion.set(f.item_id, {
            tipo: f.tipo,
            unidadMedida: f.unidad_medida,
          });
        }
      }

      for (const origen of origenes) {
        for (const linea of porOrigen.get(origen.id) ?? []) {
          const existente = enDestino.get(claveFusion(linea));
          if (existente) {
            existente.cantidad = new Decimal(existente.cantidad)
              .plus(linea.cantidad)
              .toString();
            existente.cantidadEnviada = new Decimal(existente.cantidadEnviada)
              .plus(linea.cantidadEnviada)
              .toString();
            // Mismo criterio que el merge de `agregarLinea`: la presentación se
            // reescribe en la unidad de la línea de DESTINO, que es la que
            // queda en pantalla. `itemsFusion` ya trae todo lo necesario: acá
            // adentro no puede haber una query por línea.
            const itemFusion = itemsFusion.get(existente.itemId);
            if (itemFusion) {
              this.sincronizarPresentacion(existente, itemFusion, catalogo);
            }
            await manager.save(CuentaLinea, existente);
            await manager.softDelete(CuentaLinea, {
              id: linea.id,
              tenantId,
            });
          } else {
            linea.cuentaId = destino.id;
            await manager.save(CuentaLinea, linea);
            // El índice se mantiene al día: una línea igual que venga de un
            // origen POSTERIOR tiene que sumarse sobre esta, no duplicarla.
            enDestino.set(claveFusion(linea), linea);
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
    // Quién cierra: del JWT en tablet personal, del PIN en dispositivo
    // compartido (400 si no hay ninguno de los dos).
    const garzon = await this.garzonesService.resolverGarzonActuante(
      tenantId,
      usuarioId,
      dto,
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

      // El responsable, no el que cobra: la propina se atribuye a su turno. Si
      // marcó salida con la mesa abierta, la cuenta no se puede cobrar hasta
      // transferirla — el mensaje lo dice, porque el genérico de
      // `assertSesionAbierta` habla del garzón que está operando y mandaba al
      // cajero a "entrar a turno" cuando su turno no era el problema.
      const sesionResponsable =
        await this.sesionesGarzonService.buscarSesionAbierta(
          tenantId,
          cuenta.garzonResponsableId,
        );
      if (!sesionResponsable) {
        throw new BadRequestException(
          'El garzón responsable de la cuenta ya no está en turno. ' +
            'Transferí la cuenta a alguien en turno para poder cobrarla.',
        );
      }

      // Los tres, no solo el que se cobra: `@IsNumberString()` acepta el signo
      // menos, y aunque `targetCobro` use únicamente `propinaMonto` —así que un
      // negativo en los otros dos no cobra de más—, se persisten en
      // `venta_propina` y corrompen los reportes con signos incoherentes.
      const propinaMonto = dto.propinaMonto ?? '0';
      const negativa = [
        propinaMonto,
        dto.propinaSugerida,
        dto.propinaPorcentajeSugerido,
      ].some((v) => v !== undefined && new Decimal(v).lt(0));
      if (negativa) {
        throw new BadRequestException('Propina inválida');
      }

      // Va acá y no antes: las validaciones de arriba son gratis y este es el
      // único chequeo que pega a la BD. `crearEnTransaccion` resolvería igual
      // los ítems y explotaría con un "Item no encontrado" que no dice cuál ni
      // deja hacer nada; con el nombre, el garzón sabe qué línea quitar (el
      // detalle ahora se la muestra marcada en vez de esconderla).
      const eliminados: { nombre: string }[] = await manager.query(
        `SELECT nombre FROM items
          WHERE item_id = ANY($1) AND tenant_id = $2
            AND eliminado_el IS NOT NULL
          ORDER BY nombre`,
        [lineas.map((l) => l.itemId), tenantId],
      );
      if (eliminados.length > 0) {
        throw new BadRequestException(
          `No se puede cobrar: ${eliminados.map((e) => e.nombre).join(', ')} ` +
            `se eliminó del catálogo. Quitá esa línea de la cuenta para cerrarla.`,
        );
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
                ...(l.personalizacion.componentes?.length
                  ? {
                      componentes: l.personalizacion.componentes.map((c) => ({
                        componenteItemId: c.componenteItemId,
                        unidad: c.unidad,
                        grupos: c.grupos.map((g) => ({
                          grupoId: g.grupoId,
                          opciones: g.opciones.map((o) => ({
                            itemId: o.itemId,
                            unidades: Number(o.unidades),
                          })),
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

    const rows: {
      cuenta_linea_id: string;
      cantidad: string;
      cantidad_enviada: string;
      nombre: string;
      impresora_id: string | null;
      impresora_nombre: string | null;
      personalizacion: PersonalizacionRecetaSnapshot | null;
    }[] = await this.dataSource.query(this.sqlLineasComanda(), [
      cuentaId,
      tenantId,
    ]);
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

      // Con el `manager` de la transacción: salir por `this.dataSource` acá
      // pide una segunda conexión del pool con el `FOR UPDATE` ya tomado.
      // `previewComanda` no está en transacción, así que ahí la global es
      // inofensiva.
      const nombres = await this.nombresIngredientesPersonalizacion(
        tenantId,
        rows,
        manager,
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
    // Igual que `armarDetalle`: el JOIN a `items` NO filtra lo eliminado. Un
    // plato ya pedido hay que cocinarlo, lo haya sacado o no el admin de la
    // carta mientras tanto. Filtrándolo, la línea desaparecía del ticket sin
    // ningún aviso —"Enviar a cocina" respondía OK y el plato no se cocinaba—
    // y su `cantidad_enviada` no avanzaba nunca.
    //
    // `categorias` tampoco filtra lo eliminado, y por la MISMA razón: si un
    // cleanup borra el ítem y su categoría, la línea perdía su `impresora_id` y
    // el agrupado la salteaba en silencio, indistinguible de "categoría sin
    // impresora". La categoría acá es ruteo, no un recurso que pueda faltar.
    // `impresoras` sí filtra: a una impresora borrada o apagada no se imprime.
    return `SELECT cl.cuenta_linea_id, cl.cantidad, cl.cantidad_enviada,
              cl.personalizacion, i.nombre, imp.impresora_id, imp.nombre AS impresora_nombre
         FROM cuenta_lineas cl
         JOIN items i ON i.item_id = cl.item_id AND i.tenant_id = $2
         LEFT JOIN categorias c
           ON c.categoria_id = i.categoria_id
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
    usuarioId: string,
    cuentaId: string,
    credencial: { garzonId?: string; pin?: string },
  ): Promise<CuentaDetalle> {
    const cuenta = await this.cuentaAsignacionesService.transferirPorPin(
      tenantId,
      usuarioId,
      cuentaId,
      credencial,
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
    const [detalle] = await this.armarDetalles(tenantId, [cuenta], manager);
    return detalle;
  }

  /**
   * Detalle de N cuentas con un número FIJO de queries, no una tanda por cuenta.
   * `listarCuentasDeMesa` es lo que el garzón golpea cada vez que abre una mesa,
   * y con una tanda por cuenta el costo crecía con las cuentas abiertas.
   *
   * Las dos consultas auxiliares ya eran batch (`= ANY($1)`); lo único que faltaba
   * era llamarlas una sola vez con las líneas de todas las cuentas juntas.
   */
  private async armarDetalles(
    tenantId: string,
    cuentas: Cuenta[],
    manager?: DataSource['manager'],
  ): Promise<CuentaDetalle[]> {
    if (cuentas.length === 0) return [];
    const runner = manager ?? this.dataSource.manager;
    const lineas: LineaDetalleRow[] = await runner.query(
      // El JOIN NO filtra `i.eliminado_el IS NULL`, y es a propósito: la fila
      // de `items` sobrevive al soft delete, así que filtrarla hacía
      // DESAPARECER la línea de la pantalla mientras `cerrarCuenta` —que lee
      // las líneas crudas— seguía contándola. El garzón veía una cuenta
      // incompleta que no podía cobrar ni corregir, porque no tenía el
      // `lineaId` de algo que no se renderizaba. Ahora se muestra marcada.
      `SELECT cl.cuenta_id, cl.cuenta_linea_id, cl.item_id, cl.cantidad,
              cl.cantidad_presentacion, cl.unidad_codigo_presentacion,
              cl.personalizacion, cl.cantidad_enviada,
              i.nombre, i.precio_base, i.moneda_id,
              i.eliminado_el IS NOT NULL AS item_eliminado
         FROM cuenta_lineas cl
         JOIN items i ON i.item_id = cl.item_id AND i.tenant_id = $2
        WHERE cl.cuenta_id = ANY($1) AND cl.tenant_id = $2
          AND cl.eliminado_el IS NULL
        ORDER BY cl.creado_el ASC`,
      [cuentas.map((c) => c.id), tenantId],
    );
    // El ORDER BY es global, pero agrupar respetando el orden de llegada deja
    // cada cuenta con sus líneas en el mismo orden que tenían una por una.
    const porCuenta = new Map<string, LineaDetalleRow[]>();
    for (const l of lineas) {
      const acc = porCuenta.get(l.cuenta_id);
      if (acc) acc.push(l);
      else porCuenta.set(l.cuenta_id, [l]);
    }
    const nombresGarzon = await this.nombresGarzon(
      runner,
      cuentas.flatMap((c) => [
        c.garzonAperturaId,
        c.garzonCierreId,
        c.garzonResponsableId,
      ]),
    );
    const nombres = await this.nombresIngredientesPersonalizacion(
      tenantId,
      lineas,
      runner,
    );
    return cuentas.map((cuenta) =>
      this.mapearDetalle(
        cuenta,
        porCuenta.get(cuenta.id) ?? [],
        nombresGarzon,
        nombres,
      ),
    );
  }

  private mapearDetalle(
    cuenta: Cuenta,
    lineas: LineaDetalleRow[],
    nombresGarzon: Record<string, string>,
    nombres: Map<string, string>,
  ): CuentaDetalle {
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
          cantidadEnviada: l.cantidad_enviada,
          ...(personalizacionTexto ? { personalizacionTexto } : {}),
          ...(personalizacionDetalle.length ? { personalizacionDetalle } : {}),
          ...(l.item_eliminado ? { itemEliminado: true as const } : {}),
        };
      }),
    };
  }

  private async nombresIngredientesPersonalizacion(
    tenantId: string,
    rows: { personalizacion?: PersonalizacionRecetaSnapshot | null }[],
    runner?: DataSource['manager'],
  ): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const row of rows) {
      const p = row.personalizacion;
      if (!p) continue;
      for (const id of p.omitidos ?? []) ids.add(id);
      for (const e of p.extras ?? []) ids.add(e.ingredienteItemId);
    }
    if (ids.size === 0) return new Map();
    const nameRows: { item_id: string; nombre: string }[] = await (
      runner ?? this.dataSource
    ).query(
      `SELECT item_id, nombre FROM items
          WHERE item_id = ANY($1) AND tenant_id = $2 AND eliminado_el IS NULL`,
      [[...ids], tenantId],
    );
    return new Map(nameRows.map((r) => [r.item_id, r.nombre]));
  }

  /** Resuelve los nombres de los garzones de apertura/cierre en una query. */
  private async nombresGarzon(
    runner: DataSource['manager'],
    ids: (string | null)[],
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

  /**
   * Lee la cuenta con `FOR UPDATE` y valida que siga abierta **dentro de la
   * transacción que va a escribir**. Un `SELECT` plano no sirve acá: no espera
   * al lock que toma `cerrarCuenta`, así que ve la cuenta como abierta durante
   * todo el cierre —que incluye armar la venta entera— y la escritura se cuela
   * en una cuenta que queda cerrada un instante después. Esa línea no se cobra
   * (la venta ya se armó sin ella) y tampoco llega a cocina (`previewComanda` y
   * `reclamarComanda` exigen ABIERTA): queda invisible para todos.
   */
  private async getCuentaAbiertaConLock(
    manager: DataSource['manager'],
    tenantId: string,
    id: string,
  ): Promise<Cuenta> {
    const cuenta = await manager.findOne(Cuenta, {
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
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

  /**
   * Reescribe `cantidadPresentacion` de una línea cuya canónica acaba de
   * cambiar, **en la unidad que esa línea ya venía mostrando**. Es la regla de
   * merge del diseño de presentación: una línea en `g` con 500 que recibe 1 kg
   * queda en 1500 g.
   *
   * No hace nada si la línea no tiene presentación (fila legada, o ítem que
   * nunca la usó): ahí no hay "unidad visible" que respetar, y el detalle cae
   * en el mismo camino de siempre.
   *
   * Si la conversión no se puede hacer o cae bajo la precisión de 4 decimales,
   * **deja la presentación como estaba**. La razón es de UX y no de integridad:
   * esto corre dentro de una transacción, así que lanzar haría rollback limpio y
   * no dejaría nada a medio escribir. Lo que se evita es que una unidad fuera de
   * catálogo o un cruce de magnitudes —estados en los que esa fila ya estaba mal
   * antes de este merge— impidan agregar una línea o fusionar una mesa.
   * ⚠️ **El precio es que el fallo es mudo**: queda una presentación vieja, que
   * es el bug de esta misma entrada en miniatura. Se acepta a sabiendas; no hay
   * logger en este service y meter uno sería introducir un patrón nuevo.
   */
  private sincronizarPresentacion(
    linea: CuentaLinea,
    item: { tipo: string; unidadMedida: string | null },
    catalogo: UnidadCat[],
  ): void {
    if (!linea.unidadCodigoPresentacion) return;
    const { unidadBaseCodigo } = resolverUnidadBaseDeItem(item);
    const nueva = presentacionDesdeCanonica({
      cantidadCanonica: linea.cantidad,
      unidadCodigoPresentacion: linea.unidadCodigoPresentacion,
      unidadBaseCodigo,
      catalogo,
    });
    if (nueva !== null) linea.cantidadPresentacion = nueva;
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
    const {
      cantidad,
      cantidadPresentacion,
      unidadCodigoPresentacion,
      item,
      catalogo,
    } = params;
    assertPresentacionPareada(cantidadPresentacion, unidadCodigoPresentacion);

    const { unidadBaseCodigo, forzarConteo } = resolverUnidadBaseDeItem(item);

    if (cantidadPresentacion && unidadCodigoPresentacion) {
      const res = resolverCantidadDesdePresentacion({
        cantidadPresentacion,
        unidadCodigoPresentacion,
        unidadBaseCodigo,
        catalogo,
        forzarConteo,
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
        unidadCodigoPresentacion: unidadBaseCodigo,
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
    runner?: DataSource['manager'],
  ): Promise<{ itemId: string; tipo: string; unidadMedida: string | null }> {
    const rows: {
      item_id: string;
      tipo: string;
      unidad_medida: string | null;
    }[] = await (runner ?? this.dataSource).query(
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
