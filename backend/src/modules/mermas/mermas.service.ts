import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { InventarioService } from '../inventario/inventario.service';
import { CatalogService } from '../catalog/catalog.service';
import { UbicacionesService } from '../ubicaciones/ubicaciones.service';
import { MotivosBajaService } from '../motivos-baja/motivos-baja.service';
import { TipoMotivoBaja } from '../motivos-baja/tipo-motivo-baja.enum';
import type { CostoPorMoneda } from '../salones/anulaciones-reporte.service';
import { CreateMermaDto } from './dto/create-merma.dto';
import { FindMermasDto } from './dto/find-mermas.dto';

export interface MermaResponse {
  movimientoId: string;
  stockResultante: string;
  costoUnitario: string | null;
  costoPerdido: string | null;
  motivoBajaNombre: string;
  /** Fila lista para upsert en el front (sin re-fetch). */
  merma: MermaListItem;
}

export interface MermaListItem {
  id: string;
  itemId: string;
  itemNombre: string;
  cantidad: string;
  costoUnitario: string | null;
  costoPerdido: string | null;
  motivoBajaId: string | null;
  motivoBajaNombre: string | null;
  comentario: string | null;
  creadoEl: Date;
  usuarioNombre: string | null;
  unidadMedida: string | null;
  /**
   * Moneda del ítem, no la oficial del tenant. El listado de mermas mezcla
   * ítems de distintas monedas igual que el kardex global: sin esto la UI
   * formatea todo costo con la oficial y un ítem importado en USD se lee como
   * si fueran pesos. Mismo motivo y misma solución que
   * `InventarioService` (kardex).
   */
  monedaId: string;
  /** El producto fue dado de baja después de esta merma. La fila se conserva. */
  itemEliminado: boolean;
  /**
   * `true` cuando el movimiento nace de anular un plato ya despachado en una
   * mesa (`movimientos_inventario.cuenta_linea_anulacion_id IS NOT NULL`), no
   * de una merma registrada por este módulo. La pantalla lo muestra con un
   * badge: es lo que hace visible que ese plato quemado también está en el
   * reporte de Anulaciones (`docs/features/salones-mesas.md`).
   */
  deAnulacion: boolean;
}

export interface ResumenMermas {
  /** Mermas del rango, valorizadas o no. */
  cantidad: number;
  /**
   * Σ por moneda DEL ÍTEM (`items.moneda_id`, como agrupa el reporte de
   * anulaciones), solo de las filas valorizadas. El número de cada fila es el
   * mismo que `costoPerdido` (`ROUND(cantidad * costo_unitario, 4)`).
   */
  costo: CostoPorMoneda[];
  /**
   * Cuántas quedaron con `costo_unitario IS NULL`: regla 6 de la spec del
   * costo sin tipear (`docs/agent/pendientes.md` § 3) — un `SUM` que ignora
   * esas filas informaría menos pérdida que la real sin decirlo. Esta entrada
   * NO se cierra con este método: sigue faltando un reporte de mermas
   * completo (listado agregable, filtros propios); esto es solo el bloque
   * que el dashboard de inicio necesita.
   */
  sinValorizar: number;
}

interface ResumenMermaRow {
  moneda_id: string;
  total_grupo: number;
  sin_valorizar_grupo: number;
  /** `null` cuando TODAS las filas del grupo (misma moneda) quedaron sin costo. */
  monto: string | null;
}

interface MermaRow {
  movimiento_id: string;
  item_id: string;
  // No nullable pese al `LEFT JOIN`: `movimientos_inventario.item_id` es
  // `NOT NULL REFERENCES items`. El LEFT solo saca el filtro de borrado.
  item_nombre: string;
  cantidad: string;
  costo_unitario: string | null;
  motivo_baja_id: string | null;
  motivo_baja_nombre: string | null;
  comentario: string | null;
  creado_el: Date;
  usuario_nombre: string | null;
  unidad_medida: string | null;
  moneda_id: string;
  item_eliminado: boolean;
  de_anulacion: boolean;
}

@Injectable()
export class MermasService {
  constructor(
    private readonly db: Db,
    private readonly inventarioService: InventarioService,
    private readonly catalogService: CatalogService,
    private readonly motivosBajaService: MotivosBajaService,
    private readonly ubicacionesService: UbicacionesService,
  ) {}

  async registrar(
    tenantId: string,
    usuarioId: string,
    dto: CreateMermaDto,
  ): Promise<MermaResponse> {
    return this.db.transaccion(async (manager) => {
      // Valida el `ubicacionId` del cliente ANTES del lock del ítem: si no es
      // del tenant, falla rápido sin haber tomado ningún lock. Mismo criterio
      // que `TrasladosService.crearEnTransaccion` con `origenId`/`destinoId`.
      await this.ubicacionesService.findOneOrFail(
        tenantId,
        dto.ubicacionId,
        manager,
      );

      // No selecciona `p.costo_actual`: este SELECT toma `FOR UPDATE OF i`
      // (lockea `items`, no `item_producto`), así que sería una lectura
      // pre-lock del costo — ver el comentario grande más abajo, donde
      // `registrar` usa en cambio `mov.costoActualPrevio`.
      const itemRows: {
        tipo: string;
        unidad_medida: string | null;
        modo_inventario: string | null;
        nombre: string;
        moneda_id: string;
      }[] = await manager.query(
        // `i.moneda_id`: la fila que este POST devuelve se inserta en el
        // listado sin refetch, así que sin la moneda del ítem la merma recién
        // creada se formatea con la oficial del tenant hasta que alguien
        // recargue. Mismo motivo que en el SELECT de `findAll`.
        `SELECT i.tipo, i.nombre, p.unidad_medida, p.modo_inventario,
                i.moneda_id
         FROM items i
         LEFT JOIN item_producto p ON p.item_id = i.item_id
         WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL
         FOR UPDATE OF i`,
        [dto.itemId, tenantId],
      );
      if (!itemRows.length) {
        throw new NotFoundException('Item no encontrado');
      }
      if (
        itemRows[0].tipo !== 'producto' &&
        itemRows[0].tipo !== 'ingrediente'
      ) {
        throw new BadRequestException(
          'Solo se puede mermar un producto o un ingrediente',
        );
      }

      const motivo = await this.motivosBajaService.assertMotivoActivo(
        manager,
        tenantId,
        dto.motivoBajaId,
      );

      // La pantalla de Mermas ya pide solo `tipo=merma`, pero el servidor es el que
      // manda: una cortesía o un "no se llegó a hacer" no son una merma de stock.
      if (motivo.tipo !== TipoMotivoBaja.MERMA) {
        throw new BadRequestException(
          `El motivo "${motivo.nombre}" no es de merma`,
        );
      }

      const cantidad = new Decimal(dto.cantidad);
      if (cantidad.lessThanOrEqualTo(0) || cantidad.isNaN()) {
        throw new BadRequestException('La cantidad debe ser mayor a cero');
      }
      let cantidadStr = cantidad.toString();

      const unidadBase = itemRows[0].unidad_medida ?? 'unidad';
      const huboConversion =
        !!dto.unidadCodigo && dto.unidadCodigo !== unidadBase;
      if (huboConversion) {
        if (itemRows[0].modo_inventario !== 'cantidad') {
          throw new BadRequestException(
            'Los productos por serie o lote solo admiten su unidad base',
          );
        }
        cantidadStr = await this.catalogService.convertirUnidad(
          cantidadStr,
          dto.unidadCodigo!,
          unidadBase,
        );
      }

      // El costo NO se tipea: sale del producto. No se pasa `costoUnitario` a
      // `registrarMovimiento` — que congele con su propia lectura, bajo
      // `FOR UPDATE OF ip` (inventario.service.ts:155), que es el chokepoint
      // real de `item_producto.costo_actual`. El SELECT de acá arriba toma
      // `FOR UPDATE OF i` — lockea `items`, no `item_producto`
      // (inventario.service.ts:134-137 explica por qué a propósito) — así que
      // `itemRows[0].costo_actual` es una lectura pre-lock: bajo READ
      // COMMITTED, una compra concurrente que commitea entre esta lectura y
      // el lock de `registrarMovimiento` ya cambió el valor ahí, y usar el
      // pre-lock acá desincroniza la respuesta del kardex (rompería la regla
      // 2 de la spec: lo que se guardó y lo que se muestra tienen que
      // coincidir). El congelado de la respuesta sale de
      // `mov.costoActualPrevio`, que sí se leyó bajo ese lock.
      // Ver docs/superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md
      const mov = await this.inventarioService.registrarMovimiento(manager, {
        tenantId,
        itemId: dto.itemId,
        ubicacionId: dto.ubicacionId,
        usuarioId,
        tipo: 'salida',
        motivo: 'merma',
        cantidad: cantidadStr,
        comentario: dto.comentario ?? null,
        motivoBajaId: dto.motivoBajaId,
      });

      const costoCongelado = mov.costoActualPrevio;
      // Proyección de lectura: cantidad × costo congelado del kardex, a escala de
      // costo (4). Nadie paga este número y no se persiste. Redondearlo con la config
      // vigente haría que el historial cambie al cambiar la preferencia del tenant;
      // el formateo a moneda es de presentación, no de acá.
      const costoPerdido =
        costoCongelado == null
          ? null
          : new Decimal(cantidadStr).mul(costoCongelado).toFixed(ESCALA_COSTO);

      return {
        movimientoId: mov.movimientoId,
        stockResultante: mov.stockResultante,
        costoUnitario: costoCongelado,
        costoPerdido,
        motivoBajaNombre: motivo.nombre,
        merma: {
          id: mov.movimientoId,
          itemId: dto.itemId,
          itemNombre: itemRows[0].nombre,
          cantidad: cantidadStr,
          costoUnitario: costoCongelado,
          costoPerdido,
          motivoBajaId: dto.motivoBajaId,
          motivoBajaNombre: motivo.nombre,
          comentario: dto.comentario ?? null,
          creadoEl: new Date(),
          usuarioNombre: null,
          unidadMedida: itemRows[0].unidad_medida,
          monedaId: itemRows[0].moneda_id,
          // El SELECT de arriba exige `eliminado_el IS NULL`: no se puede mermar
          // un producto dado de baja, así que la fila recién creada nunca nace
          // marcada. Solo llega a `true` releyendo el listado tras la baja.
          itemEliminado: false,
          // `registrarMovimiento` acá arriba nunca recibe `cuentaLineaAnulacionId`:
          // este POST es la merma de bodega, no la anulación de una línea en
          // mesa (esa vive en `SalonesService.escribirAnulacionDeLinea`).
          deAnulacion: false,
        },
      };
    });
  }

  async findAll(
    tenantId: string,
    query: FindMermasDto,
  ): Promise<PaginatedResponse<MermaListItem>> {
    const { page, pageSize, offset } = resolvePagination(query);
    // Solo si hay borde de fecha que expandir: ver `rango-fecha.util.ts`.
    const zona = requiereZonaTenant(query.desde, query.hasta)
      ? await zonaHorariaTenant(this.db, tenantId)
      : null;
    const { filters, params } = this.buildFilters(tenantId, query, zona);

    // El `EXISTS` de acá abajo es la condición que EXCLUYE la cortesía, y va
    // en las DOS consultas (COUNT y página) para que el total no se mueva sin
    // avisar (Task 4, spec § 5.2). No puede vivir en el `LEFT JOIN mb` de más
    // abajo: ese JOIN es LEFT a propósito para no perder la fila cuando el
    // motivo se borró (mermas-valorizadas.md, "El listado sobrevive a la baja
    // del producto" — mismo criterio con el motivo), y sumarle `AND mb.tipo =
    // 'merma'` ahí dejaría pasar la cortesía con `motivo_baja_nombre: null`
    // en vez de sacarla. Tampoco filtra `eliminado_el` sobre `motivo_baja`: un
    // motivo en uso no se puede borrar (`motivos-baja.service.ts`), así que
    // esta condición no depende de esa columna.
    //
    // Sin filtro de borrado del ítem, y en las DOS consultas: una merma
    // registrada es plata perdida que ya ocurrió, así que dar de baja el
    // producto después no puede borrarla del informe ni —peor— bajar el total
    // sin avisar. Mismo criterio que el kardex (`InventarioService`).
    const filtroTipoMerma = this.filtroTipoMerma();

    const countRows: { total: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total
       FROM movimientos_inventario mv
       LEFT JOIN items i ON i.item_id = mv.item_id
       WHERE mv.tenant_id = $1 AND mv.eliminado_el IS NULL
         AND mv.motivo = 'merma'
         ${filtroTipoMerma}
         ${filters}`,
      params,
    );

    const total = countRows[0]?.total ?? 0;
    const listParams = [...params, pageSize, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows: MermaRow[] = await this.db.query(
      `SELECT
         mv.movimiento_id, mv.item_id, i.nombre AS item_nombre,
         mv.cantidad, mv.costo_unitario,
         mv.motivo_baja_id, mb.nombre AS motivo_baja_nombre,
         mv.comentario, mv.creado_el, u.nombre AS usuario_nombre,
         p.unidad_medida, i.moneda_id,
         (i.eliminado_el IS NOT NULL) AS item_eliminado,
         (mv.cuenta_linea_anulacion_id IS NOT NULL) AS de_anulacion
       FROM movimientos_inventario mv
       LEFT JOIN items i ON i.item_id = mv.item_id
       LEFT JOIN item_producto p ON p.item_id = mv.item_id
       LEFT JOIN usuarios u ON u.usuario_id = mv.usuario_id AND u.eliminado_el IS NULL
       LEFT JOIN motivo_baja mb ON mb.motivo_baja_id = mv.motivo_baja_id AND mb.eliminado_el IS NULL
       WHERE mv.tenant_id = $1 AND mv.eliminado_el IS NULL
         AND mv.motivo = 'merma'
         ${filtroTipoMerma}
         ${filters}
       ORDER BY mv.creado_el DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );

    return {
      data: rows.map((r) => this.mapRow(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  private buildFilters(
    tenantId: string,
    query: FindMermasDto,
    zona: string | null,
  ): { filters: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let filters = '';

    let idxZona = 0;
    if (zona != null) {
      params.push(zona);
      idxZona = params.length;
    }

    if (query.itemId) {
      params.push(query.itemId);
      filters += ` AND mv.item_id = $${params.length}`;
    }
    if (query.motivoBajaId) {
      params.push(query.motivoBajaId);
      filters += ` AND mv.motivo_baja_id = $${params.length}`;
    }
    if (query.desde) {
      params.push(query.desde);
      filters += bordeFechaSql(
        'mv.creado_el',
        '>=',
        query.desde,
        params.length,
        idxZona,
      );
    }
    if (query.hasta) {
      params.push(query.hasta);
      filters += bordeHastaSql(
        'mv.creado_el',
        query.hasta,
        params.length,
        idxZona,
      );
    }

    return { filters, params };
  }

  /**
   * La condición que EXCLUYE la cortesía (desde `2e1fad74`), compartida por
   * `findAll` (Task 4, spec § 5.2) y `resumen` (Task 2, spec
   * 2026-09-18-dashboard-inicio § 4.4): un mismo motivo puede tener tipo
   * `merma`, `cortesia` o `no_elaborado`, y solo el primero es plata perdida
   * de bodega. No cuelga de un `LEFT JOIN … AND mb.tipo = 'merma'`: ese JOIN
   * es LEFT a propósito para no perder la fila cuando el motivo se borró, y
   * agregarle el tipo ahí dejaría pasar la cortesía con `motivo_baja_nombre:
   * null` en vez de sacarla (ver el comentario grande de `findAll`).
   */
  private filtroTipoMerma(): string {
    return `AND EXISTS (
         SELECT 1 FROM motivo_baja mbf
         WHERE mbf.motivo_baja_id = mv.motivo_baja_id AND mbf.tipo = 'merma'
       )`;
  }

  /**
   * `perdidas.mermas` del dashboard de inicio (Task 2, spec
   * 2026-09-18-dashboard-inicio § 4.4/§ 5.1): cantidad de mermas del rango,
   * costo por moneda (solo las valorizadas) y cuántas quedaron sin valorizar.
   * UNA sola consulta agregada por `items.moneda_id` —igual que
   * `AnulacionesReporteService.cargarCostosPorAnulacion`—, sin importar
   * cuántas mermas haya en el rango: la fila sin costo aporta a
   * `sinValorizar`, nunca a `costo` (regla 6 de la spec del costo sin tipear,
   * `pendientes.md` § 3 — un `SUM` que la ignorara informaría menos pérdida
   * que la real sin decirlo).
   */
  async resumen(
    tenantId: string,
    desde: string,
    hasta: string,
  ): Promise<ResumenMermas> {
    // Mismo criterio que `buildFilters`: solo se resuelve la zona si hace
    // falta expandir una fecha pura (`requiereZonaTenant`).
    const zona = requiereZonaTenant(desde, hasta)
      ? await zonaHorariaTenant(this.db, tenantId)
      : null;

    const params: unknown[] = [tenantId];
    let idxZona = 0;
    if (zona != null) {
      params.push(zona);
      idxZona = params.length;
    }
    params.push(desde);
    const bordeDesde = bordeFechaSql(
      'mv.creado_el',
      '>=',
      desde,
      params.length,
      idxZona,
    );
    params.push(hasta);
    const bordeHasta = bordeHastaSql(
      'mv.creado_el',
      hasta,
      params.length,
      idxZona,
    );

    const rows: ResumenMermaRow[] = await this.db.query(
      `SELECT i.moneda_id,
              COUNT(*)::int AS total_grupo,
              COUNT(*) FILTER (WHERE mv.costo_unitario IS NULL)::int
                AS sin_valorizar_grupo,
              SUM(ROUND(mv.cantidad * mv.costo_unitario, 4))
                FILTER (WHERE mv.costo_unitario IS NOT NULL) AS monto
         FROM movimientos_inventario mv
         -- Sin filtro de borrado del ítem: una merma registrada es plata
         -- perdida que ya ocurrió, así que dar de baja el producto después
         -- no puede sacarla del bloque de pérdidas ni bajar el total sin
         -- avisar (mismo criterio que findAll, arriba).
         LEFT JOIN items i ON i.item_id = mv.item_id
        WHERE mv.tenant_id = $1 AND mv.eliminado_el IS NULL
          AND mv.motivo = 'merma'
          ${this.filtroTipoMerma()}
          ${bordeDesde}${bordeHasta}
        GROUP BY i.moneda_id`,
      params,
    );

    let cantidad = 0;
    let sinValorizar = 0;
    const costo: CostoPorMoneda[] = [];
    for (const r of rows) {
      cantidad += r.total_grupo;
      sinValorizar += r.sin_valorizar_grupo;
      if (r.monto != null) {
        costo.push({ monedaId: r.moneda_id, monto: r.monto });
      }
    }
    return { cantidad, costo, sinValorizar };
  }

  private mapRow(r: MermaRow): MermaListItem {
    return {
      id: r.movimiento_id,
      itemId: r.item_id,
      itemNombre: r.item_nombre,
      cantidad: r.cantidad,
      costoUnitario: r.costo_unitario,
      // Proyección de lectura: cantidad × costo congelado del kardex, a escala de
      // costo (4). Nadie paga este número y no se persiste. Redondearlo con la config
      // vigente haría que el historial cambie al cambiar la preferencia del tenant;
      // el formateo a moneda es de presentación, no de acá.
      costoPerdido:
        r.costo_unitario != null
          ? new Decimal(r.cantidad).mul(r.costo_unitario).toFixed(ESCALA_COSTO)
          : null,
      motivoBajaId: r.motivo_baja_id,
      motivoBajaNombre: r.motivo_baja_nombre,
      comentario: r.comentario,
      creadoEl: r.creado_el,
      usuarioNombre: r.usuario_nombre,
      unidadMedida: r.unidad_medida,
      monedaId: r.moneda_id,
      itemEliminado: r.item_eliminado,
      deAnulacion: r.de_anulacion,
    };
  }
}
