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
import { CausasMermaService } from './causas-merma.service';
import { CreateMermaDto } from './dto/create-merma.dto';
import { FindMermasDto } from './dto/find-mermas.dto';

export interface MermaResponse {
  movimientoId: string;
  stockResultante: string;
  costoUnitario: string | null;
  costoPerdido: string | null;
  causaNombre: string;
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
  causaMermaId: string | null;
  causaNombre: string | null;
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
}

interface MermaRow {
  movimiento_id: string;
  item_id: string;
  // No nullable pese al `LEFT JOIN`: `movimientos_inventario.item_id` es
  // `NOT NULL REFERENCES items`. El LEFT solo saca el filtro de borrado.
  item_nombre: string;
  cantidad: string;
  costo_unitario: string | null;
  causa_merma_id: string | null;
  causa_nombre: string | null;
  comentario: string | null;
  creado_el: Date;
  usuario_nombre: string | null;
  unidad_medida: string | null;
  moneda_id: string;
  item_eliminado: boolean;
}

@Injectable()
export class MermasService {
  constructor(
    private readonly db: Db,
    private readonly inventarioService: InventarioService,
    private readonly catalogService: CatalogService,
    private readonly causasService: CausasMermaService,
  ) {}

  async registrar(
    tenantId: string,
    usuarioId: string,
    dto: CreateMermaDto,
  ): Promise<MermaResponse> {
    return this.db.transaccion(async (manager) => {
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

      const causa = await this.causasService.assertCausaActiva(
        manager,
        tenantId,
        dto.causaMermaId,
      );

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
        usuarioId,
        tipo: 'salida',
        motivo: 'merma',
        cantidad: cantidadStr,
        comentario: dto.comentario ?? null,
        causaMermaId: dto.causaMermaId,
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
        causaNombre: causa.nombre,
        merma: {
          id: mov.movimientoId,
          itemId: dto.itemId,
          itemNombre: itemRows[0].nombre,
          cantidad: cantidadStr,
          costoUnitario: costoCongelado,
          costoPerdido,
          causaMermaId: dto.causaMermaId,
          causaNombre: causa.nombre,
          comentario: dto.comentario ?? null,
          creadoEl: new Date(),
          usuarioNombre: null,
          unidadMedida: itemRows[0].unidad_medida,
          monedaId: itemRows[0].moneda_id,
          // El SELECT de arriba exige `eliminado_el IS NULL`: no se puede mermar
          // un producto dado de baja, así que la fila recién creada nunca nace
          // marcada. Solo llega a `true` releyendo el listado tras la baja.
          itemEliminado: false,
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

    // Sin filtro de borrado del ítem, y en las DOS consultas: una merma
    // registrada es plata perdida que ya ocurrió, así que dar de baja el
    // producto después no puede borrarla del informe ni —peor— bajar el total
    // sin avisar. Mismo criterio que el kardex (`InventarioService`).
    const countRows: { total: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total
       FROM movimientos_inventario mv
       LEFT JOIN items i ON i.item_id = mv.item_id
       WHERE mv.tenant_id = $1 AND mv.eliminado_el IS NULL
         AND mv.motivo = 'merma'
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
         mv.causa_merma_id, cm.nombre AS causa_nombre,
         mv.comentario, mv.creado_el, u.nombre AS usuario_nombre,
         p.unidad_medida, i.moneda_id,
         (i.eliminado_el IS NOT NULL) AS item_eliminado
       FROM movimientos_inventario mv
       LEFT JOIN items i ON i.item_id = mv.item_id
       LEFT JOIN item_producto p ON p.item_id = mv.item_id
       LEFT JOIN usuarios u ON u.usuario_id = mv.usuario_id AND u.eliminado_el IS NULL
       LEFT JOIN causas_merma cm ON cm.causa_merma_id = mv.causa_merma_id AND cm.eliminado_el IS NULL
       WHERE mv.tenant_id = $1 AND mv.eliminado_el IS NULL
         AND mv.motivo = 'merma'
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
    if (query.causaMermaId) {
      params.push(query.causaMermaId);
      filters += ` AND mv.causa_merma_id = $${params.length}`;
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
      causaMermaId: r.causa_merma_id,
      causaNombre: r.causa_nombre,
      comentario: r.comentario,
      creadoEl: r.creado_el,
      usuarioNombre: r.usuario_nombre,
      unidadMedida: r.unidad_medida,
      monedaId: r.moneda_id,
      itemEliminado: r.item_eliminado,
    };
  }
}
