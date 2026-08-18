import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, QueryFailedError } from 'typeorm';
import { Db } from '../../common/db/db.service';
import Decimal from 'decimal.js';
import { unwrap } from '../../common/utils/pg-returning.util';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';
import { CreateRecuentoDto } from './dto/create-recuento.dto';
import { UpdateRecuentoDto } from './dto/update-recuento.dto';
import { UpdateRecuentoLineaDto } from './dto/update-recuento-linea.dto';
import { FindRecuentosDto } from './dto/find-recuentos.dto';
import { MotivosDiferenciaInventarioService } from '../motivos-diferencia-inventario/motivos-diferencia-inventario.service';
import { InventarioService } from '../inventario/inventario.service';

interface ItemParaRecuentoRow {
  item_id: string;
  nombre: string;
  tipo: string;
  stock: string;
  modo_inventario: string;
  unidad_medida: string;
}

interface RecuentoListRow {
  recuento_id: string;
  estado: string;
  comentario: string | null;
  creado_el: Date;
  aplicado_el: Date | null;
  cantidad_lineas: number;
  diferencia_neta: string;
  usuario_creador_nombre: string | null;
}

interface RecuentoRow {
  recuento_id: string;
  estado: string;
  motivo_diferencia_default_id: string | null;
  comentario: string | null;
  creado_el: Date;
  aplicado_el: Date | null;
}

interface RecuentoLineaRow {
  linea_id: string;
  item_id: string;
  // Nullable por el `LEFT JOIN` con condición de tenant, igual que en `aplicar`:
  // el nombre falta solo si el ítem no es del tenant de la línea, que el modelo
  // no permite. La línea del ítem eliminado SÍ trae nombre — el LEFT saca el
  // filtro de borrado, no la fila.
  item_nombre: string | null;
  item_eliminado: boolean;
  unidad_medida: string | null;
  stock_sistema: string;
  cantidad_contada: string | null;
  motivo_diferencia_id: string | null;
}

interface RecuentoLineaUpdateRow {
  linea_id: string;
  item_id: string;
  stock_sistema: string;
  cantidad_contada: string | null;
  motivo_diferencia_id: string | null;
}

interface RecuentoAplicarSesionRow {
  recuento_id: string;
  estado: string;
  motivo_diferencia_default_id: string | null;
  comentario: string | null;
}

interface RecuentoAplicarLineaRow {
  linea_id: string;
  item_id: string;
  item_nombre: string | null;
  item_eliminado_el: Date | null;
  stock_sistema: string;
  cantidad_contada: string | null;
  motivo_diferencia_id: string | null;
  modo_inventario: string | null;
}

export interface RecuentoListItem {
  id: string;
  estado: string;
  comentario: string | null;
  creadoEl: Date;
  aplicadoEl: Date | null;
  cantidadLineas: number;
  diferenciaNeta: string;
  usuarioCreadorNombre: string | null;
}

export interface RecuentoLinea {
  lineaId: string;
  itemId: string;
  itemNombre: string | null;
  /**
   * El producto se eliminó con la sesión abierta. La línea se muestra igual,
   * marcada: `aplicar` la va a descartar e informar en `lineasDescartadas`, y el
   * que está contando ve por qué le sobra una respecto del listado.
   */
  itemEliminado: boolean;
  unidadMedida: string | null;
  stockSistema: string;
  cantidadContada: string | null;
  diferencia: string | null;
  motivoDiferenciaId: string | null;
}

export interface RecuentoDetalle {
  id: string;
  estado: string;
  motivoDiferenciaDefaultId: string | null;
  comentario: string | null;
  creadoEl: Date;
  aplicadoEl: Date | null;
  lineas: RecuentoLinea[];
}

export interface RecuentoLineaActualizada {
  lineaId: string;
  itemId: string;
  stockSistema: string;
  cantidadContada: string | null;
  diferencia: string | null;
  motivoDiferenciaId: string | null;
}

export interface RecuentoLineaDescartada {
  itemId: string;
  itemNombre: string;
  razon: string;
}

export interface RecuentoAplicarResultado {
  recuentoId: string;
  lineasAplicadas: number;
  lineasDescartadas: RecuentoLineaDescartada[];
}

@Injectable()
export class RecuentosService {
  constructor(
    private readonly db: Db,
    private readonly motivosDiferenciaInventarioService: MotivosDiferenciaInventarioService,
    private readonly inventarioService: InventarioService,
  ) {}

  async create(
    tenantId: string,
    usuarioId: string,
    dto: CreateRecuentoDto,
  ): Promise<{ id: string }> {
    if (!dto.itemIds.length) {
      throw new BadRequestException(
        'El recuento necesita al menos un producto',
      );
    }

    return this.db.transaccion(async (manager: EntityManager) => {
      // Una sola query trae todos los items pedidos con su stock vigente —
      // nunca una query por item.
      const rows: ItemParaRecuentoRow[] = await manager.query(
        `SELECT i.item_id, i.nombre, i.tipo, p.stock, p.modo_inventario, p.unidad_medida
           FROM items i
           JOIN item_producto p ON p.item_id = i.item_id
          WHERE i.item_id = ANY($1) AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
        [dto.itemIds, tenantId],
      );

      const rowsPorItemId = new Map(rows.map((r) => [r.item_id, r]));
      for (const itemId of dto.itemIds) {
        if (!rowsPorItemId.has(itemId)) {
          throw new BadRequestException('El item no tiene control de stock');
        }
      }
      for (const row of rows) {
        if (row.modo_inventario !== 'cantidad') {
          throw new BadRequestException(
            `El recuento solo admite productos por cantidad: ${row.nombre}`,
          );
        }
      }

      // Un producto no puede estar en dos recuentos en `borrador` a la vez.
      //
      // **El escenario, con números:** stock de sistema 10. Dos personas abren
      // su propia sesión y las dos cuentan 8. Cada línea congela su
      // `stock_sistema` al crearse y el ajuste se aplica como delta relativo,
      // así que cada sesión guarda −2 y aplicar las dos deja el stock en 6, no
      // en 8: el faltante real se descuenta dos veces y se inventa uno que no
      // existió. Dos conteos simultáneos del mismo producto no tienen sentido
      // operativo.
      //
      // ⚠️ El delta congelado NO se toca: recalcular contra el stock del momento
      // de aplicar se descartó, y el comentario que llama al delta "el corazón
      // del diseño" sigue vigente. Lo que se bloquea es la segunda sesión.
      //
      // ⚠️ **Esto es check-then-act y no lo respalda ningún índice**: dos
      // `create()` simultáneos con el mismo ítem pasan los dos. El único índice
      // único que existe es `(recuento_id, item_id)`, o sea DENTRO de una
      // sesión. Cerrar esa carrera es trabajo de la tanda de concurrencia
      // (sección 5 de `pendientes.md`), no de acá — pero el guard cubre el caso
      // real, que es una persona abriendo una sesión cuando ya hay otra.
      const enBorrador: {
        item_id: string;
        nombre: string;
        recuento_id: string;
      }[] = await manager.query(
        `SELECT l.item_id, i.nombre, l.recuento_id
             FROM recuento_inventario_linea l
             JOIN recuento_inventario r
               ON r.recuento_id = l.recuento_id
              AND r.tenant_id = l.tenant_id
              AND r.estado = 'borrador'
              AND r.eliminado_el IS NULL
             JOIN items i
               ON i.item_id = l.item_id
              AND i.tenant_id = l.tenant_id
              AND i.eliminado_el IS NULL
            WHERE l.item_id = ANY($1) AND l.tenant_id = $2
              AND l.eliminado_el IS NULL
            ORDER BY i.nombre ASC`,
        [dto.itemIds, tenantId],
      );
      // Sin `LIMIT 1`: con varios productos en conflicto, quedarse con el
      // primero que devuelva Postgres nombra uno arbitrario y el usuario saca
      // ese de la lista para chocar de nuevo con el siguiente. Se listan todos.
      if (enBorrador.length) {
        const detalle = enBorrador
          .map((c) => `${c.nombre} (recuento ${c.recuento_id})`)
          .join(', ');
        throw new BadRequestException(
          `Estos productos ya están en un recuento en borrador: ${detalle}. ` +
            'Aplicá o cancelá esa(s) sesión(es) antes de incluirlos en otra.',
        );
      }

      const sesionRows = unwrap<{ recuento_id: string }>(
        await manager.query(
          `INSERT INTO recuento_inventario (tenant_id, usuario_creador_id, comentario)
           VALUES ($1, $2, $3)
           RETURNING recuento_id`,
          [tenantId, usuarioId, dto.comentario ?? null],
        ),
      );
      const recuentoId = sesionRows[0].recuento_id;

      // Un solo INSERT multi-fila para todas las líneas.
      const values: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      for (const itemId of dto.itemIds) {
        const row = rowsPorItemId.get(itemId)!;
        values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        params.push(tenantId, recuentoId, itemId, row.stock);
      }
      await manager.query(
        `INSERT INTO recuento_inventario_linea (tenant_id, recuento_id, item_id, stock_sistema)
         VALUES ${values.join(', ')}`,
        params,
      );

      return { id: recuentoId };
    });
  }

  async findAll(
    tenantId: string,
    query: FindRecuentosDto,
  ): Promise<PaginatedResponse<RecuentoListItem>> {
    const { page, pageSize, offset } = resolvePagination(query);

    const estadoFilter = query.estado ? ' AND r.estado = $2' : '';
    const countParams = query.estado ? [tenantId, query.estado] : [tenantId];

    const countRows: { total: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total FROM recuento_inventario r
        WHERE r.tenant_id = $1 AND r.eliminado_el IS NULL${estadoFilter}`,
      countParams,
    );
    const total = countRows[0]?.total ?? 0;

    const listParams = query.estado
      ? [tenantId, query.estado, pageSize, offset]
      : [tenantId, pageSize, offset];
    const limitIdx = query.estado ? 3 : 2;
    const offsetIdx = query.estado ? 4 : 3;

    const rows: RecuentoListRow[] = await this.db.query(
      `SELECT r.recuento_id, r.estado, r.comentario, r.creado_el, r.aplicado_el,
              u.nombre AS usuario_creador_nombre,
              COUNT(l.linea_id)::int AS cantidad_lineas,
              COALESCE(SUM(
                CASE WHEN l.cantidad_contada IS NOT NULL
                     THEN l.cantidad_contada - l.stock_sistema
                     ELSE 0
                END
              ), 0) AS diferencia_neta
         FROM recuento_inventario r
         LEFT JOIN recuento_inventario_linea l
           ON l.recuento_id = r.recuento_id AND l.eliminado_el IS NULL
         LEFT JOIN usuarios u
           ON u.usuario_id = r.usuario_creador_id AND u.eliminado_el IS NULL
        WHERE r.tenant_id = $1 AND r.eliminado_el IS NULL${estadoFilter}
        GROUP BY r.recuento_id, u.nombre
        ORDER BY r.creado_el DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );

    return {
      data: rows.map((r) => ({
        id: r.recuento_id,
        estado: r.estado,
        comentario: r.comentario,
        creadoEl: r.creado_el,
        aplicadoEl: r.aplicado_el,
        cantidadLineas: r.cantidad_lineas,
        diferenciaNeta: new Decimal(r.diferencia_neta).toFixed(4),
        usuarioCreadorNombre: r.usuario_creador_nombre,
      })),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async findOne(
    tenantId: string,
    recuentoId: string,
  ): Promise<RecuentoDetalle> {
    const sesionRows: RecuentoRow[] = await this.db.query(
      `SELECT recuento_id, estado, motivo_diferencia_default_id, comentario, creado_el, aplicado_el
         FROM recuento_inventario
        WHERE recuento_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [recuentoId, tenantId],
    );
    if (!sesionRows.length) {
      throw new NotFoundException(`Recuento ${recuentoId} no encontrado`);
    }
    const sesion = sesionRows[0];

    // Mismo `LEFT JOIN` sin filtro de borrado que usa `aplicar`, y por la misma
    // razón: si el ítem se elimina con la sesión en `borrador`, filtrarlo acá
    // hacía desaparecer la línea del detalle sin aviso mientras `findAll` la
    // seguía contando en `cantidadLineas` — el listado decía 12 y el detalle
    // mostraba 11. La línea se muestra marcada, que es lo que `aplicar` ya hace
    // al descartarla e informarla en `lineasDescartadas`.
    const lineaRows: RecuentoLineaRow[] = await this.db.query(
      `SELECT l.linea_id, l.item_id, i.nombre AS item_nombre, p.unidad_medida,
              (i.eliminado_el IS NOT NULL) AS item_eliminado,
              l.stock_sistema, l.cantidad_contada, l.motivo_diferencia_id
         FROM recuento_inventario_linea l
         LEFT JOIN items i ON i.item_id = l.item_id AND i.tenant_id = l.tenant_id
         LEFT JOIN item_producto p ON p.item_id = l.item_id
        WHERE l.recuento_id = $1 AND l.tenant_id = $2 AND l.eliminado_el IS NULL
        ORDER BY i.nombre ASC`,
      [recuentoId, tenantId],
    );

    return {
      id: sesion.recuento_id,
      estado: sesion.estado,
      motivoDiferenciaDefaultId: sesion.motivo_diferencia_default_id,
      comentario: sesion.comentario,
      creadoEl: sesion.creado_el,
      aplicadoEl: sesion.aplicado_el,
      lineas: lineaRows.map((l) => ({
        lineaId: l.linea_id,
        itemId: l.item_id,
        itemNombre: l.item_nombre,
        itemEliminado: l.item_eliminado,
        unidadMedida: l.unidad_medida,
        stockSistema: l.stock_sistema,
        cantidadContada: l.cantidad_contada,
        diferencia:
          l.cantidad_contada != null
            ? new Decimal(l.cantidad_contada).minus(l.stock_sistema).toFixed(4)
            : null,
        motivoDiferenciaId: l.motivo_diferencia_id,
      })),
    };
  }

  async updateLinea(
    tenantId: string,
    recuentoId: string,
    lineaId: string,
    dto: UpdateRecuentoLineaDto,
  ): Promise<RecuentoLineaActualizada> {
    if (
      dto.cantidadContada !== undefined &&
      dto.cantidadContada !== null &&
      new Decimal(dto.cantidadContada).lessThan(0)
    ) {
      throw new BadRequestException(
        'La cantidad contada no puede ser negativa',
      );
    }

    return this.db.transaccion(async (manager: EntityManager) => {
      await this.assertBorrador(manager, tenantId, recuentoId);

      // null explícito significa "limpiar el override de línea" — solo se
      // valida contra el catálogo cuando llega un id de verdad. `!== undefined`
      // a secas dejaba pasar null y lo validaba igual, y ningún motivo matchea
      // `WHERE motivo_diferencia_inventario_id = NULL` en Postgres: la limpieza
      // fallaba siempre con 400.
      if (
        dto.motivoDiferenciaId !== undefined &&
        dto.motivoDiferenciaId !== null
      ) {
        await this.motivosDiferenciaInventarioService.assertMotivoActivo(
          manager,
          tenantId,
          dto.motivoDiferenciaId,
        );
      }

      const sets = ['actualizado_el = NOW()'];
      const params: unknown[] = [];
      let idx = 1;

      if (dto.cantidadContada !== undefined) {
        sets.push(`cantidad_contada = $${idx++}`);
        params.push(
          dto.cantidadContada === null
            ? null
            : new Decimal(dto.cantidadContada).toFixed(4),
        );
      }
      if (dto.motivoDiferenciaId !== undefined) {
        sets.push(`motivo_diferencia_id = $${idx++}`);
        params.push(dto.motivoDiferenciaId);
      }

      params.push(lineaId, recuentoId, tenantId);
      const rows = unwrap<RecuentoLineaUpdateRow>(
        await manager.query(
          `UPDATE recuento_inventario_linea SET ${sets.join(', ')}
           WHERE linea_id = $${idx++} AND recuento_id = $${idx++} AND tenant_id = $${idx} AND eliminado_el IS NULL
           RETURNING linea_id, item_id, stock_sistema, cantidad_contada, motivo_diferencia_id`,
          params,
        ),
      );
      if (!rows.length) {
        throw new NotFoundException(`Línea ${lineaId} no encontrada`);
      }
      const l = rows[0];
      return {
        lineaId: l.linea_id,
        itemId: l.item_id,
        stockSistema: l.stock_sistema,
        cantidadContada: l.cantidad_contada,
        diferencia:
          l.cantidad_contada != null
            ? new Decimal(l.cantidad_contada).minus(l.stock_sistema).toFixed(4)
            : null,
        motivoDiferenciaId: l.motivo_diferencia_id,
      };
    });
  }

  async update(
    tenantId: string,
    recuentoId: string,
    dto: UpdateRecuentoDto,
  ): Promise<{ id: string }> {
    return this.db.transaccion(async (manager: EntityManager) => {
      await this.assertBorrador(manager, tenantId, recuentoId);

      // Mismo criterio que updateLinea: null explícito limpia la causa por
      // defecto de la sesión sin pasar por la validación del catálogo.
      if (
        dto.motivoDiferenciaDefaultId !== undefined &&
        dto.motivoDiferenciaDefaultId !== null
      ) {
        await this.motivosDiferenciaInventarioService.assertMotivoActivo(
          manager,
          tenantId,
          dto.motivoDiferenciaDefaultId,
        );
      }

      const sets = ['actualizado_el = NOW()'];
      const params: unknown[] = [];
      let idx = 1;

      if (dto.motivoDiferenciaDefaultId !== undefined) {
        sets.push(`motivo_diferencia_default_id = $${idx++}`);
        params.push(dto.motivoDiferenciaDefaultId);
      }
      if (dto.comentario !== undefined) {
        sets.push(`comentario = $${idx++}`);
        params.push(dto.comentario);
      }

      params.push(recuentoId, tenantId);
      const rows = unwrap<{ recuento_id: string }>(
        await manager.query(
          `UPDATE recuento_inventario SET ${sets.join(', ')}
           WHERE recuento_id = $${idx++} AND tenant_id = $${idx} AND eliminado_el IS NULL
           RETURNING recuento_id`,
          params,
        ),
      );
      return { id: rows[0].recuento_id };
    });
  }

  async cancelar(
    tenantId: string,
    recuentoId: string,
  ): Promise<{ id: string; estado: string }> {
    return this.db.transaccion(async (manager: EntityManager) => {
      await this.assertBorrador(manager, tenantId, recuentoId);

      const rows = unwrap<{ recuento_id: string; estado: string }>(
        await manager.query(
          `UPDATE recuento_inventario SET estado = 'cancelado', actualizado_el = NOW()
           WHERE recuento_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
           RETURNING recuento_id, estado`,
          [recuentoId, tenantId],
        ),
      );
      return { id: rows[0].recuento_id, estado: rows[0].estado };
    });
  }

  // Aplicar lockea los item_producto en orden de item_id; una venta simultánea
  // lockea los mismos en el orden del carrito, que arma el cliente. Con órdenes
  // incompatibles Postgres detecta el ciclo y aborta una de las dos (40P01).
  // Reintentar una vez es seguro —el rollback dejó la transacción sin ningún
  // efecto— y no le impone a ventas un orden de locks que sus recetas y combos
  // no pueden garantizar de todos modos.
  async aplicar(
    tenantId: string,
    usuarioId: string,
    recuentoId: string,
  ): Promise<RecuentoAplicarResultado> {
    try {
      return await this.aplicarEnTransaccion(tenantId, usuarioId, recuentoId);
    } catch (error) {
      if (
        !(error instanceof QueryFailedError) ||
        (error as { code?: string }).code !== '40P01'
      ) {
        throw error;
      }
      return this.aplicarEnTransaccion(tenantId, usuarioId, recuentoId);
    }
  }

  // El corazón del diseño: la diferencia es un delta, no un absoluto. El
  // stock_sistema quedó congelado al crear la línea; entre ese momento y
  // aplicar puede haber movimiento real (ventas, otros ajustes). Aplicar el
  // delta sobre el stock VIGENTE (que registrarMovimiento lee bajo FOR
  // UPDATE) preserva ese movimiento intermedio; setear un absoluto lo
  // pisaría.
  private aplicarEnTransaccion(
    tenantId: string,
    usuarioId: string,
    recuentoId: string,
  ): Promise<RecuentoAplicarResultado> {
    return this.db.transaccion(async (manager: EntityManager) => {
      const sesionRows: RecuentoAplicarSesionRow[] = await manager.query(
        `SELECT recuento_id, estado, motivo_diferencia_default_id, comentario
           FROM recuento_inventario
          WHERE recuento_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
          FOR UPDATE`,
        [recuentoId, tenantId],
      );
      if (!sesionRows.length) {
        throw new NotFoundException(`Recuento ${recuentoId} no encontrado`);
      }
      const sesion = sesionRows[0];
      if (sesion.estado === 'aplicado') {
        throw new BadRequestException('El recuento ya fue aplicado');
      }
      if (sesion.estado === 'cancelado') {
        throw new BadRequestException('El recuento fue cancelado');
      }

      // LEFT JOIN sin filtrar eliminado_el a propósito: necesitamos detectar
      // el item eliminado (o inexistente) para descartar la línea, no
      // excluirla silenciosamente de la lectura.
      const lineaRows: RecuentoAplicarLineaRow[] = await manager.query(
        `SELECT l.linea_id, l.item_id, i.nombre AS item_nombre,
                i.eliminado_el AS item_eliminado_el,
                l.stock_sistema, l.cantidad_contada, l.motivo_diferencia_id,
                p.modo_inventario
           FROM recuento_inventario_linea l
           LEFT JOIN items i ON i.item_id = l.item_id AND i.tenant_id = l.tenant_id
           LEFT JOIN item_producto p ON p.item_id = l.item_id
          WHERE l.recuento_id = $1 AND l.tenant_id = $2 AND l.eliminado_el IS NULL
          ORDER BY l.item_id`,
        [recuentoId, tenantId],
      );

      const lineasDescartadas: RecuentoLineaDescartada[] = [];
      const lineasAAplicar: {
        lineaId: string;
        itemId: string;
        itemNombre: string;
        delta: Decimal;
        motivoId: string;
      }[] = [];

      // Primera pasada: valida y calcula todo antes de mover stock. Si falta
      // una causa en cualquier línea, el error llega sin haber tocado nada.
      for (const l of lineaRows) {
        if (l.item_nombre == null || l.item_eliminado_el != null) {
          lineasDescartadas.push({
            itemId: l.item_id,
            itemNombre: l.item_nombre ?? l.item_id,
            razon: 'El producto fue eliminado',
          });
          continue;
        }
        if (l.cantidad_contada == null) continue;

        const delta = new Decimal(l.cantidad_contada).minus(l.stock_sistema);
        if (delta.isZero()) continue;

        // El modo se validó al crear la sesión, pero un producto sin
        // movimientos puede cambiarlo mientras el recuento está en borrador.
        // Sin esto el error llega desde el kardex ("faltan las series") sin
        // decir qué línea lo causó, y en un conteo de decenas es inservible.
        if (l.modo_inventario !== 'cantidad') {
          throw new BadRequestException(
            `"${l.item_nombre}" cambió a modo ${l.modo_inventario ?? 'desconocido'} desde que se creó el recuento: no se puede aplicar por cantidad`,
          );
        }

        const motivoId =
          l.motivo_diferencia_id ?? sesion.motivo_diferencia_default_id;
        if (!motivoId) {
          throw new BadRequestException(
            `Falta la causa de la diferencia para "${l.item_nombre}"`,
          );
        }

        lineasAAplicar.push({
          lineaId: l.linea_id,
          itemId: l.item_id,
          itemNombre: l.item_nombre,
          delta,
          motivoId,
        });
      }

      // La causa se validó contra el catálogo al asignarla (updateLinea/update),
      // pero pudo desactivarse o eliminarse entre ese momento y aplicar — el
      // FK no filtra eliminado_el, así que sin esta segunda validación un
      // motivo muerto quedaría congelado en el kardex. Una sola query batcheada
      // por los motivoId distintos, nunca una por línea (N+1).
      if (lineasAAplicar.length) {
        const motivoIds = [...new Set(lineasAAplicar.map((l) => l.motivoId))];
        const motivosActivos: { motivo_diferencia_inventario_id: string }[] =
          await manager.query(
            // FOR SHARE, no un SELECT suelto: sin el lock, un DELETE o una
            // desactivación del motivo puede colarse entre esta validación y
            // los INSERT del kardex de abajo. Los servicios del catálogo lo
            // toman con FOR UPDATE, así que quedan a la espera del commit.
            `SELECT motivo_diferencia_inventario_id
               FROM motivo_diferencia_inventario
              WHERE motivo_diferencia_inventario_id = ANY($1) AND tenant_id = $2
                AND activo = true AND eliminado_el IS NULL
              FOR SHARE`,
            [motivoIds, tenantId],
          );
        const activos = new Set(
          motivosActivos.map((m) => m.motivo_diferencia_inventario_id),
        );
        if (motivoIds.some((id) => !activos.has(id))) {
          throw new BadRequestException(
            'La causa de diferencia asignada ya no está activa',
          );
        }
      }

      for (const linea of lineasAAplicar) {
        let mov: { movimientoId: string };
        try {
          mov = await this.inventarioService.registrarMovimiento(manager, {
            tenantId,
            itemId: linea.itemId,
            usuarioId,
            tipo: linea.delta.isPositive() ? 'entrada' : 'salida',
            motivo: 'recuento',
            cantidad: linea.delta.abs().toFixed(4),
            motivoDiferenciaId: linea.motivoId,
            comentario: sesion.comentario ?? null,
          });
        } catch (error) {
          // El mensaje genérico del kardex no dice cuál línea lo bloqueó — en
          // un recuento de decenas de productos eso es inutilizable para el
          // operador. Lo renombramos con el producto de esta línea; cualquier
          // otro error se propaga tal cual.
          if (
            error instanceof BadRequestException &&
            error.message === 'Stock insuficiente para la salida'
          ) {
            throw new BadRequestException(
              `Stock insuficiente para aplicar la diferencia de "${linea.itemNombre}"`,
            );
          }
          throw error;
        }

        await manager.query(
          `UPDATE recuento_inventario_linea SET movimiento_id = $1, actualizado_el = NOW()
           WHERE linea_id = $2 AND tenant_id = $3 AND eliminado_el IS NULL`,
          [mov.movimientoId, linea.lineaId, tenantId],
        );
      }

      await manager.query(
        `UPDATE recuento_inventario
            SET estado = 'aplicado', usuario_aplicador_id = $1, aplicado_el = NOW(), actualizado_el = NOW()
          WHERE recuento_id = $2 AND tenant_id = $3 AND eliminado_el IS NULL`,
        [usuarioId, recuentoId, tenantId],
      );

      return {
        recuentoId,
        lineasAplicadas: lineasAAplicar.length,
        lineasDescartadas,
      };
    });
  }

  // Solo 'borrador' admite modificaciones: 'aplicado' y 'cancelado' son
  // terminales. La usan updateLinea, update y cancelar antes de mutar.
  private async assertBorrador(
    manager: EntityManager,
    tenantId: string,
    recuentoId: string,
  ): Promise<void> {
    const rows: { estado: string }[] = await manager.query(
      `SELECT estado FROM recuento_inventario
        WHERE recuento_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
        FOR UPDATE`,
      [recuentoId, tenantId],
    );
    if (!rows.length) {
      throw new NotFoundException(`Recuento ${recuentoId} no encontrado`);
    }
    if (rows[0].estado === 'aplicado') {
      throw new BadRequestException('El recuento ya fue aplicado');
    }
    if (rows[0].estado === 'cancelado') {
      throw new BadRequestException('El recuento fue cancelado');
    }
  }
}
