import { BadRequestException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import { ESCALA_COSTO } from '../../common/constants/escalas';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';
import {
  bordeFechaSql,
  bordeHastaSql,
  diaNegocioTenant,
  empujarDiaNegocio,
  requiereDiaNegocio,
  type DiaNegocio,
} from '../../common/utils/rango-fecha.util';
import { TipoMotivoBaja } from '../motivos-baja/tipo-motivo-baja.enum';
import { FindAnulacionesDto } from './dto/find-anulaciones.dto';
import { ResumenAnulacionesDto } from './dto/resumen-anulaciones.dto';

/**
 * Lo que `buildFilters` necesita de cualquiera de los dos DTOs del reporte.
 * `FindAnulacionesDto` (listado, `desde`/`hasta` opcionales) y
 * `ResumenAnulacionesDto` (resumen, obligatorios) califican los dos: un campo
 * requerido es asignable a uno opcional, así que no hace falta que ninguno de
 * los dos extienda al otro.
 */
interface FiltrosAnulacionesQuery {
  desde?: string;
  hasta?: string;
  garzonId?: string;
  motivoBajaId?: string;
  tipo?: TipoMotivoBaja;
}

export type CostoEstado = 'valorizado' | 'no_aplica' | 'sin_valorizar';

export interface CostoPorMoneda {
  monedaId: string;
  monto: string;
}

export interface GrupoResumen {
  /** Σ `cantidad` de las filas del grupo, a la escala de `cantidad` (4). */
  platos: string;
  /** Σ del `precioCarta` YA REDONDEADO de cada fila, nunca `ROUND(Σ…)` (spec § 4). */
  precioCarta: string;
  /** Σ por moneda, solo de las filas `valorizado` (una `sin_valorizar` no suma acá). */
  costo: CostoPorMoneda[];
  /** Cuántas anulaciones del grupo quedaron `sin_valorizar`. `no_aplica` no cuenta. */
  sinValorizar: number;
}

export interface ResumenAnulaciones {
  porTipo: (GrupoResumen & { tipo: TipoMotivoBaja })[];
  porGarzon: (GrupoResumen & {
    garzonId: string | null;
    garzonNombre: string | null;
  })[];
  porAutorizo: (GrupoResumen & { usuarioId: string; usuarioNombre: string })[];
}

export interface AnulacionReporteItem {
  id: string;
  creadoEl: Date;
  cuentaId: string;
  cuentaNumero: number;
  mesaNombre: string;
  salonNombre: string;
  itemNombre: string;
  cantidad: string;
  motivoBajaNombre: string;
  tipo: TipoMotivoBaja;
  garzonNombre: string | null;
  autorizadoPorNombre: string;
  /** cantidad × precio_unitario congelado, a ESCALA_COSTO. Nunca `number`. */
  precioCarta: string;
  costoEstado: CostoEstado;
  /** [] si `costoEstado` es `no_aplica` o `sin_valorizar`. Nunca convertido de moneda. */
  costo: CostoPorMoneda[];
}

interface AnulacionRow {
  id: string;
  creado_el: Date;
  cuenta_id: string;
  cuenta_numero: number;
  mesa_nombre: string;
  salon_nombre: string;
  item_nombre: string;
  cantidad: string;
  precio_unitario: string;
  motivo_baja_nombre: string;
  tipo: TipoMotivoBaja;
  garzon_nombre: string | null;
  autorizado_por_nombre: string;
}

/** Fila cruda de la consulta base del resumen: sin paginar, todo el rango. */
interface ResumenBaseRow {
  id: string;
  cantidad: string;
  precio_unitario: string;
  tipo: TipoMotivoBaja;
  garzon_id: string | null;
  garzon_nombre: string | null;
  usuario_id: string;
  usuario_nombre: string;
}

/** Acumulador en memoria de un grupo del resumen, antes de formatear a `GrupoResumen`. */
interface AcumuladorGrupo {
  meta: Record<string, unknown>;
  platos: Decimal;
  precioCarta: Decimal;
  costoPorMoneda: Map<string, Decimal>;
  sinValorizar: number;
}

interface CostoGrupoRow {
  cuenta_linea_anulacion_id: string;
  moneda_id: string;
  monto: string;
  falta_costo: boolean;
}

interface CostoGrupo {
  monedaId: string;
  monto: string;
  faltaCosto: boolean;
}

// Los mismos JOINs, con el mismo porqué en cada excepción de borrado, se
// repiten en el COUNT y en la página (spec § 5.1: los dos tienen que ver lo
// mismo, para que el total no se mueva sin avisar entre las dos consultas).
const JOINS_BASE = `
       FROM cuenta_linea_anulaciones cla
       JOIN motivo_baja mb ON mb.motivo_baja_id = cla.motivo_baja_id AND mb.eliminado_el IS NULL
       -- Garzón SIN filtro de borrado: la anulación ya pasó, y dar de baja al
       -- garzón después no puede sacarlo del reporte ni bajar el total sin
       -- avisar (mismo criterio que Mermas con el producto eliminado).
       LEFT JOIN garzones g ON g.garzon_id = cla.garzon_id
       -- Usuario que autorizó, SIN filtro de borrado: mismo porqué que el garzón.
       JOIN usuarios u ON u.usuario_id = cla.autorizado_por
       -- Cuenta, mesa y salón, SIN filtro de borrado: es algo que ya pasó, y
       -- borrarlos después no puede sacar la fila del reporte.
       JOIN cuentas c ON c.cuenta_id = cla.cuenta_id
       JOIN mesas m ON m.mesa_id = c.mesa_id
       JOIN salones s ON s.salon_id = m.salon_id
      WHERE cla.tenant_id = $1 AND cla.eliminado_el IS NULL`;

@Injectable()
export class AnulacionesReporteService {
  /**
   * Tope de la DIFERENCIA entre `desde` y `hasta` en `resumen()` (ronda de
   * fix 1): 366 días en ms. No es el tope de días calendario que el resumen
   * puede llegar a cubrir — ver el docblock de `validarRangoResumen`.
   */
  private static readonly TOPE_RANGO_RESUMEN_MS = 366 * 24 * 60 * 60 * 1000;

  constructor(private readonly db: Db) {}

  /**
   * Rango de `resumen()`: `hasta` no puede ser anterior a `desde`, y la
   * DIFERENCIA entre los dos no puede superar 366 días — mismo tope que
   * `propinas/dto/query-propina-reporte.dto.ts`, mismo motivo (dos consultas
   * SIN `LIMIT` sobre todo el rango). Corre ANTES de cualquier consulta.
   *
   * ⚠️ **366 días de diferencia no es 366 días calendario cubiertos.** Con
   * fechas PURAS (`2026-01-01`, sin hora) y `hasta` INCLUSIVO
   * (`bordeHastaSql`, que le suma un día a `hasta` antes de comparar — igual
   * que el listado), el rango efectivo que la consulta SQL termina trayendo
   * es de hasta **367 días calendario**: `desde` 1-ene, `hasta` 1-ene+366
   * cubre del 1 de enero al 2 de enero del año siguiente inclusive, 367 días.
   * Es la diferencia LITERAL entre los dos valores la que no puede superar
   * 366 días — no el día calendario cubierto —, y así queda dicho en el
   * mensaje del 400. Decisión del owner (ronda de fix 2): no cambiar la
   * lógica —el tope ya es coherente con el criterio "`hasta` inclusivo" del
   * resto del reporte—, solo que el texto no prometa un número que el
   * comportamiento no cumple.
   *
   * Mide el INSTANTE tal cual llega (`Date.parse`), no el día calendario de
   * la zona del tenant: si `desde`/`hasta` traen hora (`@IsDateString()` la
   * permite), el tope se mide sobre esa hora exacta. La zona del tenant sí
   * se usa más abajo, pero solo para expandir una fecha PURA a la consulta
   * SQL (`bordeFechaSql`/`bordeHastaSql`), no para este chequeo.
   *
   * A diferencia de `normalizarRangoReporte` (propinas), donde `hasta` es
   * EXCLUSIVO y rechaza `hasta <= desde`: acá `hasta` es INCLUSIVO
   * (`bordeHastaSql`, igual que el listado), así que `desde === hasta` es
   * válido — la pantalla lo arma para pedir "hoy" con el mismo día en las
   * dos puntas.
   */
  private validarRangoResumen(desde: string, hasta: string): void {
    const desdeMs = Date.parse(desde);
    const hastaMs = Date.parse(hasta);
    if (!Number.isFinite(desdeMs) || !Number.isFinite(hastaMs)) {
      throw new BadRequestException('desde/hasta deben ser fechas válidas');
    }
    if (hastaMs < desdeMs) {
      throw new BadRequestException('hasta no puede ser anterior a desde');
    }
    if (hastaMs - desdeMs > AnulacionesReporteService.TOPE_RANGO_RESUMEN_MS) {
      throw new BadRequestException(
        'La diferencia entre desde y hasta no puede superar 366 días',
      );
    }
  }

  async findAll(
    tenantId: string,
    query: FindAnulacionesDto,
  ): Promise<PaginatedResponse<AnulacionReporteItem>> {
    const { page, pageSize, offset } = resolvePagination(query);
    // Solo si hay borde de fecha que expandir: ver `rango-fecha.util.ts`.
    const dia = requiereDiaNegocio(query.desde, query.hasta)
      ? await diaNegocioTenant(this.db, tenantId)
      : null;
    const { filters, params } = this.buildFilters(tenantId, query, dia);

    const countRows: { total: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total ${JOINS_BASE}
         ${filters}`,
      params,
    );
    const total = countRows[0]?.total ?? 0;

    const listParams = [...params, pageSize, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows: AnulacionRow[] = await this.db.query(
      `SELECT
         cla.cuenta_linea_anulacion_id AS id, cla.creado_el, cla.cuenta_id,
         c.numero AS cuenta_numero, m.nombre AS mesa_nombre, s.nombre AS salon_nombre,
         cla.item_nombre, cla.cantidad, cla.precio_unitario,
         mb.nombre AS motivo_baja_nombre, mb.tipo,
         g.nombre AS garzon_nombre, u.nombre AS autorizado_por_nombre
       ${JOINS_BASE}
         ${filters}
       ORDER BY cla.creado_el DESC, cla.cuenta_linea_anulacion_id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );

    // `no_elaborado` nunca tiene movimientos (no descuenta stock): se filtra
    // ANTES del `ANY($2)` de la consulta de costo en vez de confiar en que el
    // JOIN vuelva vacío solo — así la consulta de costo no se pide para nada
    // cuando la página es toda `no_elaborado`.
    const idsConCosto = rows
      .filter((r) => r.tipo !== TipoMotivoBaja.NO_ELABORADO)
      .map((r) => r.id);
    const costosPorAnulacion = await this.cargarCostosPorAnulacion(
      tenantId,
      idsConCosto,
    );

    return {
      data: rows.map((r) => this.mapRow(r, costosPorAnulacion.get(r.id))),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  /**
   * El `WHERE` de filtros (sin tenant ni soft-delete de `cla`, que ya van en
   * `JOINS_BASE`). Compartido por `findAll` (`FindAnulacionesDto`, rango
   * opcional) y `resumen` (`ResumenAnulacionesDto`, rango obligatorio, Task
   * 3) vía `FiltrosAnulacionesQuery` — el tipo de `query` acá es esa
   * interfaz, no ninguno de los dos DTOs concretos. `dia` ya viene resuelto
   * por el llamador.
   */
  private buildFilters(
    tenantId: string,
    query: FiltrosAnulacionesQuery,
    dia: DiaNegocio | null,
  ): { filters: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let filters = '';

    const idxDia = dia ? empujarDiaNegocio(params, dia) : null;

    if (query.tipo) {
      params.push(query.tipo);
      filters += ` AND mb.tipo = $${params.length}`;
    }
    if (query.garzonId) {
      params.push(query.garzonId);
      filters += ` AND cla.garzon_id = $${params.length}`;
    }
    if (query.motivoBajaId) {
      params.push(query.motivoBajaId);
      filters += ` AND cla.motivo_baja_id = $${params.length}`;
    }
    if (query.desde) {
      params.push(query.desde);
      filters += bordeFechaSql(
        'cla.creado_el',
        '>=',
        query.desde,
        params.length,
        idxDia,
      );
    }
    if (query.hasta) {
      params.push(query.hasta);
      filters += bordeHastaSql(
        'cla.creado_el',
        query.hasta,
        params.length,
        idxDia,
      );
    }

    return { filters, params };
  }

  /**
   * Costo de cada anulación, agregado por moneda en UNA sola consulta para
   * todas las de la página (spec § 5.1: "nunca una consulta por fila").
   * `no_elaborado` no entra en `anulacionIds` (filtrado por el llamador).
   */
  private async cargarCostosPorAnulacion(
    tenantId: string,
    anulacionIds: string[],
  ): Promise<Map<string, CostoGrupo[]>> {
    const grupos = new Map<string, CostoGrupo[]>();
    if (anulacionIds.length === 0) {
      return grupos;
    }

    const rows: CostoGrupoRow[] = await this.db.query(
      `SELECT mv.cuenta_linea_anulacion_id, i.moneda_id,
              SUM(ROUND(mv.cantidad * mv.costo_unitario, 4)) AS monto,
              bool_or(mv.costo_unitario IS NULL)             AS falta_costo
         FROM movimientos_inventario mv
         JOIN items i ON i.item_id = mv.item_id -- sin filtro de borrado del ítem: ya pasó
        WHERE mv.tenant_id = $1 AND mv.eliminado_el IS NULL
          AND mv.cuenta_linea_anulacion_id = ANY($2)
        GROUP BY 1, 2`,
      [tenantId, anulacionIds],
    );

    for (const r of rows) {
      const lista = grupos.get(r.cuenta_linea_anulacion_id) ?? [];
      lista.push({
        monedaId: r.moneda_id,
        monto: r.monto,
        faltaCosto: r.falta_costo,
      });
      grupos.set(r.cuenta_linea_anulacion_id, lista);
    }
    return grupos;
  }

  /**
   * `cantidad × precio_unitario`, YA REDONDEADO a `ESCALA_COSTO`: es la
   * cifra que muestra cada fila del listado y la que suma el resumen (spec §
   * 4: `Σ ROUND(...)`, no `ROUND(Σ...)`). Proyección de lectura: nadie paga
   * este número y no se persiste. Redondearlo con la config vigente del
   * tenant haría que el historial cambie al cambiar esa preferencia.
   */
  private precioCartaDeFila(cantidad: string, precioUnitario: string): string {
    return new Decimal(cantidad).mul(precioUnitario).toFixed(ESCALA_COSTO);
  }

  /**
   * El estado del costo de una fila y su desglose por moneda, compartido por
   * `mapRow` (Task 2) y `resumen` (Task 3): mismo criterio de los tres
   * estados en los dos lugares, sin duplicarlo.
   */
  private resolverCosto(
    tipo: TipoMotivoBaja,
    grupos: CostoGrupo[] | undefined,
  ): { costoEstado: CostoEstado; costo: CostoPorMoneda[] } {
    if (tipo === TipoMotivoBaja.NO_ELABORADO) {
      return { costoEstado: 'no_aplica', costo: [] };
    }
    if (grupos?.some((g) => g.faltaCosto)) {
      // Sin valorizar: la fila entera se marca, nunca una cifra parcial que
      // parezca completa (spec § 4).
      return { costoEstado: 'sin_valorizar', costo: [] };
    }
    // Incluye el hueco conocido (spec § 4): una merma/cortesía SIN ningún
    // movimiento (ingredientes todos borrados) cae acá, con `costo: []` — no
    // se inventa un cuarto estado para ese caso.
    return {
      costoEstado: 'valorizado',
      costo: (grupos ?? []).map((g) => ({
        monedaId: g.monedaId,
        monto: g.monto,
      })),
    };
  }

  /**
   * `GET /salones/anulaciones/resumen` (spec § 5.1). Cubre TODO el rango
   * filtrado, no una página: dos consultas fijas, sin importar cuántas filas
   * haya en el rango —esta (sin `LIMIT`/`OFFSET`, mismos `JOINS_BASE` +
   * `buildFilters` que `findAll`) y `cargarCostosPorAnulacion` reutilizada
   * tal cual, con TODOS los ids del rango en vez de los de una página—. Se
   * agrupa en memoria porque el costo de cada fila ya viene resuelto por
   * `resolverCosto` (mismo criterio que el listado: una fila `sin_valorizar`
   * no aporta a `costo`, y `no_aplica` no aporta a `sinValorizar`) y no hay
   * forma de expresar eso en un solo `GROUP BY` de SQL sin duplicar esa
   * lógica en la consulta.
   */
  async resumen(
    tenantId: string,
    query: ResumenAnulacionesDto,
  ): Promise<ResumenAnulaciones> {
    // Primero que nada, antes de cualquier consulta: sin esto, las dos de
    // abajo corren sin `LIMIT` sobre el historial entero del tenant (ronda de
    // fix 1, hallazgo de la revisión de seguridad).
    this.validarRangoResumen(query.desde, query.hasta);

    const dia = requiereDiaNegocio(query.desde, query.hasta)
      ? await diaNegocioTenant(this.db, tenantId)
      : null;
    const { filters, params } = this.buildFilters(tenantId, query, dia);

    const rows: ResumenBaseRow[] = await this.db.query(
      `SELECT
         cla.cuenta_linea_anulacion_id AS id, cla.cantidad, cla.precio_unitario,
         mb.tipo,
         cla.garzon_id, g.nombre AS garzon_nombre,
         cla.autorizado_por AS usuario_id, u.nombre AS usuario_nombre
       ${JOINS_BASE}
         ${filters}`,
      params,
    );

    const idsConCosto = rows
      .filter((r) => r.tipo !== TipoMotivoBaja.NO_ELABORADO)
      .map((r) => r.id);
    const costosPorAnulacion = await this.cargarCostosPorAnulacion(
      tenantId,
      idsConCosto,
    );

    const porTipo = new Map<string, AcumuladorGrupo>();
    const porGarzon = new Map<string, AcumuladorGrupo>();
    const porAutorizo = new Map<string, AcumuladorGrupo>();
    const SIN_GARZON = '__sin_garzon__';

    for (const r of rows) {
      const { costoEstado, costo } = this.resolverCosto(
        r.tipo,
        costosPorAnulacion.get(r.id),
      );
      const cantidad = new Decimal(r.cantidad);
      const precioCartaFila = this.precioCartaDeFila(
        r.cantidad,
        r.precio_unitario,
      );

      this.acumular(
        porTipo,
        r.tipo,
        { tipo: r.tipo },
        cantidad,
        precioCartaFila,
        costoEstado,
        costo,
      );
      this.acumular(
        porGarzon,
        r.garzon_id ?? SIN_GARZON,
        { garzonId: r.garzon_id, garzonNombre: r.garzon_nombre },
        cantidad,
        precioCartaFila,
        costoEstado,
        costo,
      );
      this.acumular(
        porAutorizo,
        r.usuario_id,
        { usuarioId: r.usuario_id, usuarioNombre: r.usuario_nombre },
        cantidad,
        precioCartaFila,
        costoEstado,
        costo,
      );
    }

    return {
      porTipo: [...porTipo.values()].map((a) =>
        this.cerrarGrupo<{ tipo: TipoMotivoBaja }>(a),
      ),
      porGarzon: [...porGarzon.values()].map((a) =>
        this.cerrarGrupo<{
          garzonId: string | null;
          garzonNombre: string | null;
        }>(a),
      ),
      porAutorizo: [...porAutorizo.values()].map((a) =>
        this.cerrarGrupo<{ usuarioId: string; usuarioNombre: string }>(a),
      ),
    };
  }

  /** Acumula una fila del resumen en el grupo `clave` de `mapa`, creándolo si falta. */
  private acumular(
    mapa: Map<string, AcumuladorGrupo>,
    clave: string,
    meta: Record<string, unknown>,
    cantidad: Decimal,
    precioCartaFila: string,
    costoEstado: CostoEstado,
    costo: CostoPorMoneda[],
  ): void {
    let acc = mapa.get(clave);
    if (!acc) {
      acc = {
        meta,
        platos: new Decimal(0),
        precioCarta: new Decimal(0),
        costoPorMoneda: new Map<string, Decimal>(),
        sinValorizar: 0,
      };
      mapa.set(clave, acc);
    }
    acc.platos = acc.platos.plus(cantidad);
    acc.precioCarta = acc.precioCarta.plus(precioCartaFila);
    if (costoEstado === 'sin_valorizar') {
      acc.sinValorizar += 1;
    } else {
      for (const c of costo) {
        acc.costoPorMoneda.set(
          c.monedaId,
          (acc.costoPorMoneda.get(c.monedaId) ?? new Decimal(0)).plus(c.monto),
        );
      }
    }
  }

  private cerrarGrupo<T extends Record<string, unknown>>(
    acc: AcumuladorGrupo,
  ): GrupoResumen & T {
    return {
      ...(acc.meta as T),
      platos: acc.platos.toFixed(ESCALA_COSTO),
      precioCarta: acc.precioCarta.toFixed(ESCALA_COSTO),
      costo: [...acc.costoPorMoneda].map(([monedaId, monto]) => ({
        monedaId,
        monto: monto.toFixed(ESCALA_COSTO),
      })),
      sinValorizar: acc.sinValorizar,
    };
  }

  private mapRow(
    r: AnulacionRow,
    grupos: CostoGrupo[] | undefined,
  ): AnulacionReporteItem {
    const precioCarta = this.precioCartaDeFila(r.cantidad, r.precio_unitario);
    const { costoEstado, costo } = this.resolverCosto(r.tipo, grupos);

    return {
      id: r.id,
      creadoEl: r.creado_el,
      cuentaId: r.cuenta_id,
      cuentaNumero: r.cuenta_numero,
      mesaNombre: r.mesa_nombre,
      salonNombre: r.salon_nombre,
      itemNombre: r.item_nombre,
      cantidad: r.cantidad,
      motivoBajaNombre: r.motivo_baja_nombre,
      tipo: r.tipo,
      garzonNombre: r.garzon_nombre,
      autorizadoPorNombre: r.autorizado_por_nombre,
      precioCarta,
      costoEstado,
      costo,
    };
  }
}
