import { Injectable } from '@nestjs/common';
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
  requiereZonaTenant,
  zonaHorariaTenant,
} from '../../common/utils/rango-fecha.util';
import { TipoMotivoBaja } from '../motivos-baja/tipo-motivo-baja.enum';
import { FindAnulacionesDto } from './dto/find-anulaciones.dto';

export type CostoEstado = 'valorizado' | 'no_aplica' | 'sin_valorizar';

export interface CostoPorMoneda {
  monedaId: string;
  monto: string;
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
  constructor(private readonly db: Db) {}

  async findAll(
    tenantId: string,
    query: FindAnulacionesDto,
  ): Promise<PaginatedResponse<AnulacionReporteItem>> {
    const { page, pageSize, offset } = resolvePagination(query);
    // Solo si hay borde de fecha que expandir: ver `rango-fecha.util.ts`.
    const zona = requiereZonaTenant(query.desde, query.hasta)
      ? await zonaHorariaTenant(this.db, tenantId)
      : null;
    const { filters, params } = this.buildFilters(tenantId, query, zona);

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
   * `JOINS_BASE`). Reutilizable por el resumen (Task 3): arma el mismo
   * `FindAnulacionesDto` sin paginar, así que llama a este mismo método con
   * `zona` ya resuelta por el llamador.
   */
  private buildFilters(
    tenantId: string,
    query: FindAnulacionesDto,
    zona: string | null,
  ): { filters: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let filters = '';

    let idxZona = 0;
    if (zona != null) {
      params.push(zona);
      idxZona = params.length;
    }

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
        idxZona,
      );
    }
    if (query.hasta) {
      params.push(query.hasta);
      filters += bordeHastaSql(
        'cla.creado_el',
        query.hasta,
        params.length,
        idxZona,
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

  private mapRow(
    r: AnulacionRow,
    grupos: CostoGrupo[] | undefined,
  ): AnulacionReporteItem {
    // Proyección de lectura: nadie paga este número y no se persiste.
    // Redondearlo con la config vigente del tenant haría que el historial
    // cambie al cambiar esa preferencia (spec § 4).
    const precioCarta = new Decimal(r.cantidad)
      .mul(r.precio_unitario)
      .toFixed(ESCALA_COSTO);

    let costoEstado: CostoEstado;
    let costo: CostoPorMoneda[];
    if (r.tipo === TipoMotivoBaja.NO_ELABORADO) {
      costoEstado = 'no_aplica';
      costo = [];
    } else if (grupos?.some((g) => g.faltaCosto)) {
      // Sin valorizar: la fila entera se marca, nunca una cifra parcial que
      // parezca completa (spec § 4).
      costoEstado = 'sin_valorizar';
      costo = [];
    } else {
      // Incluye el hueco conocido (spec § 4): una merma/cortesía SIN ningún
      // movimiento (ingredientes todos borrados) cae acá, con `costo: []` —
      // no se inventa un cuarto estado para ese caso.
      costoEstado = 'valorizado';
      costo = (grupos ?? []).map((g) => ({
        monedaId: g.monedaId,
        monto: g.monto,
      }));
    }

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
