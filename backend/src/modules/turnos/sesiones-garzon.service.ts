import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Db } from '../../common/db/db.service';
import { GarzonesService } from '../garzones/garzones.service';
import { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';
import { TurnosService } from './turnos.service';
// `CajaTestigoService` vive en `CajaModule`, que a su vez importa
// `TurnosModule` (para `SesionesGarzonService`/`GarzonesService`, Task 2/3):
// sin `forwardRef` acá y en `turnos.module.ts`/`caja.module.ts` los dos
// módulos quedarían esperándose entre sí al arrancar Nest.
import { CajaTestigoService } from '../caja/caja-testigo.service';
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

/**
 * `DataSource` y `EntityManager` cumplen esta forma. Mismo patrón que
 * `motivos-diferencia.service.ts` (`Runner`): permite que un caller con una
 * transacción abierta pase su `manager` en vez de forzar una conexión nueva
 * del pool.
 */
type Runner = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/** Vista pública de una sesión (inicio / cierre / activa). */
export interface SesionPublica {
  id: string;
  garzonId: string;
  garzonNombre: string;
  turnoId: string;
  turnoNombre: string;
  tipoGarzon: TipoGarzon;
  inicioEl: Date;
  finEl: Date | null;
  estado: EstadoSesionGarzon;
  origenCierre: OrigenCierreSesion | null;
  cerradaPorUsuarioId: string | null;
}

/**
 * Cuenta que quedó abierta a nombre del garzón cuando su sesión se cerró.
 *
 * Una cuenta solo se puede cobrar si su garzón responsable tiene sesión abierta
 * (`cerrarCuenta` la necesita para atribuir la propina al turno). Si el garzón
 * marca salida con mesas abiertas, esas mesas quedan sin poder cobrarse hasta
 * que alguien las transfiera — y no hace falta ninguna carrera para llegar ahí:
 * es el martes normal de un restaurante.
 *
 * Decisión del owner (2026-08-06): **el cierre de sesión no se bloquea.** El
 * garzón que terminó su jornada se va; lo que devuelve el cierre es la lista de
 * lo que dejó pendiente, para que la UI ofrezca transferirlo a alguien en turno.
 */
export interface CuentaPendienteGarzon {
  cuentaId: string;
  numero: number;
  mesaNombre: string;
  salonNombre: string;
}

/** Resultado de cerrar una sesión: la sesión + lo que quedó a su nombre. */
export interface SesionCerrada extends SesionPublica {
  cuentasPendientes: CuentaPendienteGarzon[];
}

/** Ítem de listado / historial con nombres. */
export interface SesionListaItem {
  id: string;
  garzonId: string;
  garzonNombre: string;
  turnoId: string;
  turnoNombre: string;
  tipoGarzon: TipoGarzon;
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
    private readonly db: Db,
    @Inject(forwardRef(() => CajaTestigoService))
    private readonly cajaTestigoService: CajaTestigoService,
  ) {}

  async iniciar(
    tenantId: string,
    usuarioId: string,
    dto: IniciarSesionDto,
  ): Promise<SesionPublica> {
    const garzon = await this.garzones.resolverGarzonActuante(
      tenantId,
      usuarioId,
      dto,
    );
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
      tipoGarzon: garzon.tipo ?? TipoGarzon.GARZON,
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

  async cerrarPropia(
    tenantId: string,
    usuarioId: string,
    credencial: { garzonId?: string; pin?: string },
  ): Promise<SesionCerrada> {
    const garzon = await this.garzones.resolverGarzonActuante(
      tenantId,
      usuarioId,
      credencial,
    );
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
    const guardada = await this.db.transaccion(async (manager) => {
      const guardada = await manager.save(SesionGarzon, abierta);
      // Una solicitud viva contra una sesión cerrada es un estado imposible
      // de honrar: la firma se valida contra esa sesión. Mismo `manager` que
      // el guardado de la sesión, para que las dos escrituras sean atómicas.
      await this.cajaTestigoService.caducarPorSesion(
        manager,
        tenantId,
        guardada.id,
      );
      return guardada;
    });

    const [{ turnoNombre }, cuentasPendientes] = await Promise.all([
      this.cargarNombres(tenantId, guardada.garzonId, guardada.turnoId),
      this.cuentasPendientes(tenantId, guardada.garzonId),
    ]);
    return {
      ...this.toPublico(guardada, garzon.nombre, turnoNombre),
      cuentasPendientes,
    };
  }

  async activaPropia(
    tenantId: string,
    usuarioId: string,
    credencial: { garzonId?: string; pin?: string },
  ): Promise<SesionPublica | null> {
    const garzon = await this.garzones.resolverGarzonActuante(
      tenantId,
      usuarioId,
      credencial,
    );
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
      garzon_nombre: string | null;
      turno_id: string;
      turno_nombre: string | null;
      tipo_garzon: TipoGarzon;
      inicio_el: Date;
      fin_el: Date | null;
      estado: EstadoSesionGarzon;
      origen_cierre: OrigenCierreSesion | null;
      cerrada_por_usuario_id: string | null;
    }[] = await this.db.query(
      `SELECT s.sesion_garzon_id,
              s.garzon_id,
              g.nombre AS garzon_nombre,
              s.turno_id,
              t.nombre AS turno_nombre,
              s.tipo_garzon,
              s.inicio_el,
              s.fin_el,
              s.estado,
              s.origen_cierre,
              s.cerrada_por_usuario_id
       FROM sesiones_garzon s
       LEFT JOIN garzones g ON g.garzon_id = s.garzon_id
         AND g.tenant_id = $1 AND g.eliminado_el IS NULL
       LEFT JOIN turnos t ON t.turno_id = s.turno_id
         AND t.tenant_id = $1 AND t.eliminado_el IS NULL
       WHERE s.tenant_id = $1
         AND s.estado = 'abierta'
         AND s.eliminado_el IS NULL
       ORDER BY s.inicio_el ASC`,
      [tenantId],
    );

    return rows.map((r) => this.mapListaRow(r));
  }

  /**
   * Cuenta de sesiones abiertas del tenant — corre sobre el `runner` que le
   * pasen, típicamente el `EntityManager` de una transacción en curso (ver
   * `CajaService.enviarConteo`). Toma el manager explícito en vez de `this.db`
   * (que hoy resolvería el mismo manager solo, vía el contexto ALS que puebla
   * `Db.transaccion`) porque esa firma es preexistente al mecanismo de
   * contexto — documenta a simple vista, sin depender de que el lector sepa
   * que hay un ALS activo, que esta lectura corre bajo el mismo `FOR UPDATE`
   * que el caller ya sostiene. Mismo filtro que `listarAbiertas`, sin los JOIN
   * de nombres: acá solo importa el número.
   */
  async contarAbiertas(runner: Runner, tenantId: string): Promise<number> {
    const rows = (await runner.query(
      `SELECT COUNT(*)::int AS total
         FROM sesiones_garzon
        WHERE tenant_id = $1
          AND estado = 'abierta'
          AND eliminado_el IS NULL`,
      [tenantId],
    )) as { total: number }[];
    return rows[0]?.total ?? 0;
  }

  async historial(
    tenantId: string,
    query: QuerySesionesDto,
  ): Promise<PaginatedResponse<SesionListaItem>> {
    const { page, pageSize, offset } = resolvePagination(query);
    // La zona solo se consulta si hay filtro de fecha: sin `desde`/`hasta` el
    // historial no la necesita y sería una query de más en cada listado.
    const zona =
      query.desde || query.hasta ? await this.zonaHoraria(tenantId) : null;
    const { filters, params } = this.buildHistorialFilters(
      tenantId,
      query,
      zona,
    );

    const countRows: { total: number }[] = await this.db.query(
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
      tipo_garzon: TipoGarzon;
      inicio_el: Date;
      fin_el: Date | null;
      estado: EstadoSesionGarzon;
      origen_cierre: OrigenCierreSesion | null;
      cerrada_por_usuario_id: string | null;
    }[] = await this.db.query(
      `SELECT s.sesion_garzon_id,
              s.garzon_id,
              g.nombre AS garzon_nombre,
              s.turno_id,
              t.nombre AS turno_nombre,
              s.tipo_garzon,
              s.inicio_el,
              s.fin_el,
              s.estado,
              s.origen_cierre,
              s.cerrada_por_usuario_id
       FROM sesiones_garzon s
       LEFT JOIN garzones g ON g.garzon_id = s.garzon_id
         AND g.tenant_id = $1 AND g.eliminado_el IS NULL
       LEFT JOIN turnos t ON t.turno_id = s.turno_id
         AND t.tenant_id = $1 AND t.eliminado_el IS NULL
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
  ): Promise<SesionCerrada> {
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
    const guardada = await this.db.transaccion(async (manager) => {
      const guardada = await manager.save(SesionGarzon, sesion);
      // Mismo motivo que en `cerrarPropia`: las dos vías de cierre de sesión
      // tienen que caducar las pendientes, o quedan vivas contra una sesión
      // que ya no existe para validar la firma.
      await this.cajaTestigoService.caducarPorSesion(
        manager,
        tenantId,
        guardada.id,
      );
      return guardada;
    });

    const [{ garzonNombre, turnoNombre }, cuentasPendientes] =
      await Promise.all([
        this.cargarNombres(tenantId, guardada.garzonId, guardada.turnoId),
        this.cuentasPendientes(tenantId, guardada.garzonId),
      ]);
    return {
      ...this.toPublico(guardada, garzonNombre, turnoNombre),
      cuentasPendientes,
    };
  }

  /** Gate de Salones: el garzón que opera tiene que estar en turno. */
  async assertSesionAbierta(tenantId: string, garzonId: string): Promise<void> {
    const abierta = await this.buscarSesionAbierta(tenantId, garzonId);
    if (!abierta) {
      throw new BadRequestException(
        'El garzón no tiene una sesión de trabajo abierta',
      );
    }
  }

  /**
   * La sesión abierta, o `null`. No tira 400 a propósito: el mensaje de
   * `assertSesionAbierta` habla del garzón que está operando, y hay llamadores
   * que preguntan por OTRO —`cerrarCuenta`, por el responsable de la cuenta— y
   * necesitan explicar de quién es la sesión que falta.
   */
  async buscarSesionAbierta(
    tenantId: string,
    garzonId: string,
  ): Promise<SesionGarzon | null> {
    return this.sesionRepo.findOne({
      where: { tenantId, garzonId, estado: EstadoSesionGarzon.ABIERTA },
    });
  }

  /**
   * Cuentas abiertas a nombre del garzón. Una sola query con los nombres ya
   * resueltos: la UI las lista tal cual para ofrecer la transferencia.
   *
   * Va por SQL y no por `SalonesService` porque la dependencia entre módulos
   * corre al revés (`SalonesModule` importa `TurnosModule`, no al revés), y
   * `cuenta-asignaciones` ya inyecta este service. Los JOIN son `LEFT` a
   * propósito: una cuenta abierta sobre una mesa borrada es justo la que no hay
   * que perder de vista, y un `JOIN` la escondería.
   */
  private async cuentasPendientes(
    tenantId: string,
    garzonId: string,
  ): Promise<CuentaPendienteGarzon[]> {
    const rows: {
      cuenta_id: string;
      numero: number;
      mesa_nombre: string | null;
      salon_nombre: string | null;
    }[] = await this.db.query(
      `SELECT c.cuenta_id,
              c.numero,
              m.nombre AS mesa_nombre,
              sa.nombre AS salon_nombre
         FROM cuentas c
         LEFT JOIN mesas m ON m.mesa_id = c.mesa_id
           AND m.tenant_id = $1 AND m.eliminado_el IS NULL
         LEFT JOIN salones sa ON sa.salon_id = m.salon_id
           AND sa.tenant_id = $1 AND sa.eliminado_el IS NULL
        WHERE c.tenant_id = $1
          AND c.garzon_responsable_id = $2
          AND c.estado = 'abierta'
          AND c.eliminado_el IS NULL
        ORDER BY sa.nombre ASC, m.nombre ASC, c.numero ASC`,
      [tenantId, garzonId],
    );

    return rows.map((r) => ({
      cuentaId: r.cuenta_id,
      numero: r.numero,
      mesaNombre: r.mesa_nombre ?? '',
      salonNombre: r.salon_nombre ?? '',
    }));
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
      tipoGarzon: s.tipoGarzon ?? TipoGarzon.GARZON,
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
    tipo_garzon: TipoGarzon;
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
      tipoGarzon: r.tipo_garzon ?? TipoGarzon.GARZON,
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
      await this.db.query(
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

  /**
   * Zona horaria del tenant, derivada del país de su provincia.
   *
   * Duplica el JOIN de `propina-reportes.service.ts` (segunda copia; la
   * convención del repo acepta duplicar dos veces). El filtro `eliminado_el` de
   * `provincia` y `pais` NO es decorativo: es lo que hace correcto al
   * boilerplate, y es justo lo que la entrada de backlog sobre este JOIN
   * advierte que un módulo nuevo puede olvidar.
   */
  private async zonaHoraria(tenantId: string): Promise<string> {
    const rows: { zona_horaria: string }[] = await this.db.query(
      `SELECT p.zona_horaria_principal AS zona_horaria
         FROM tenants t
         JOIN provincia pr
           ON pr.provincia_id = t.provincia_id
          AND pr.eliminado_el IS NULL
         JOIN pais p
           ON p.pais_id = pr.pais_id
          AND p.eliminado_el IS NULL
        WHERE t.tenant_id = $1
          AND t.eliminado_el IS NULL`,
      [tenantId],
    );
    if (!rows[0]?.zona_horaria) {
      throw new NotFoundException('No se encontró la zona horaria del tenant');
    }
    return rows[0].zona_horaria;
  }

  /**
   * `desde`/`hasta` llegan como fecha pura (`YYYY-MM-DD`, lo que emite
   * `AppDateInput`) y `s.inicio_el` es `timestamptz`. Comparar una contra otra
   * castea la fecha a **medianoche**, así que `<= hasta` excluía el día entero:
   * "Desde hoy / Hasta hoy" no devolvía **ninguna** sesión.
   *
   * Se interpretan en la **zona del tenant** y `hasta` es inclusivo del día
   * completo (`< hasta + 1 día`). ⚠️ Esta frase decía hasta el 2026-08-22 que
   * seguía "el patrón que `propina-reportes` ya usa": **no es cierto** —
   * `propina-reportes` filtra `< hasta` sin sumar el día, y quien compensa es su
   * llamador. El patrón bueno era éste, y desde el 2026-08-22 vive en
   * `common/utils/rango-fecha.util.ts` → `bordeHastaSql`, que es lo que usan
   * kardex, mermas y órdenes. Este método mantiene su SQL propio porque arma los
   * params con otro esquema de índices. La zona importa acá más que en un reporte
   * de oficina: con el cast en UTC, un tenant en Chile perdía las sesiones
   * entre las 20:00 y la medianoche local, que es cuando trabaja un
   * restaurante.
   *
   * Si `zonaHoraria` es `null` es porque no hay filtro de fecha que resolver.
   */
  private buildHistorialFilters(
    tenantId: string,
    query: QuerySesionesDto,
    zonaHoraria: string | null,
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
    if (query.desde || query.hasta) {
      if (zonaHoraria === null) {
        // Fail-fast: con `null` los filtros se descartarían en silencio y el
        // endpoint devolvería MÁS filas de las pedidas. Hoy `historial()` no
        // puede llegar acá; el assert es para que un refactor tampoco pueda.
        throw new Error(
          'buildHistorialFilters: hay filtro de fecha sin zona horaria resuelta',
        );
      }
      const zonaIdx = paramIdx++;
      params.push(zonaHoraria);
      if (query.desde) {
        filters += ` AND s.inicio_el >= ($${paramIdx}::date::timestamp AT TIME ZONE $${zonaIdx})`;
        params.push(query.desde);
        paramIdx++;
      }
      if (query.hasta) {
        filters += ` AND s.inicio_el < (($${paramIdx}::date + 1)::timestamp AT TIME ZONE $${zonaIdx})`;
        params.push(query.hasta);
        paramIdx++;
      }
    }

    return { filters, params };
  }
}
