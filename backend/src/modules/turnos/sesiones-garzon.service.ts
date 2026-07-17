import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { GarzonesService } from '../garzones/garzones.service';
import { TurnosService } from './turnos.service';
import {
  EstadoSesionGarzon,
  OrigenCierreSesion,
  SesionGarzon,
} from './entities/sesion-garzon.entity';
import { IniciarSesionDto } from './dto/iniciar-sesion.dto';
import { QuerySesionesDto } from './dto/query-sesiones.dto';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';

/** Vista pública de una sesión (inicio / cierre / activa). */
export interface SesionPublica {
  id: string;
  garzonId: string;
  garzonNombre: string;
  turnoId: string;
  turnoNombre: string;
  inicioEl: Date;
  finEl: Date | null;
  estado: EstadoSesionGarzon;
  origenCierre: OrigenCierreSesion | null;
  cerradaPorUsuarioId: string | null;
}

/** Ítem de listado / historial con nombres. */
export interface SesionListaItem {
  id: string;
  garzonId: string;
  garzonNombre: string;
  turnoId: string;
  turnoNombre: string;
  inicioEl: Date;
  finEl: Date | null;
  estado: EstadoSesionGarzon;
  origenCierre: OrigenCierreSesion | null;
  cerradaPorUsuarioId: string | null;
}

@Injectable()
export class SesionesGarzonService {
  constructor(
    @InjectRepository(SesionGarzon)
    private readonly sesionRepo: Repository<SesionGarzon>,
    private readonly garzones: GarzonesService,
    private readonly turnos: TurnosService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async iniciar(
    tenantId: string,
    dto: IniciarSesionDto,
  ): Promise<SesionPublica> {
    const garzon = await this.garzones.resolverGarzonPorPin(tenantId, dto.pin);
    const turno = await this.turnos.getActivoOrThrow(tenantId, dto.turnoId);

    const abierta = await this.sesionRepo.findOne({
      where: {
        tenantId,
        garzonId: garzon.id,
        estado: EstadoSesionGarzon.ABIERTA,
      },
    });
    if (abierta) {
      throw new BadRequestException('El garzón ya tiene una sesión abierta');
    }

    const sesion = this.sesionRepo.create({
      tenantId,
      garzonId: garzon.id,
      turnoId: turno.id,
      inicioEl: new Date(),
      finEl: null,
      estado: EstadoSesionGarzon.ABIERTA,
      origenCierre: null,
      cerradaPorUsuarioId: null,
    });
    try {
      const guardada = await this.sesionRepo.save(sesion);
      return this.toPublico(guardada, garzon.nombre, turno.nombre);
    } catch (err: unknown) {
      const pg = err as { code?: string };
      if (pg.code === '23505') {
        throw new BadRequestException('El garzón ya tiene una sesión abierta');
      }
      throw err;
    }
  }

  async cerrarPorPin(tenantId: string, pin: string): Promise<SesionPublica> {
    const garzon = await this.garzones.resolverGarzonPorPin(tenantId, pin);
    const abierta = await this.sesionRepo.findOne({
      where: {
        tenantId,
        garzonId: garzon.id,
        estado: EstadoSesionGarzon.ABIERTA,
      },
    });
    if (!abierta) {
      throw new BadRequestException('El garzón no tiene una sesión abierta');
    }

    abierta.finEl = new Date();
    abierta.estado = EstadoSesionGarzon.CERRADA;
    abierta.origenCierre = OrigenCierreSesion.PIN;
    abierta.cerradaPorUsuarioId = null;
    const guardada = await this.sesionRepo.save(abierta);

    const { turnoNombre } = await this.cargarNombres(
      tenantId,
      guardada.garzonId,
      guardada.turnoId,
    );
    return this.toPublico(guardada, garzon.nombre, turnoNombre);
  }

  async activaPorPin(
    tenantId: string,
    pin: string,
  ): Promise<SesionPublica | null> {
    const garzon = await this.garzones.resolverGarzonPorPin(tenantId, pin);
    const abierta = await this.sesionRepo.findOne({
      where: {
        tenantId,
        garzonId: garzon.id,
        estado: EstadoSesionGarzon.ABIERTA,
      },
    });
    if (!abierta) return null;

    const { turnoNombre } = await this.cargarNombres(
      tenantId,
      abierta.garzonId,
      abierta.turnoId,
    );
    return this.toPublico(abierta, garzon.nombre, turnoNombre);
  }

  async listarAbiertas(tenantId: string): Promise<SesionListaItem[]> {
    const rows: {
      sesion_garzon_id: string;
      garzon_id: string;
      garzon_nombre: string;
      turno_id: string;
      turno_nombre: string;
      inicio_el: Date;
      fin_el: Date | null;
      estado: EstadoSesionGarzon;
      origen_cierre: OrigenCierreSesion | null;
      cerrada_por_usuario_id: string | null;
    }[] = await this.dataSource.query(
      `SELECT s.sesion_garzon_id,
              s.garzon_id,
              g.nombre AS garzon_nombre,
              s.turno_id,
              t.nombre AS turno_nombre,
              s.inicio_el,
              s.fin_el,
              s.estado,
              s.origen_cierre,
              s.cerrada_por_usuario_id
       FROM sesiones_garzon s
       JOIN garzones g ON g.garzon_id = s.garzon_id AND g.eliminado_el IS NULL
       JOIN turnos t ON t.turno_id = s.turno_id AND t.eliminado_el IS NULL
       WHERE s.tenant_id = $1
         AND s.estado = 'abierta'
         AND s.eliminado_el IS NULL
       ORDER BY s.inicio_el ASC`,
      [tenantId],
    );

    return rows.map((r) => this.mapListaRow(r));
  }

  async historial(
    tenantId: string,
    query: QuerySesionesDto,
  ): Promise<PaginatedResponse<SesionListaItem>> {
    const { page, pageSize, offset } = resolvePagination(query);
    const { filters, params } = this.buildHistorialFilters(tenantId, query);

    const countRows: { total: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total
       FROM sesiones_garzon s
       WHERE s.tenant_id = $1
         AND s.eliminado_el IS NULL
         ${filters}`,
      params,
    );
    const total = countRows[0]?.total ?? 0;

    const listParams = [...params, pageSize, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows: {
      sesion_garzon_id: string;
      garzon_id: string;
      garzon_nombre: string | null;
      turno_id: string;
      turno_nombre: string | null;
      inicio_el: Date;
      fin_el: Date | null;
      estado: EstadoSesionGarzon;
      origen_cierre: OrigenCierreSesion | null;
      cerrada_por_usuario_id: string | null;
    }[] = await this.dataSource.query(
      `SELECT s.sesion_garzon_id,
              s.garzon_id,
              g.nombre AS garzon_nombre,
              s.turno_id,
              t.nombre AS turno_nombre,
              s.inicio_el,
              s.fin_el,
              s.estado,
              s.origen_cierre,
              s.cerrada_por_usuario_id
       FROM sesiones_garzon s
       LEFT JOIN garzones g ON g.garzon_id = s.garzon_id AND g.eliminado_el IS NULL
       LEFT JOIN turnos t ON t.turno_id = s.turno_id AND t.eliminado_el IS NULL
       WHERE s.tenant_id = $1
         AND s.eliminado_el IS NULL
         ${filters}
       ORDER BY s.inicio_el DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );

    return {
      data: rows.map((r) => this.mapListaRow(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async cerrarAdmin(
    tenantId: string,
    sesionId: string,
    usuarioId: string,
  ): Promise<SesionPublica> {
    const sesion = await this.sesionRepo.findOne({
      where: { id: sesionId, tenantId },
    });
    if (!sesion) {
      throw new NotFoundException(`Sesión ${sesionId} no encontrada`);
    }
    if (sesion.estado !== EstadoSesionGarzon.ABIERTA) {
      throw new BadRequestException('El garzón no tiene una sesión abierta');
    }

    sesion.finEl = new Date();
    sesion.estado = EstadoSesionGarzon.CERRADA;
    sesion.origenCierre = OrigenCierreSesion.ADMIN;
    sesion.cerradaPorUsuarioId = usuarioId;
    const guardada = await this.sesionRepo.save(sesion);

    const { garzonNombre, turnoNombre } = await this.cargarNombres(
      tenantId,
      guardada.garzonId,
      guardada.turnoId,
    );
    return this.toPublico(guardada, garzonNombre, turnoNombre);
  }

  async assertSesionAbierta(tenantId: string, garzonId: string): Promise<void> {
    const abierta = await this.sesionRepo.findOne({
      where: { tenantId, garzonId, estado: EstadoSesionGarzon.ABIERTA },
    });
    if (!abierta) {
      throw new BadRequestException(
        'El garzón no tiene una sesión de trabajo abierta',
      );
    }
  }

  private toPublico(
    s: SesionGarzon,
    garzonNombre: string,
    turnoNombre: string,
  ): SesionPublica {
    return {
      id: s.id,
      garzonId: s.garzonId,
      garzonNombre,
      turnoId: s.turnoId,
      turnoNombre,
      inicioEl: s.inicioEl,
      finEl: s.finEl,
      estado: s.estado,
      origenCierre: s.origenCierre,
      cerradaPorUsuarioId: s.cerradaPorUsuarioId,
    };
  }

  private mapListaRow(r: {
    sesion_garzon_id: string;
    garzon_id: string;
    garzon_nombre: string | null;
    turno_id: string;
    turno_nombre: string | null;
    inicio_el: Date;
    fin_el: Date | null;
    estado: EstadoSesionGarzon;
    origen_cierre: OrigenCierreSesion | null;
    cerrada_por_usuario_id: string | null;
  }): SesionListaItem {
    return {
      id: r.sesion_garzon_id,
      garzonId: r.garzon_id,
      garzonNombre: r.garzon_nombre ?? '',
      turnoId: r.turno_id,
      turnoNombre: r.turno_nombre ?? '',
      inicioEl: r.inicio_el,
      finEl: r.fin_el,
      estado: r.estado,
      origenCierre: r.origen_cierre,
      cerradaPorUsuarioId: r.cerrada_por_usuario_id,
    };
  }

  private async cargarNombres(
    tenantId: string,
    garzonId: string,
    turnoId: string,
  ): Promise<{ garzonNombre: string; turnoNombre: string }> {
    const rows: { garzon_nombre: string; turno_nombre: string }[] =
      await this.dataSource.query(
        `SELECT g.nombre AS garzon_nombre, t.nombre AS turno_nombre
         FROM garzones g
         CROSS JOIN turnos t
         WHERE g.garzon_id = $1
           AND g.tenant_id = $2
           AND g.eliminado_el IS NULL
           AND t.turno_id = $3
           AND t.tenant_id = $2
           AND t.eliminado_el IS NULL`,
        [garzonId, tenantId, turnoId],
      );
    return {
      garzonNombre: rows[0]?.garzon_nombre ?? '',
      turnoNombre: rows[0]?.turno_nombre ?? '',
    };
  }

  private buildHistorialFilters(
    tenantId: string,
    query: QuerySesionesDto,
  ): { filters: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let paramIdx = 2;
    let filters = '';

    if (query.garzonId) {
      filters += ` AND s.garzon_id = $${paramIdx++}`;
      params.push(query.garzonId);
    }
    if (query.turnoId) {
      filters += ` AND s.turno_id = $${paramIdx++}`;
      params.push(query.turnoId);
    }
    if (query.estado) {
      filters += ` AND s.estado = $${paramIdx++}`;
      params.push(query.estado);
    }
    if (query.desde) {
      filters += ` AND s.inicio_el >= $${paramIdx++}`;
      params.push(query.desde);
    }
    if (query.hasta) {
      filters += ` AND s.inicio_el <= $${paramIdx++}`;
      params.push(query.hasta);
    }

    return { filters, params };
  }
}
