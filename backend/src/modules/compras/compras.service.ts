import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';
import { unwrap } from '../../common/utils/pg-returning.util';
import {
  MAX_REINTENTOS_DEADLOCK,
  esDeadlock,
} from '../../common/db/reintento-deadlock';
import { assertCostoNoColapsaACero } from '../../common/utils/costo-conversion-unidad.util';
import { CatalogService } from '../catalog/catalog.service';
import {
  InventarioService,
  type RegistrarMovimientoParams,
} from '../inventario/inventario.service';
import { UbicacionesService } from '../ubicaciones/ubicaciones.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import { MonedasService } from '../monedas/monedas.service';
import { costearLineas } from './reparto-descuento';
import type { EstadoCompra } from './entities/compra.entity';
import type {
  LoteCompraInput,
  SerieCompraInput,
} from './entities/compra-linea.entity';
import type {
  CompraBorradorDto,
  LineaCompraDto,
} from './dto/compra-borrador.dto';
import type { FindComprasDto } from './dto/find-compras.dto';
import type { AnularCompraDto } from './dto/anular-compra.dto';
import type {
  CorregirDescuentoDto,
  CorregirLineaDto,
} from './dto/corregir-compra.dto';

export interface TipoDocumentoCompraOpcion {
  id: string;
  nombre: string;
  codigo: string | null;
  requiereFolio: boolean;
}

export interface ProveedorOpcion {
  id: string;
  nombre: string;
  rut: string | null;
}

export interface CompraListItem {
  id: string;
  estado: EstadoCompra;
  /** Confirmada con alguna línea sin precio: "falta costo" no es un estado. */
  faltaCosto: boolean;
  fechaDocumento: string;
  proveedorId: string;
  proveedorNombre: string | null;
  tipoDocumentoCompraId: string;
  tipoDocumentoNombre: string | null;
  folio: string | null;
  ubicacionId: string;
  ubicacionNombre: string | null;
  lineas: number;
  /** Σ cantidad × precio − descuento; null si falta algún precio o no hay líneas. */
  total: string | null;
}

export interface CompraLineaDetalle {
  id: string;
  orden: number;
  itemId: string;
  itemNombre: string | null;
  modoInventario: string | null;
  unidadMedidaBase: string | null;
  cantidad: string;
  unidadCodigo: string;
  precioUnitario: string | null;
  series: SerieCompraInput[] | null;
  lote: LoteCompraInput | null;
}

export interface CompraCambio {
  compraLineaId: string;
  campo: string;
  valorAnterior: string | null;
  valorNuevo: string | null;
  usuarioNombre: string | null;
  creadoEl: Date;
}

export interface CompraDetalle extends Omit<CompraListItem, 'lineas'> {
  observacion: string | null;
  descuentoTotal: string | null;
  /** Por qué se anuló; null si no está anulada. */
  motivoAnulacion: string | null;
  lineas: CompraLineaDetalle[];
  cambios: CompraCambio[];
}

interface CabeceraRow {
  compra_id: string;
  estado: EstadoCompra;
  fecha_documento: string;
  folio: string | null;
  proveedor_id: string;
  proveedor_nombre: string | null;
  tipo_documento_compra_id: string;
  tipo_documento_nombre: string | null;
  ubicacion_id: string;
  ubicacion_nombre: string | null;
  descuento_total: string | null;
  observacion: string | null;
  lineas: number;
  algun_sin_precio: boolean;
  bruto: string | null;
}

interface LineaRow {
  compra_linea_id: string;
  orden: number;
  item_id: string;
  item_nombre: string | null;
  modo_inventario: string | null;
  unidad_medida: string | null;
  cantidad: string;
  unidad_codigo: string;
  precio_unitario: string | null;
  series: SerieCompraInput[] | null;
  lote: LoteCompraInput | null;
}

interface CambioRow {
  compra_linea_id: string;
  campo: string;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  usuario_nombre: string | null;
  creado_el: Date;
}

/** La compra bajo lock, con lo que las correcciones necesitan. */
interface CompraConfirmada {
  compra_id: string;
  ubicacion_id: string;
  ubicacion_nombre: string | null;
  ubicacion_viva: boolean;
  descuento_total: string | null;
  folio: string | null;
  tipo_documento_nombre: string | null;
  proveedor_nombre: string | null;
}

/** Una línea de una compra confirmada, con lo congelado al confirmar. */
interface LineaConfirmada {
  compra_linea_id: string;
  item_id: string;
  item_nombre: string;
  item_eliminado: boolean;
  modo_inventario: string;
  unidad_base: string;
  unidad_codigo: string;
  cantidad: string;
  precio_unitario: string | null;
  cantidad_base: string;
  costo_unitario_base: string | null;
  series: SerieCompraInput[] | null;
  lote: LoteCompraInput | null;
}

/** El comentario del kardex: qué documento y de quién. */
function comentarioDeCompra(
  tipoDocumento: string | null,
  folio: string | null,
  proveedor: string | null,
): string {
  return (
    `Compra: ${tipoDocumento ?? ''}` +
    (folio ? ` ${folio}` : '') +
    ` — ${proveedor ?? ''}`
  );
}

/** Igualdad de costo congelado: '1400' y '1400.0000' son el mismo. */
function mismoCosto(a: string | null, b: string | null): boolean {
  return a == null || b == null ? a === b : new Decimal(a).equals(b);
}

/**
 * El descuento al total, validado y normalizado: `null` si no hay (un 0 es no
 * tener descuento). Una sola regla para el borrador, la confirmación y la
 * corrección (spec § 4.4 y § 6):
 * - se reparte según el valor de cada línea, así que exige que todas tengan
 *   precio;
 * - no puede superar el total: `costearLineas` no lo chequea, y dejaría costos
 *   negativos.
 */
function validarDescuento(
  lineas: { cantidad: string; precioUnitario?: string | null }[],
  descuentoTotal: string | null | undefined,
): string | null {
  if (descuentoTotal == null || new Decimal(descuentoTotal).isZero()) {
    return null;
  }
  if (lineas.some((l) => l.precioUnitario == null)) {
    throw new BadRequestException(
      'Falta el precio de alguna línea: el descuento al total se carga cuando todas tienen precio',
    );
  }
  const bruto = lineas.reduce(
    (acc, l) => acc.plus(new Decimal(l.cantidad).times(l.precioUnitario!)),
    new Decimal(0),
  );
  if (new Decimal(descuentoTotal).greaterThan(bruto)) {
    throw new BadRequestException(
      `El descuento (${descuentoTotal}) supera el total de la compra (${bruto.toString()})`,
    );
  }
  return descuentoTotal;
}

interface EncabezadoValidado {
  folio: string | null;
  proveedorNombre: string;
  tipoDocumentoNombre: string;
}

/**
 * Los tipos de ítem que llevan stock: los dos que tienen `item_producto`. Es
 * la misma pareja que aceptan mermas y el ajuste de stock
 * (`docs/features/tipo-ingrediente.md`): un restaurante compra sobre todo
 * ingredientes —la harina, el tomate—, así que dejarlos afuera dejaría el caso
 * principal sin camino.
 */
const TIPOS_CON_STOCK = ['producto', 'ingrediente'];

/**
 * `SELECT` de la cabecera, común al listado y al detalle para que no se
 * desincronicen.
 *
 * ⚠️ Los `LEFT JOIN` de `terceros`, `tipos_documento_compra` y `ubicaciones`
 * van **sin** `eliminado_el IS NULL`, y es deliberado: una compra ya cargada
 * tiene que seguir diciendo a quién se le compró, con qué documento y adónde
 * entró, aunque el proveedor o la bodega se borren después. Mismo criterio que
 * la cabecera de `traslados`.
 *
 * El agregado de líneas sí filtra: una línea reemplazada en un borrador queda
 * borrada y no cuenta.
 */
const SELECT_CABECERA = `
  c.compra_id, c.estado, c.fecha_documento::text AS fecha_documento, c.folio,
  c.proveedor_id, pr.nombre AS proveedor_nombre,
  c.tipo_documento_compra_id, td.nombre AS tipo_documento_nombre,
  c.ubicacion_id, ub.nombre AS ubicacion_nombre,
  c.descuento_total, c.observacion,
  COALESCE(ag.lineas, 0)::int AS lineas,
  COALESCE(ag.algun_sin_precio, false) AS algun_sin_precio,
  ag.bruto`;

const JOINS_CABECERA = `
  LEFT JOIN (
    SELECT cl.compra_id, COUNT(*) AS lineas,
           bool_or(cl.precio_unitario IS NULL) AS algun_sin_precio,
           SUM(cl.cantidad * cl.precio_unitario) AS bruto
      FROM compra_lineas cl
     WHERE cl.tenant_id = $1 AND cl.eliminado_el IS NULL
     GROUP BY cl.compra_id
  ) ag ON ag.compra_id = c.compra_id
  LEFT JOIN terceros pr ON pr.tercero_id = c.proveedor_id
  LEFT JOIN tipos_documento_compra td
         ON td.tipo_documento_compra_id = c.tipo_documento_compra_id
  LEFT JOIN ubicaciones ub ON ub.ubicacion_id = c.ubicacion_id`;

@Injectable()
export class ComprasService {
  constructor(
    private readonly db: Db,
    private readonly catalogService: CatalogService,
    private readonly inventarioService: InventarioService,
    private readonly ubicacionesService: UbicacionesService,
    private readonly calculoPreciosService: CalculoPreciosService,
    private readonly monedasService: MonedasService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // Catálogos del formulario
  // ───────────────────────────────────────────────────────────────────────

  /** Los documentos activos del país del tenant. */
  async tiposDocumento(tenantId: string): Promise<TipoDocumentoCompraOpcion[]> {
    const rows: {
      tipo_documento_compra_id: string;
      nombre: string;
      codigo: string | null;
      requiere_folio: boolean;
    }[] = await this.db.query(
      `SELECT td.tipo_documento_compra_id, td.nombre, td.codigo, td.requiere_folio
         FROM tenants t
         JOIN provincia prov ON prov.provincia_id = t.provincia_id
              AND prov.eliminado_el IS NULL
         JOIN tipos_documento_compra td ON td.pais_id = prov.pais_id
              AND td.activo AND td.eliminado_el IS NULL
        WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL
        ORDER BY td.requiere_folio DESC, td.codigo NULLS LAST, td.nombre`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.tipo_documento_compra_id,
      nombre: r.nombre,
      codigo: r.codigo,
      requiereFolio: r.requiere_folio,
    }));
  }

  /**
   * Terceros activos de tipo `proveedor`. Endpoint propio de Compras a
   * propósito: el bodeguero no necesita permiso de Terceros para elegir a
   * quién le compró (spec § 5).
   */
  async proveedores(tenantId: string): Promise<ProveedorOpcion[]> {
    const rows: { tercero_id: string; nombre: string; rut: string | null }[] =
      await this.db.query(
        `SELECT tercero_id, nombre, rut
           FROM terceros
          WHERE tenant_id = $1 AND tipo = 'proveedor' AND activo
            AND eliminado_el IS NULL
          ORDER BY nombre`,
        [tenantId],
      );
    return rows.map((r) => ({
      id: r.tercero_id,
      nombre: r.nombre,
      rut: r.rut,
    }));
  }

  // ───────────────────────────────────────────────────────────────────────
  // Lecturas
  // ───────────────────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    query: FindComprasDto,
  ): Promise<PaginatedResponse<CompraListItem>> {
    const { page, pageSize, offset } = resolvePagination(query);

    const params: unknown[] = [tenantId];
    const filtros: string[] = ['c.tenant_id = $1', 'c.eliminado_el IS NULL'];
    if (query.estado) {
      params.push(query.estado);
      filtros.push(`c.estado = $${params.length}`);
    }
    if (query.proveedorId) {
      params.push(query.proveedorId);
      filtros.push(`c.proveedor_id = $${params.length}`);
    }
    if (query.desde) {
      params.push(query.desde);
      filtros.push(`c.fecha_documento >= $${params.length}::date`);
    }
    if (query.hasta) {
      params.push(query.hasta);
      filtros.push(`c.fecha_documento <= $${params.length}::date`);
    }
    if (query.faltaCosto) {
      filtros.push(
        `c.estado = 'confirmada' AND COALESCE(ag.algun_sin_precio, false)`,
      );
    }
    const where = filtros.join(' AND ');

    const countRows: { total: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total
         FROM compras c
         ${JOINS_CABECERA}
        WHERE ${where}`,
      params,
    );
    const total = countRows[0]?.total ?? 0;

    const rows: CabeceraRow[] = await this.db.query(
      `SELECT ${SELECT_CABECERA}
         FROM compras c
         ${JOINS_CABECERA}
        WHERE ${where}
        ORDER BY c.fecha_documento DESC, c.creado_el DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );

    return {
      data: rows.map((r) => this.mapListItem(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  /** Encabezado, líneas e historial: tres consultas fijas, sin importar el largo. */
  async findOne(tenantId: string, id: string): Promise<CompraDetalle> {
    const cabecera: (CabeceraRow & { motivo_anulacion: string | null })[] =
      await this.db.query(
        `SELECT ${SELECT_CABECERA}, c.motivo_anulacion
           FROM compras c
           ${JOINS_CABECERA}
          WHERE c.tenant_id = $1 AND c.compra_id = $2 AND c.eliminado_el IS NULL`,
        [tenantId, id],
      );
    if (!cabecera.length) {
      throw new NotFoundException('Compra no encontrada');
    }

    // `items` e `item_producto` sin filtro de borrado a propósito: un producto
    // discontinuado después no puede dejar la compra que lo trajo sin nombre.
    // Mismo criterio que el kardex.
    const lineas: LineaRow[] = await this.db.query(
      `SELECT cl.compra_linea_id, cl.orden, cl.item_id, i.nombre AS item_nombre,
              ip.modo_inventario, ip.unidad_medida, cl.cantidad, cl.unidad_codigo,
              cl.precio_unitario, cl.series, cl.lote
         FROM compra_lineas cl
         LEFT JOIN items i ON i.item_id = cl.item_id
         LEFT JOIN item_producto ip ON ip.item_id = cl.item_id
        WHERE cl.tenant_id = $1 AND cl.compra_id = $2 AND cl.eliminado_el IS NULL
        ORDER BY cl.orden`,
      [tenantId, id],
    );

    // Sin `eliminado_el` en `compra_linea_cambios`: es append-only.
    const cambios: CambioRow[] = await this.db.query(
      `SELECT cc.compra_linea_id, cc.campo, cc.valor_anterior, cc.valor_nuevo,
              us.nombre AS usuario_nombre, cc.creado_el
         FROM compra_linea_cambios cc
         JOIN compra_lineas cl ON cl.compra_linea_id = cc.compra_linea_id
              AND cl.eliminado_el IS NULL
         LEFT JOIN usuarios us ON us.usuario_id = cc.usuario_id
              AND us.eliminado_el IS NULL
        WHERE cc.tenant_id = $1 AND cl.compra_id = $2
        ORDER BY cc.creado_el`,
      [tenantId, id],
    );

    return {
      ...this.mapCabecera(cabecera[0]),
      observacion: cabecera[0].observacion,
      descuentoTotal: cabecera[0].descuento_total,
      motivoAnulacion: cabecera[0].motivo_anulacion,
      lineas: lineas.map((l) => ({
        id: l.compra_linea_id,
        orden: l.orden,
        itemId: l.item_id,
        itemNombre: l.item_nombre,
        modoInventario: l.modo_inventario,
        unidadMedidaBase: l.unidad_medida,
        cantidad: l.cantidad,
        unidadCodigo: l.unidad_codigo,
        precioUnitario: l.precio_unitario,
        series: l.series,
        lote: l.lote,
      })),
      cambios: cambios.map((c) => ({
        compraLineaId: c.compra_linea_id,
        campo: c.campo,
        valorAnterior: c.valor_anterior,
        valorNuevo: c.valor_nuevo,
        usuarioNombre: c.usuario_nombre,
        creadoEl: c.creado_el,
      })),
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Borrador
  // ───────────────────────────────────────────────────────────────────────

  async crearBorrador(
    tenantId: string,
    usuarioId: string,
    dto: CompraBorradorDto,
  ): Promise<CompraDetalle> {
    return this.db.transaccion(async () => {
      const enc = await this.validarEncabezado(tenantId, dto);
      await this.validarLineas(tenantId, dto.lineas);
      const descuento = validarDescuento(dto.lineas, dto.descuentoTotal);
      await this.assertFolioLibre(
        tenantId,
        dto.proveedorId,
        dto.tipoDocumentoCompraId,
        enc,
      );

      const insert = unwrap<{ compra_id: string }>(
        await this.insertarSinChoqueDeFolio(() =>
          this.db.query(
            `INSERT INTO compras
               (tenant_id, proveedor_id, tipo_documento_compra_id, folio,
                fecha_documento, ubicacion_id, observacion, creado_por,
                descuento_total)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING compra_id`,
            [
              tenantId,
              dto.proveedorId,
              dto.tipoDocumentoCompraId,
              enc.folio,
              dto.fechaDocumento,
              dto.ubicacionId,
              dto.observacion ?? null,
              usuarioId,
              descuento,
            ],
          ),
        ),
      );
      const compraId = insert[0].compra_id;
      await this.insertarLineas(tenantId, compraId, dto.lineas);
      return this.findOne(tenantId, compraId);
    });
  }

  /** Reemplaza encabezado y líneas enteras. Solo sobre un borrador. */
  async actualizarBorrador(
    tenantId: string,
    id: string,
    dto: CompraBorradorDto,
  ): Promise<CompraDetalle> {
    return this.db.transaccion(async () => {
      await this.bloquearBorrador(tenantId, id);
      const enc = await this.validarEncabezado(tenantId, dto);
      await this.validarLineas(tenantId, dto.lineas);
      const descuento = validarDescuento(dto.lineas, dto.descuentoTotal);
      await this.assertFolioLibre(
        tenantId,
        dto.proveedorId,
        dto.tipoDocumentoCompraId,
        enc,
        id,
      );

      await this.insertarSinChoqueDeFolio(() =>
        this.db.query(
          `UPDATE compras
              SET proveedor_id = $3, tipo_documento_compra_id = $4, folio = $5,
                  fecha_documento = $6, ubicacion_id = $7, observacion = $8,
                  descuento_total = $9, actualizado_el = NOW()
            WHERE tenant_id = $1 AND compra_id = $2`,
          [
            tenantId,
            id,
            dto.proveedorId,
            dto.tipoDocumentoCompraId,
            enc.folio,
            dto.fechaDocumento,
            dto.ubicacionId,
            dto.observacion ?? null,
            descuento,
          ],
        ),
      );
      await this.db.query(
        `UPDATE compra_lineas SET eliminado_el = NOW()
          WHERE tenant_id = $1 AND compra_id = $2 AND eliminado_el IS NULL`,
        [tenantId, id],
      );
      await this.insertarLineas(tenantId, id, dto.lineas);
      return this.findOne(tenantId, id);
    });
  }

  /**
   * Soft delete. Una compra confirmada no se descarta: se anula. No registra
   * quién la descartó a propósito: sin `eliminado_por` no entra a la papelera
   * (owner, 2026-09-18; ver la entidad).
   */
  async descartarBorrador(tenantId: string, id: string): Promise<void> {
    await this.db.transaccion(async () => {
      await this.bloquearBorrador(tenantId, id);
      await this.db.query(
        `UPDATE compra_lineas SET eliminado_el = NOW()
          WHERE tenant_id = $1 AND compra_id = $2 AND eliminado_el IS NULL`,
        [tenantId, id],
      );
      await this.db.query(
        `UPDATE compras SET eliminado_el = NOW()
          WHERE tenant_id = $1 AND compra_id = $2`,
        [tenantId, id],
      );
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Confirmar
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Confirma la recepción (spec compras-recepcion § 4.2): cada línea entra al
   * stock de la ubicación de la compra por el chokepoint del kardex, con su
   * costo por unidad base (o sin costo, si todavía no llegó la factura).
   *
   * El reintento es el de siempre (`MAX_REINTENTOS_DEADLOCK`), y vale porque el
   * único llamador es el controller: sin transacción envolvente, un `40P01`
   * reintenta limpio (mismo razonamiento que `TrasladosService.crear`).
   */
  async confirmar(
    tenantId: string,
    usuarioId: string,
    id: string,
  ): Promise<CompraDetalle> {
    return this.conReintento((manager) =>
      this.confirmarEnTransaccion(manager, tenantId, usuarioId, id),
    );
  }

  private async confirmarEnTransaccion(
    manager: EntityManager,
    tenantId: string,
    usuarioId: string,
    id: string,
  ): Promise<CompraDetalle> {
    // 1. El encabezado, bajo lock: nadie más lo edita ni lo confirma a la vez.
    await this.bloquearBorrador(tenantId, id);
    const cabecera: {
      proveedor_id: string;
      tipo_documento_compra_id: string;
      folio: string | null;
      fecha_documento: string;
      ubicacion_id: string;
      observacion: string | null;
      descuento_total: string | null;
    }[] = await this.db.query(
      `SELECT proveedor_id, tipo_documento_compra_id, folio,
              fecha_documento::text AS fecha_documento, ubicacion_id,
              observacion, descuento_total
         FROM compras
        WHERE tenant_id = $1 AND compra_id = $2 AND eliminado_el IS NULL`,
      [tenantId, id],
    );
    const c = cabecera[0];
    const lineas: {
      compra_linea_id: string;
      item_id: string;
      cantidad: string;
      unidad_codigo: string;
      precio_unitario: string | null;
      series: SerieCompraInput[] | null;
      lote: LoteCompraInput | null;
    }[] = await this.db.query(
      `SELECT compra_linea_id, item_id, cantidad, unidad_codigo,
              precio_unitario, series, lote
         FROM compra_lineas
        WHERE tenant_id = $1 AND compra_id = $2 AND eliminado_el IS NULL
        ORDER BY orden`,
      [tenantId, id],
    );
    if (!lineas.length) {
      throw new BadRequestException(
        'La compra no tiene líneas: no hay nada que recibir',
      );
    }

    // 2. Las mismas validaciones que el borrador, otra vez: entre guardar y
    // confirmar pudo pausarse el proveedor, desactivarse la bodega o
    // cargarse el mismo folio en otra compra.
    const dto: CompraBorradorDto = {
      proveedorId: c.proveedor_id,
      tipoDocumentoCompraId: c.tipo_documento_compra_id,
      folio: c.folio,
      fechaDocumento: c.fecha_documento,
      ubicacionId: c.ubicacion_id,
      observacion: c.observacion,
      lineas: lineas.map((l) => ({
        itemId: l.item_id,
        cantidad: l.cantidad,
        unidadCodigo: l.unidad_codigo,
        precioUnitario: l.precio_unitario,
        series: l.series ?? undefined,
        lote: l.lote ?? undefined,
      })),
    };
    const enc = await this.validarEncabezado(tenantId, dto);
    const items = await this.validarLineas(tenantId, dto.lineas);
    validarDescuento(dto.lineas, c.descuento_total);
    await this.assertFolioLibre(
      tenantId,
      c.proveedor_id,
      c.tipo_documento_compra_id,
      enc,
      id,
    );

    // 3. Los locks, en el orden de `docs/patterns/backend.md` §15: primero la
    // ubicación contra su borrado, después los productos en UN statement
    // ordenado por `item_id` (el mismo orden que `ventas.crear()` y
    // `traslados`). `registrarMovimiento` vuelve a pedir los dos; con los
    // locks ya en la mano no espera nada.
    await this.ubicacionesService.bloquearContraBorrado(
      manager,
      tenantId,
      c.ubicacion_id,
    );
    const itemIds = [...new Set(lineas.map((l) => l.item_id))].sort((a, b) =>
      a.localeCompare(b),
    );
    await manager.query(
      `SELECT ip.item_id
         FROM item_producto ip
         JOIN items i ON i.item_id = ip.item_id
        WHERE ip.item_id = ANY($1::uuid[]) AND i.tenant_id = $2
        ORDER BY ip.item_id
        FOR UPDATE OF ip`,
      [itemIds, tenantId],
    );

    // 4. El stock total ANTES de la compra, ya con los locks: una sola
    // consulta, y la misma definición que usa el CPP.
    const stockTotal = await this.inventarioService.stockTotalPorProducto(
      manager,
      tenantId,
      itemIds,
    );

    // 5. Cantidad y costo por unidad base. El descuento al total se reparte
    // entre las líneas con precio (si falta alguno, no se pudo cargar).
    const necesitaConversion = lineas.some(
      (l) => l.unidad_codigo !== items.get(l.item_id)!.unidadBase,
    );
    const convertir = necesitaConversion
      ? await this.catalogService.crearConversor()
      : null;
    const bases = lineas.map((l) => {
      const base = items.get(l.item_id)!.unidadBase;
      return l.unidad_codigo === base
        ? l.cantidad
        : convertir!(l.cantidad, l.unidad_codigo, base);
    });
    const costosBase = await this.costearCompra(
      tenantId,
      lineas.map((l, i) => ({
        cantidad: l.cantidad,
        precioUnitario: l.precio_unitario,
        cantidadBase: bases[i],
        unidadBase: items.get(l.item_id)!.unidadBase,
      })),
      c.descuento_total,
    );

    // 6. Una entrada por línea, en el orden de los locks (por `item_id`, y
    // dentro del mismo producto por el orden de la factura). El stock total
    // anterior de cada línea es el del producto antes de la compra más lo que
    // ya entró por las líneas anteriores del mismo producto: el mismo número
    // que pondera el CPP de esa entrada.
    const orden = lineas
      .map((l, i) => i)
      .sort(
        (a, b) => lineas[a].item_id.localeCompare(lineas[b].item_id) || a - b,
      );
    const acumulado = new Map(
      itemIds.map((itemId) => [itemId, new Decimal(stockTotal.get(itemId)!)]),
    );
    const congelados: {
      compraLineaId: string;
      cantidadBase: string;
      costoUnitarioBase: string | null;
      movimientoId: string;
      stockTotalAnterior: string;
      costoProductoAnterior: string | null;
    }[] = [];
    const comentario = comentarioDeCompra(
      enc.tipoDocumentoNombre,
      enc.folio,
      enc.proveedorNombre,
    );
    for (const i of orden) {
      const l = lineas[i];
      const anterior = acumulado.get(l.item_id)!;
      const costoBase = costosBase[i];
      const mov = await this.inventarioService.registrarMovimiento(manager, {
        tenantId,
        itemId: l.item_id,
        ubicacionId: c.ubicacion_id,
        usuarioId,
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: bases[i],
        costoUnitario: costoBase,
        compraLineaId: l.compra_linea_id,
        comentario,
        series: l.series ?? undefined,
        lote: l.lote ?? undefined,
      });
      congelados.push({
        compraLineaId: l.compra_linea_id,
        cantidadBase: bases[i],
        costoUnitarioBase: costoBase,
        movimientoId: mov.movimientoId,
        stockTotalAnterior: anterior.toString(),
        costoProductoAnterior: mov.costoActualPrevio,
      });
      acumulado.set(l.item_id, anterior.plus(bases[i]));
    }

    // 7. Lo congelado, en UN update para todas las líneas.
    const COLUMNAS = 6;
    const valores = congelados
      .map((_, k) => {
        const p = k * COLUMNAS + 2;
        return `($${p}::uuid, $${p + 1}::numeric, $${p + 2}::numeric, $${p + 3}::uuid, $${p + 4}::numeric, $${p + 5}::numeric)`;
      })
      .join(', ');
    await this.db.query(
      `UPDATE compra_lineas cl
          SET cantidad_base = v.cantidad_base,
              costo_unitario_base = v.costo_unitario_base,
              movimiento_id = v.movimiento_id,
              stock_total_anterior = v.stock_total_anterior,
              costo_producto_anterior = v.costo_producto_anterior,
              actualizado_el = NOW()
         FROM (VALUES ${valores}) AS v(compra_linea_id, cantidad_base,
              costo_unitario_base, movimiento_id, stock_total_anterior,
              costo_producto_anterior)
        WHERE cl.compra_linea_id = v.compra_linea_id AND cl.tenant_id = $1`,
      [
        tenantId,
        ...congelados.flatMap((g) => [
          g.compraLineaId,
          g.cantidadBase,
          g.costoUnitarioBase,
          g.movimientoId,
          g.stockTotalAnterior,
          g.costoProductoAnterior,
        ]),
      ],
    );

    // 8. El estado.
    await this.db.query(
      `UPDATE compras
          SET estado = 'confirmada', confirmado_por = $3,
              confirmado_el = NOW(), actualizado_el = NOW()
        WHERE tenant_id = $1 AND compra_id = $2`,
      [tenantId, id, usuarioId],
    );

    return this.findOne(tenantId, id);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Corregir una confirmada (spec § 4.4)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Corrige una línea confirmada: el precio (la factura que llega después de
   * la mercadería), la cantidad (lo que de verdad entró) o los dos. Rehace la
   * cuenta de cada producto cuyo costo cambió, y con descuento al total pueden
   * ser varios, porque el valor de una línea mueve el reparto de todas.
   *
   * La cantidad va primero: mueve la diferencia en el kardex y deja la línea
   * con lo que vale hoy, que es lo que el recosteo y la cuenta leen.
   */
  async corregirLinea(
    tenantId: string,
    usuarioId: string,
    id: string,
    lineaId: string,
    dto: CorregirLineaDto,
  ): Promise<CompraDetalle> {
    if (dto.precioUnitario == null && dto.cantidad == null) {
      throw new BadRequestException(
        'No hay nada que corregir: falta el precio o la cantidad',
      );
    }
    return this.conReintento(async (manager) => {
      const compra = await this.bloquearConfirmada(tenantId, id);
      const lineas = await this.lineasConfirmadas(tenantId, id);
      const linea = lineas.find((l) => l.compra_linea_id === lineaId);
      if (!linea) {
        throw new NotFoundException('Línea no encontrada');
      }
      if (linea.item_eliminado) {
        throw new BadRequestException(
          `El producto "${linea.item_nombre}" está en la papelera: restauralo para corregir la compra`,
        );
      }
      const anterior = linea.precio_unitario;
      if (
        dto.precioUnitario != null &&
        anterior != null &&
        new Decimal(anterior).equals(dto.precioUnitario)
      ) {
        throw new BadRequestException(
          'El precio es igual al vigente: no hay nada que corregir',
        );
      }

      const cantidad =
        dto.cantidad != null
          ? await this.corregirCantidad(
              manager,
              tenantId,
              usuarioId,
              compra,
              lineas,
              linea,
              dto,
            )
          : null;

      if (dto.precioUnitario != null) {
        await this.db.query(
          `UPDATE compra_lineas SET precio_unitario = $3, actualizado_el = NOW()
            WHERE tenant_id = $1 AND compra_linea_id = $2`,
          [tenantId, lineaId, dto.precioUnitario],
        );
        linea.precio_unitario = dto.precioUnitario;
      }

      const queCambio = [
        cantidad && 'cantidad corregida',
        dto.precioUnitario != null && 'precio corregido',
      ]
        .filter(Boolean)
        .join(' y ');
      // La cantidad cambia el peso del producto aunque su costo por unidad no
      // cambie: su cuenta se rehace siempre.
      const { movimientos } = await this.recostear(
        manager,
        tenantId,
        usuarioId,
        compra,
        lineas,
        queCambio,
        cantidad ? [linea.item_id] : [],
      );
      await this.registrarCambios(tenantId, usuarioId, [
        ...(cantidad
          ? [
              {
                compraLineaId: lineaId,
                campo: 'cantidad' as const,
                anterior: cantidad.anterior,
                nuevo: cantidad.nuevo,
                movimientoId: cantidad.movimientoId,
              },
            ]
          : []),
        ...(dto.precioUnitario != null
          ? [
              {
                compraLineaId: lineaId,
                campo: 'precio' as const,
                anterior,
                nuevo: dto.precioUnitario,
                movimientoId: movimientos.get(linea.item_id) ?? null,
              },
            ]
          : []),
      ]);
      return this.findOne(tenantId, id);
    });
  }

  /**
   * Mueve la diferencia de cantidad en la ubicación de la compra (spec § 4.4):
   * una entrada o salida `compra` colgada de la línea, que "rehacer la cuenta"
   * salta porque la línea ya cuenta con su cantidad nueva en su lugar original.
   *
   * - Si baja y no alcanza, 400 con el producto, la ubicación y cuánto queda.
   * - En serie, subir pide las series nuevas y bajar pide cuáles salen.
   * - En lote, la diferencia va al mismo lote.
   *
   * Bloquea la ubicación y después TODOS los productos de la compra en un solo
   * statement ordenado: la salida lockea este producto y el recosteo puede
   * rehacer la cuenta de otros; sin esto se tomarían fuera de orden.
   */
  private async corregirCantidad(
    manager: EntityManager,
    tenantId: string,
    usuarioId: string,
    compra: CompraConfirmada,
    lineas: LineaConfirmada[],
    linea: LineaConfirmada,
    dto: CorregirLineaDto,
  ): Promise<{ anterior: string; nuevo: string; movimientoId: string }> {
    if (!compra.ubicacion_viva) {
      throw new BadRequestException(
        `La ubicación de la compra (${compra.ubicacion_nombre}) fue eliminada: la cantidad no se puede corregir`,
      );
    }
    const nuevaBase =
      linea.unidad_codigo === linea.unidad_base
        ? dto.cantidad!
        : (await this.catalogService.crearConversor())(
            dto.cantidad!,
            linea.unidad_codigo,
            linea.unidad_base,
          );
    const diferencia = new Decimal(nuevaBase).minus(linea.cantidad_base);
    if (diferencia.isZero()) {
      throw new BadRequestException(
        'La cantidad es igual a la vigente: no hay nada que corregir',
      );
    }

    await this.ubicacionesService.bloquearContraBorrado(
      manager,
      tenantId,
      compra.ubicacion_id,
    );
    const itemIds = [...new Set(lineas.map((l) => l.item_id))].sort((a, b) =>
      a.localeCompare(b),
    );
    await manager.query(
      `SELECT ip.item_id
         FROM item_producto ip
         JOIN items i ON i.item_id = ip.item_id
        WHERE ip.item_id = ANY($1::uuid[]) AND i.tenant_id = $2
        ORDER BY ip.item_id
        FOR UPDATE OF ip`,
      [itemIds, tenantId],
    );

    const cuanto = diferencia.abs();
    const sube = diferencia.greaterThan(0);
    const porModo: Partial<RegistrarMovimientoParams> = {};
    let series = linea.series;
    if (sube) {
      if (linea.modo_inventario === 'serie') {
        if (!cuanto.equals(dto.series?.length ?? 0)) {
          throw new BadRequestException(
            `Subir ${cuanto.toString()} unidades pide ${cuanto.toString()} series nuevas`,
          );
        }
        porModo.series = dto.series;
        series = [...(linea.series ?? []), ...dto.series!];
      } else if (linea.modo_inventario === 'lote') {
        porModo.lote = linea.lote ?? undefined;
      }
    } else {
      // En lote, la salida baja del lote de la línea: primero ese lote, y el
      // saldo que decide es el suyo, no el del producto entero.
      let loteCodigo: string | null = null;
      if (linea.modo_inventario === 'lote') {
        loteCodigo = linea.lote?.codigoLote ?? null;
        const lote: { lote_id: string }[] = await manager.query(
          `SELECT lote_id FROM item_lote
            WHERE item_id = $1 AND codigo_lote = $2 AND tenant_id = $3
              AND eliminado_el IS NULL`,
          [linea.item_id, loteCodigo, tenantId],
        );
        // Sin él, la salida elegiría lotes por FIFO: bajaría de otro lote.
        if (!lote.length) {
          throw new BadRequestException(
            `El lote ${loteCodigo} de "${linea.item_nombre}" ya no existe: la cantidad no se puede bajar`,
          );
        }
        porModo.loteId = lote[0].lote_id;
      }

      // El saldo ya con el lock del producto en la mano: es el que decide.
      const saldo: { stock: string }[] =
        porModo.loteId != null
          ? await manager.query(
              `SELECT cantidad AS stock FROM lote_ubicacion
                WHERE lote_id = $1 AND ubicacion_id = $2`,
              [porModo.loteId, compra.ubicacion_id],
            )
          : await manager.query(
              `SELECT stock FROM stock_ubicacion WHERE item_id = $1 AND ubicacion_id = $2`,
              [linea.item_id, compra.ubicacion_id],
            );
      const queda = new Decimal(saldo[0]?.stock ?? 0);
      if (queda.lessThan(cuanto)) {
        const deQue =
          loteCodigo != null
            ? `del lote ${loteCodigo} de "${linea.item_nombre}"`
            : `de "${linea.item_nombre}"`;
        throw new BadRequestException(
          `No alcanza para bajar ${cuanto.toString()}: ${deQue} quedan ${queda.toString()} en ${compra.ubicacion_nombre}`,
        );
      }

      if (linea.modo_inventario === 'serie') {
        if (!cuanto.equals(dto.unidadIds?.length ?? 0)) {
          throw new BadRequestException(
            `Bajar ${cuanto.toString()} unidades pide cuáles salen: ${cuanto.toString()} ids`,
          );
        }
        // Las que salen tienen que ser de las que trajo ESTA línea: bajar la
        // cantidad de una compra es decir que llegaron menos de las que dice
        // la factura. Una unidad de otra compra dejaría las series de la línea
        // descuadradas con su cantidad, sin aviso.
        const salen: { serie: string }[] = await manager.query(
          `SELECT serie FROM item_unidad
            WHERE unidad_id = ANY($1::uuid[]) AND item_id = $2 AND tenant_id = $3
              AND eliminado_el IS NULL`,
          [dto.unidadIds, linea.item_id, tenantId],
        );
        const deLaLinea = new Set((linea.series ?? []).map((s) => s.serie));
        if (
          salen.length !== dto.unidadIds!.length ||
          salen.some((u) => !deLaLinea.has(u.serie))
        ) {
          throw new BadRequestException(
            'Las unidades que salen tienen que ser de las que trajo esta compra',
          );
        }
        porModo.unidadIds = dto.unidadIds;
        const quitar = new Set(salen.map((u) => u.serie));
        series = (linea.series ?? []).filter((s) => !quitar.has(s.serie));
      }
    }

    const mov = await this.inventarioService.registrarMovimiento(manager, {
      tenantId,
      itemId: linea.item_id,
      ubicacionId: compra.ubicacion_id,
      usuarioId,
      tipo: sube ? 'entrada' : 'salida',
      motivo: 'compra',
      cantidad: cuanto.toString(),
      costoUnitario: sube ? linea.costo_unitario_base : null,
      compraLineaId: linea.compra_linea_id,
      comentario: `${comentarioDeCompra(
        compra.tipo_documento_nombre,
        compra.folio,
        compra.proveedor_nombre,
      )}: cantidad corregida`,
      ...porModo,
    });

    await this.db.query(
      `UPDATE compra_lineas
          SET cantidad = $3, cantidad_base = $4, series = $5::jsonb,
              actualizado_el = NOW()
        WHERE tenant_id = $1 AND compra_linea_id = $2`,
      [
        tenantId,
        linea.compra_linea_id,
        dto.cantidad,
        nuevaBase,
        series == null ? null : JSON.stringify(series),
      ],
    );
    const anterior = linea.cantidad;
    linea.cantidad = dto.cantidad!;
    linea.cantidad_base = nuevaBase;
    return { anterior, nuevo: dto.cantidad!, movimientoId: mov.movimientoId };
  }

  /**
   * Carga, cambia o quita el descuento al total. Se reparte según el valor de
   * cada línea, así que exige que todas tengan precio. El historial lo registra
   * en cada línea cuyo costo cambió (spec § 3.5).
   */
  async corregirDescuento(
    tenantId: string,
    usuarioId: string,
    id: string,
    dto: CorregirDescuentoDto,
  ): Promise<CompraDetalle> {
    return this.conReintento(async (manager) => {
      const compra = await this.bloquearConfirmada(tenantId, id);
      const lineas = await this.lineasConfirmadas(tenantId, id);
      const nuevo = validarDescuento(
        lineas.map((l) => ({
          cantidad: l.cantidad,
          precioUnitario: l.precio_unitario,
        })),
        dto.descuentoTotal,
      );
      const anterior = compra.descuento_total;
      if (new Decimal(anterior ?? 0).equals(nuevo ?? 0)) {
        throw new BadRequestException(
          'El descuento es igual al vigente: no hay nada que corregir',
        );
      }

      await this.db.query(
        `UPDATE compras SET descuento_total = $3, actualizado_el = NOW()
          WHERE tenant_id = $1 AND compra_id = $2`,
        [tenantId, id, nuevo],
      );

      const { cambiadas, movimientos } = await this.recostear(
        manager,
        tenantId,
        usuarioId,
        { ...compra, descuento_total: nuevo },
        lineas,
        'descuento al total corregido',
      );
      await this.registrarCambios(
        tenantId,
        usuarioId,
        cambiadas.map((l) => ({
          compraLineaId: l.compra_linea_id,
          campo: 'descuento',
          anterior,
          nuevo,
          movimientoId: movimientos.get(l.item_id) ?? null,
        })),
      );
      return this.findOne(tenantId, id);
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Anular (spec § 4.5)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Anula una compra confirmada: una salida `compra` por línea en la
   * ubicación de la compra, la cuenta rehecha de cada producto como si la
   * compra no hubiera existido, y la compra queda `anulada` con su motivo. Se
   * sigue viendo, tachada, nunca se borra, y libera su folio.
   *
   * Todo o nada: si alguna línea no alcanza, no anula ninguna, y el 400 dice
   * cuál. Lo decide un chequeo previo que mira todas las líneas con los locks
   * ya tomados, así el mensaje nombra el producto en vez de salir del kardex
   * a mitad de camino.
   */
  async anular(
    tenantId: string,
    usuarioId: string,
    id: string,
    dto: AnularCompraDto,
  ): Promise<CompraDetalle> {
    const motivo = dto.motivo.trim();
    if (!motivo) {
      throw new BadRequestException('La anulación necesita un motivo');
    }
    return this.conReintento(async (manager) => {
      const compra = await this.bloquearConfirmada(
        tenantId,
        id,
        'La compra es un borrador: se descarta, no se anula',
      );
      const lineas = await this.lineasConfirmadas(tenantId, id);
      if (!compra.ubicacion_viva) {
        throw new BadRequestException(
          `La ubicación de la compra (${compra.ubicacion_nombre}) fue eliminada: no hay de dónde sacar lo que entró`,
        );
      }
      const enPapelera = lineas.find((l) => l.item_eliminado);
      if (enPapelera) {
        throw new BadRequestException(
          `El producto "${enPapelera.item_nombre}" está en la papelera: restauralo para anular la compra`,
        );
      }

      // Los locks, en el orden de siempre: la ubicación y después todos los
      // productos en un statement ordenado.
      await this.ubicacionesService.bloquearContraBorrado(
        manager,
        tenantId,
        compra.ubicacion_id,
      );
      const itemIds = [...new Set(lineas.map((l) => l.item_id))].sort((a, b) =>
        a.localeCompare(b),
      );
      await manager.query(
        `SELECT ip.item_id
           FROM item_producto ip
           JOIN items i ON i.item_id = ip.item_id
          WHERE ip.item_id = ANY($1::uuid[]) AND i.tenant_id = $2
          ORDER BY ip.item_id
          FOR UPDATE OF ip`,
        [itemIds, tenantId],
      );

      const porLinea = await this.salidasDeAnulacion(
        manager,
        tenantId,
        compra,
        lineas,
      );

      const comentario = `${comentarioDeCompra(
        compra.tipo_documento_nombre,
        compra.folio,
        compra.proveedor_nombre,
      )}: anulada (${motivo})`;
      // En el orden de los locks: por producto, y dentro del producto por el
      // orden de la factura (`lineasConfirmadas` ya viene por `orden`).
      const ordenadas = [...lineas].sort((a, b) =>
        a.item_id.localeCompare(b.item_id),
      );
      for (const l of ordenadas) {
        await this.inventarioService.registrarMovimiento(manager, {
          tenantId,
          itemId: l.item_id,
          ubicacionId: compra.ubicacion_id,
          usuarioId,
          tipo: 'salida',
          motivo: 'compra',
          cantidad: l.cantidad_base,
          compraLineaId: l.compra_linea_id,
          comentario,
          ...porLinea.get(l.compra_linea_id),
        });
      }

      // El estado ANTES de rehacer las cuentas: el recorrido salta la entrada
      // de una compra anulada.
      await this.db.query(
        `UPDATE compras
            SET estado = 'anulada', anulado_por = $3, anulado_el = NOW(),
                motivo_anulacion = $4, actualizado_el = NOW()
          WHERE tenant_id = $1 AND compra_id = $2`,
        [tenantId, id, usuarioId, motivo],
      );
      for (const itemId of itemIds) {
        await this.inventarioService.recalcularCostoDesdeCompra(manager, {
          tenantId,
          itemId,
          compraId: id,
          usuarioId,
          comentario,
        });
      }
      return this.findOne(tenantId, id);
    });
  }

  /**
   * Lo que cada línea necesita para salir, y el 400 si alguna no alcanza.
   * Una consulta por modo, no por línea:
   * - **cantidad:** el saldo del producto en la ubicación, contra lo que
   *   entró por todas las líneas de ese producto;
   * - **lote:** el lote de cada línea por su código, y su saldo ahí;
   * - **serie:** cada unidad que trajo la línea, disponible en la ubicación.
   */
  private async salidasDeAnulacion(
    manager: EntityManager,
    tenantId: string,
    compra: CompraConfirmada,
    lineas: LineaConfirmada[],
  ): Promise<Map<string, Partial<RegistrarMovimientoParams>>> {
    const porLinea = new Map<string, Partial<RegistrarMovimientoParams>>();
    const noAlcanza = (que: string, queda: Decimal, trajo: Decimal) =>
      new BadRequestException(
        `No se puede anular: ${que} quedan ${queda.toString()} en ${compra.ubicacion_nombre} y la compra trajo ${trajo.toString()}`,
      );

    const deCantidad = lineas.filter((l) => l.modo_inventario === 'cantidad');
    if (deCantidad.length) {
      const trajo = new Map<string, Decimal>();
      for (const l of deCantidad) {
        trajo.set(
          l.item_id,
          (trajo.get(l.item_id) ?? new Decimal(0)).plus(l.cantidad_base),
        );
      }
      const saldos: { item_id: string; stock: string }[] = await manager.query(
        `SELECT item_id, stock FROM stock_ubicacion
          WHERE item_id = ANY($1::uuid[]) AND ubicacion_id = $2`,
        [[...trajo.keys()], compra.ubicacion_id],
      );
      const queda = new Map(saldos.map((s) => [s.item_id, s.stock]));
      for (const [itemId, cantidad] of trajo) {
        const hay = new Decimal(queda.get(itemId) ?? 0);
        if (hay.lessThan(cantidad)) {
          const nombre = deCantidad.find((l) => l.item_id === itemId)!;
          throw noAlcanza(`de "${nombre.item_nombre}"`, hay, cantidad);
        }
      }
    }

    const deLote = lineas.filter((l) => l.modo_inventario === 'lote');
    if (deLote.length) {
      const lotes: { lote_id: string; item_id: string; codigo_lote: string }[] =
        await manager.query(
          `SELECT lote_id, item_id, codigo_lote FROM item_lote
            WHERE item_id = ANY($1::uuid[]) AND codigo_lote = ANY($2::text[])
              AND tenant_id = $3 AND eliminado_el IS NULL`,
          [
            deLote.map((l) => l.item_id),
            deLote.map((l) => l.lote?.codigoLote),
            tenantId,
          ],
        );
      const loteDe = (l: LineaConfirmada) =>
        lotes.find(
          (x) =>
            x.item_id === l.item_id && x.codigo_lote === l.lote?.codigoLote,
        );
      const faltante = deLote.find((l) => !loteDe(l));
      if (faltante) {
        throw new BadRequestException(
          `No se puede anular: el lote ${faltante.lote?.codigoLote} de "${faltante.item_nombre}" ya no existe`,
        );
      }
      const saldos: { lote_id: string; cantidad: string }[] =
        await manager.query(
          `SELECT lote_id, cantidad FROM lote_ubicacion
            WHERE lote_id = ANY($1::uuid[]) AND ubicacion_id = $2`,
          [deLote.map((l) => loteDe(l)!.lote_id), compra.ubicacion_id],
        );
      const trajo = new Map<string, Decimal>();
      for (const l of deLote) {
        const loteId = loteDe(l)!.lote_id;
        trajo.set(
          loteId,
          (trajo.get(loteId) ?? new Decimal(0)).plus(l.cantidad_base),
        );
        porLinea.set(l.compra_linea_id, { loteId });
      }
      for (const l of deLote) {
        const loteId = loteDe(l)!.lote_id;
        const hay = new Decimal(
          saldos.find((s) => s.lote_id === loteId)?.cantidad ?? 0,
        );
        if (hay.lessThan(trajo.get(loteId)!)) {
          throw noAlcanza(
            `del lote ${l.lote?.codigoLote} de "${l.item_nombre}"`,
            hay,
            trajo.get(loteId)!,
          );
        }
      }
    }

    const deSerie = lineas.filter((l) => l.modo_inventario === 'serie');
    if (deSerie.length) {
      const unidades: {
        unidad_id: string;
        item_id: string;
        serie: string;
        estado: string;
        ubicacion_id: string | null;
      }[] = await manager.query(
        `SELECT unidad_id, item_id, serie, estado, ubicacion_id FROM item_unidad
          WHERE item_id = ANY($1::uuid[]) AND serie = ANY($2::text[])
            AND tenant_id = $3 AND eliminado_el IS NULL`,
        [
          deSerie.map((l) => l.item_id),
          deSerie.flatMap((l) => (l.series ?? []).map((s) => s.serie)),
          tenantId,
        ],
      );
      for (const l of deSerie) {
        const ids: string[] = [];
        for (const s of l.series ?? []) {
          const u = unidades.find(
            (x) => x.item_id === l.item_id && x.serie === s.serie,
          );
          if (
            !u ||
            u.estado !== 'disponible' ||
            u.ubicacion_id !== compra.ubicacion_id
          ) {
            throw new BadRequestException(
              `No se puede anular: la unidad ${s.serie} de "${l.item_nombre}" ya no está disponible en ${compra.ubicacion_nombre}`,
            );
          }
          ids.push(u.unidad_id);
        }
        porLinea.set(l.compra_linea_id, { unidadIds: ids });
      }
    }

    return porLinea;
  }

  /**
   * Lock de la compra y los datos que las correcciones necesitan. 409 si no
   * está confirmada: un borrador se edita entero, y una anulada no se toca.
   *
   * Los `LEFT JOIN` de proveedor y documento van sin `eliminado_el`, por lo
   * mismo que la cabecera (`SELECT_CABECERA`): arman el comentario del kardex,
   * que tiene que seguir nombrando a quién se le compró. El `JOIN` a la
   * ubicación tampoco filtra, porque lo que se pregunta es si sigue viva: una
   * corrección de cantidad mueve stock ahí y sobre una borrada no puede.
   */
  private async bloquearConfirmada(
    tenantId: string,
    id: string,
    siEsBorrador = 'La compra es un borrador: se edita, no se corrige',
  ): Promise<CompraConfirmada> {
    const rows: (CompraConfirmada & { estado: EstadoCompra })[] =
      await this.db.query(
        `SELECT c.compra_id, c.estado, c.descuento_total, c.folio,
                td.nombre AS tipo_documento_nombre,
                pr.nombre AS proveedor_nombre,
                c.ubicacion_id, ub.nombre AS ubicacion_nombre,
                (ub.eliminado_el IS NULL) AS ubicacion_viva
           FROM compras c
           JOIN ubicaciones ub ON ub.ubicacion_id = c.ubicacion_id
           LEFT JOIN terceros pr ON pr.tercero_id = c.proveedor_id
           LEFT JOIN tipos_documento_compra td
                  ON td.tipo_documento_compra_id = c.tipo_documento_compra_id
          WHERE c.tenant_id = $1 AND c.compra_id = $2 AND c.eliminado_el IS NULL
          FOR UPDATE OF c`,
        [tenantId, id],
      );
    if (!rows.length) {
      throw new NotFoundException('Compra no encontrada');
    }
    if (rows[0].estado === 'borrador') {
      throw new ConflictException(siEsBorrador);
    }
    if (rows[0].estado === 'anulada') {
      throw new ConflictException('La compra está anulada');
    }
    return rows[0];
  }

  /**
   * Las líneas de una confirmada con lo congelado al confirmar. `items` va sin
   * filtro de borrado a propósito: lo que se pregunta es si el producto está en
   * la papelera, para rechazar la corrección con un mensaje que lo diga.
   */
  private async lineasConfirmadas(
    tenantId: string,
    compraId: string,
  ): Promise<LineaConfirmada[]> {
    return this.db.query(
      `SELECT cl.compra_linea_id, cl.item_id, i.nombre AS item_nombre,
              (i.eliminado_el IS NOT NULL) AS item_eliminado,
              ip.modo_inventario,
              COALESCE(ip.unidad_medida, 'unidad') AS unidad_base,
              cl.unidad_codigo, cl.cantidad, cl.precio_unitario,
              cl.cantidad_base, cl.costo_unitario_base, cl.series, cl.lote
         FROM compra_lineas cl
         JOIN items i ON i.item_id = cl.item_id
         JOIN item_producto ip ON ip.item_id = cl.item_id
        WHERE cl.tenant_id = $1 AND cl.compra_id = $2 AND cl.eliminado_el IS NULL
        ORDER BY cl.orden`,
      [tenantId, compraId],
    );
  }

  /**
   * Vuelve a costear la compra entera con los precios, cantidades y descuento
   * de ahora, guarda el costo de las líneas que cambiaron y rehace la cuenta
   * de cada producto afectado, en orden de `item_id`: el mismo orden de locks
   * que `ventas.crear()`, porque cada cuenta toma el lock de su producto.
   */
  private async recostear(
    manager: EntityManager,
    tenantId: string,
    usuarioId: string,
    compra: CompraConfirmada,
    lineas: LineaConfirmada[],
    queCambio: string,
    /** Productos cuya cuenta se rehace aunque su costo no cambie. */
    tambien: string[] = [],
  ): Promise<{
    cambiadas: LineaConfirmada[];
    movimientos: Map<string, string | null>;
  }> {
    const costos = await this.costearCompra(
      tenantId,
      lineas.map((l) => ({
        cantidad: l.cantidad,
        precioUnitario: l.precio_unitario,
        cantidadBase: l.cantidad_base,
        unidadBase: l.unidad_base,
      })),
      compra.descuento_total,
    );
    const cambiadas = lineas.filter(
      (l, i) => !mismoCosto(l.costo_unitario_base, costos[i]),
    );
    const itemIds = [
      ...new Set([...cambiadas.map((l) => l.item_id), ...tambien]),
    ].sort((a, b) => a.localeCompare(b));
    const enPapelera = lineas.find(
      (l) => l.item_eliminado && itemIds.includes(l.item_id),
    );
    if (enPapelera) {
      throw new BadRequestException(
        `El producto "${enPapelera.item_nombre}" está en la papelera: restauralo para corregir la compra`,
      );
    }
    if (!itemIds.length) {
      return { cambiadas, movimientos: new Map() };
    }

    const nuevos = new Map(
      lineas.map((l, i) => [l.compra_linea_id, costos[i]]),
    );
    if (cambiadas.length) {
      const valores = cambiadas
        .map((_, k) => `($${k * 2 + 2}::uuid, $${k * 2 + 3}::numeric)`)
        .join(', ');
      await this.db.query(
        `UPDATE compra_lineas cl
            SET costo_unitario_base = v.costo, actualizado_el = NOW()
           FROM (VALUES ${valores}) AS v(compra_linea_id, costo)
          WHERE cl.compra_linea_id = v.compra_linea_id AND cl.tenant_id = $1`,
        [
          tenantId,
          ...cambiadas.flatMap((l) => [
            l.compra_linea_id,
            nuevos.get(l.compra_linea_id),
          ]),
        ],
      );
    }

    const comentario = `${comentarioDeCompra(
      compra.tipo_documento_nombre,
      compra.folio,
      compra.proveedor_nombre,
    )}: ${queCambio}`;
    const movimientos = new Map<string, string | null>();
    for (const itemId of itemIds) {
      const r = await this.inventarioService.recalcularCostoDesdeCompra(
        manager,
        { tenantId, itemId, compraId: compra.compra_id, usuarioId, comentario },
      );
      movimientos.set(itemId, r.movimientoId);
    }
    return { cambiadas, movimientos };
  }

  /**
   * El costo por unidad base de cada línea (null si no tiene precio), con el
   * descuento al total repartido. Una sola regla para confirmar y para
   * corregir: si costearan distinto, la cuenta rehecha partiría de otro número.
   *
   * El chequeo de colapso rechaza el 0,0000 que nadie eligió. Mira la
   * conversión sola y, además, el costo con el descuento: uno parcial más la
   * conversión también puede dejar una línea en 0,0000. El único 0 elegido es
   * el de un descuento que se lleva la factura entera, porque con un reparto
   * proporcional es el único que deja en 0 una línea con precio.
   */
  private async costearCompra(
    tenantId: string,
    lineas: {
      cantidad: string;
      precioUnitario: string | null;
      cantidadBase: string;
      unidadBase: string;
    }[],
    descuentoTotal: string | null,
  ): Promise<(string | null)[]> {
    const conPrecio = lineas
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.precioUnitario != null);
    const resultado: (string | null)[] = lineas.map(() => null);
    if (!conPrecio.length) return resultado;

    const cfg = await this.calculoPreciosService.cargarConfig(
      tenantId,
      await this.monedasService.decimalesOficiales(tenantId),
    );
    const paraCostear = conPrecio.map(({ l }) => ({
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario!,
      cantidadBase: l.cantidadBase,
    }));
    const costos = costearLineas(paraCostear, descuentoTotal, cfg);
    const sinDescuento =
      descuentoTotal == null ? costos : costearLineas(paraCostear, null, cfg);
    const bruto = paraCostear.reduce(
      (acc, l) => acc.plus(new Decimal(l.cantidad).times(l.precioUnitario)),
      new Decimal(0),
    );
    const facturaEntera =
      descuentoTotal != null && new Decimal(descuentoTotal).equals(bruto);
    conPrecio.forEach(({ l, i }, k) => {
      assertCostoNoColapsaACero(
        l.precioUnitario!,
        sinDescuento[k],
        l.unidadBase,
      );
      if (!facturaEntera) {
        assertCostoNoColapsaACero(l.precioUnitario!, costos[k], l.unidadBase);
      }
      resultado[i] = costos[k];
    });
    return resultado;
  }

  /** Todas las filas del historial en UN insert. */
  private async registrarCambios(
    tenantId: string,
    usuarioId: string,
    cambios: {
      compraLineaId: string;
      campo: 'precio' | 'cantidad' | 'descuento';
      anterior: string | null;
      nuevo: string | null;
      movimientoId: string | null;
    }[],
  ): Promise<void> {
    if (!cambios.length) return;
    const COLUMNAS = 7;
    const valores = cambios
      .map((_, k) => {
        const p = k * COLUMNAS + 1;
        return `($${p}, $${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6})`;
      })
      .join(', ');
    await this.db.query(
      `INSERT INTO compra_linea_cambios
         (compra_linea_id, tenant_id, campo, valor_anterior, valor_nuevo,
          usuario_id, movimiento_id)
       VALUES ${valores}`,
      cambios.flatMap((c) => [
        c.compraLineaId,
        tenantId,
        c.campo,
        c.anterior,
        c.nuevo,
        usuarioId,
        c.movimientoId,
      ]),
    );
  }

  /**
   * Una transacción con el reintento ante deadlock de siempre
   * (`MAX_REINTENTOS_DEADLOCK`). Vale porque los llamadores son el controller:
   * sin transacción envolvente, un `40P01` reintenta limpio (mismo
   * razonamiento que `TrasladosService.crear`).
   */
  private async conReintento<T>(
    fn: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    for (let intento = 0; ; intento++) {
      try {
        return await this.db.transaccion(fn);
      } catch (error) {
        if (intento >= MAX_REINTENTOS_DEADLOCK || !esDeadlock(error))
          throw error;
      }
    }
  }

  /**
   * El folio repetido es 409, y el mensaje nombra la compra que ya lo tiene.
   * Por ley el folio es único por emisor y tipo de documento (owner,
   * 2026-09-18). "Sin documento" no tiene folio y no entra; una anulada
   * libera el suyo. Lo vuelve a llamar la confirmación.
   */
  async assertFolioLibre(
    tenantId: string,
    proveedorId: string,
    tipoDocumentoCompraId: string,
    enc: EncabezadoValidado,
    excluirCompraId?: string,
  ): Promise<void> {
    if (enc.folio == null) return;
    const rows: { fecha_documento: string; estado: EstadoCompra }[] =
      await this.db.query(
        `SELECT fecha_documento::text AS fecha_documento, estado
           FROM compras
          WHERE tenant_id = $1 AND proveedor_id = $2
            AND tipo_documento_compra_id = $3 AND folio = $4
            AND estado <> 'anulada' AND eliminado_el IS NULL
            AND ($5::uuid IS NULL OR compra_id <> $5::uuid)
          LIMIT 1`,
        [
          tenantId,
          proveedorId,
          tipoDocumentoCompraId,
          enc.folio,
          excluirCompraId ?? null,
        ],
      );
    if (rows.length) {
      const donde =
        rows[0].estado === 'borrador' ? ' (está en un borrador)' : '';
      throw new ConflictException(
        `Ya cargaste ${enc.tipoDocumentoNombre} ${enc.folio} de ` +
          `${enc.proveedorNombre}, con fecha ${rows[0].fecha_documento}${donde}`,
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Validaciones
  // ───────────────────────────────────────────────────────────────────────

  private async validarEncabezado(
    tenantId: string,
    dto: CompraBorradorDto,
  ): Promise<EncabezadoValidado> {
    const proveedores: {
      nombre: string;
      tipo: string;
      activo: boolean;
    }[] = await this.db.query(
      `SELECT nombre, tipo, activo FROM terceros
        WHERE tercero_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [dto.proveedorId, tenantId],
    );
    // Mismo mensaje para "no existe" y "es de otro tenant": un id ajeno tiene
    // que ser indistinguible de uno inexistente.
    if (!proveedores.length) {
      throw new BadRequestException('Proveedor no encontrado');
    }
    const proveedor = proveedores[0];
    if (proveedor.tipo !== 'proveedor') {
      throw new BadRequestException(`"${proveedor.nombre}" no es un proveedor`);
    }
    // Un tercero pausado no se puede elegir de nuevo (docs/patterns/backend.md
    // § 2, "se referencia"): se lee aparte del WHERE para que "pausado" y "no
    // es de este tenant" sean errores distintos.
    if (!proveedor.activo) {
      throw new BadRequestException(`"${proveedor.nombre}" está pausado`);
    }

    // El tipo tiene que ser del país del tenant (tenant → provincia → país).
    const tipos: { nombre: string; requiere_folio: boolean }[] =
      await this.db.query(
        `SELECT td.nombre, td.requiere_folio
           FROM tenants t
           JOIN provincia prov ON prov.provincia_id = t.provincia_id
                AND prov.eliminado_el IS NULL
           JOIN tipos_documento_compra td ON td.pais_id = prov.pais_id
                AND td.activo AND td.eliminado_el IS NULL
          WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL
            AND td.tipo_documento_compra_id = $2`,
        [tenantId, dto.tipoDocumentoCompraId],
      );
    if (!tipos.length) {
      throw new BadRequestException(
        'Tipo de documento no válido para el país del tenant',
      );
    }
    const tipo = tipos[0];

    const folioTipeado = dto.folio?.trim() || null;
    if (tipo.requiere_folio && !folioTipeado) {
      throw new BadRequestException('Este documento necesita folio');
    }
    const folio = tipo.requiere_folio ? folioTipeado : null;

    const ubicaciones: { nombre: string; activo: boolean }[] =
      await this.db.query(
        `SELECT nombre, activo FROM ubicaciones
          WHERE ubicacion_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [dto.ubicacionId, tenantId],
      );
    if (!ubicaciones.length) {
      throw new BadRequestException('Ubicación no encontrada');
    }
    if (!ubicaciones[0].activo) {
      throw new BadRequestException(
        `"${ubicaciones[0].nombre}" está desactivada: no puede recibir mercadería`,
      );
    }

    return {
      folio,
      proveedorNombre: proveedor.nombre,
      tipoDocumentoNombre: tipo.nombre,
    };
  }

  /**
   * Una consulta para todos los ítems y una para el catálogo de unidades
   * (`crearConversor`), no una por línea. El conversor valida cada línea en
   * memoria y en su lugar del loop, así que el orden de los 400 no cambia.
   */
  private async validarLineas(
    tenantId: string,
    lineas: LineaCompraDto[],
  ): Promise<Map<string, { unidadBase: string }>> {
    if (!lineas.length) return new Map();

    const itemIds = [...new Set(lineas.map((l) => l.itemId))];
    const items: {
      item_id: string;
      nombre: string;
      tipo: string;
      modo_inventario: string | null;
      unidad_medida: string | null;
    }[] = await this.db.query(
      `SELECT i.item_id, i.nombre, i.tipo, ip.modo_inventario, ip.unidad_medida
         FROM items i
         LEFT JOIN item_producto ip ON ip.item_id = i.item_id
        WHERE i.item_id = ANY($1::uuid[]) AND i.tenant_id = $2
          AND i.eliminado_el IS NULL`,
      [itemIds, tenantId],
    );
    const porId = new Map(items.map((i) => [i.item_id, i]));

    let convertir:
      | ((cantidad: string, desde: string, hacia: string) => string)
      | null = null;
    for (const linea of lineas) {
      const item = porId.get(linea.itemId);
      if (!item) {
        throw new BadRequestException('Producto no encontrado');
      }
      if (!TIPOS_CON_STOCK.includes(item.tipo) || !item.modo_inventario) {
        throw new BadRequestException(`"${item.nombre}" no lleva stock`);
      }

      const base = item.unidad_medida ?? 'unidad';
      if (linea.unidadCodigo !== base) {
        if (item.modo_inventario !== 'cantidad') {
          // El mismo mensaje que `ItemsService.ajustarStock`.
          throw new BadRequestException(
            'Los productos por serie o lote solo admiten su unidad base',
          );
        }
        // El catálogo se carga la primera vez que hace falta, no antes: una
        // factura toda en la unidad base no lo consulta. Tira con el mensaje
        // del catálogo, sin reescribirlo.
        convertir ??= await this.catalogService.crearConversor();
        convertir(linea.cantidad, linea.unidadCodigo, base);
      }

      this.validarTrazabilidad(linea, item.nombre, item.modo_inventario);
    }

    return new Map(
      items.map((i) => [
        i.item_id,
        { unidadBase: i.unidad_medida ?? 'unidad' },
      ]),
    );
  }

  private validarTrazabilidad(
    linea: LineaCompraDto,
    nombre: string,
    modo: string,
  ): void {
    const series = linea.series ?? [];
    if (modo === 'serie') {
      const cantidad = new Decimal(linea.cantidad);
      if (!cantidad.isInteger() || !cantidad.equals(series.length)) {
        throw new BadRequestException(
          `"${nombre}" va por serie: necesita una serie por unidad ` +
            `(${linea.cantidad} unidades, ${series.length} series)`,
        );
      }
      const distintas = new Set(series.map((s) => s.serie.trim()));
      if (distintas.size !== series.length) {
        throw new BadRequestException(`"${nombre}" tiene series repetidas`);
      }
      if (linea.lote) {
        throw new BadRequestException(`"${nombre}" va por serie, no por lote`);
      }
      return;
    }
    if (modo === 'lote') {
      if (!linea.lote) {
        throw new BadRequestException(`"${nombre}" va por lote: falta el lote`);
      }
      if (series.length) {
        throw new BadRequestException(`"${nombre}" va por lote, no por serie`);
      }
      return;
    }
    if (series.length || linea.lote) {
      throw new BadRequestException(`"${nombre}" no lleva series ni lote`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Escritura
  // ───────────────────────────────────────────────────────────────────────

  /** `FOR UPDATE` del encabezado antes de tocar líneas (molde: recuentos). */
  private async bloquearBorrador(tenantId: string, id: string): Promise<void> {
    const rows: { estado: EstadoCompra }[] = await this.db.query(
      `SELECT estado FROM compras
        WHERE tenant_id = $1 AND compra_id = $2 AND eliminado_el IS NULL
        FOR UPDATE`,
      [tenantId, id],
    );
    if (!rows.length) {
      throw new NotFoundException('Compra no encontrada');
    }
    if (rows[0].estado === 'confirmada') {
      throw new ConflictException('La compra ya está confirmada');
    }
    if (rows[0].estado === 'anulada') {
      throw new ConflictException('La compra está anulada');
    }
  }

  /** Todas las líneas en UN insert, no una por línea. */
  private async insertarLineas(
    tenantId: string,
    compraId: string,
    lineas: LineaCompraDto[],
  ): Promise<void> {
    if (!lineas.length) return;
    const COLUMNAS = 9;
    const valores = lineas
      .map((_, i) => {
        const p = i * COLUMNAS;
        return `($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8}::jsonb, $${p + 9}::jsonb)`;
      })
      .join(', ');
    const params = lineas.flatMap((l, i) => [
      compraId,
      tenantId,
      l.itemId,
      i + 1,
      l.cantidad,
      l.unidadCodigo,
      l.precioUnitario ?? null,
      l.series?.length ? JSON.stringify(l.series) : null,
      l.lote ? JSON.stringify(l.lote) : null,
    ]);
    await this.db.query(
      `INSERT INTO compra_lineas
         (compra_id, tenant_id, item_id, orden, cantidad, unidad_codigo,
          precio_unitario, series, lote)
       VALUES ${valores}`,
      params,
    );
  }

  /**
   * La red del índice `uq_compra_folio` contra la carrera entre el pre-check y
   * la escritura: dos cargas simultáneas de la misma factura. Llega como
   * `23505` y se traduce al mismo 409, sin el detalle que el pre-check sí da.
   */
  private async insertarSinChoqueDeFolio<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const e = error as { code?: string; constraint?: string };
      if (e.code === '23505' && e.constraint === 'uq_compra_folio') {
        throw new ConflictException(
          'Ese folio ya está cargado para este proveedor y tipo de documento',
        );
      }
      throw error;
    }
  }

  private mapListItem(r: CabeceraRow): CompraListItem {
    return { ...this.mapCabecera(r), lineas: r.lineas };
  }

  private mapCabecera(r: CabeceraRow): Omit<CompraListItem, 'lineas'> {
    const sinPrecio = r.algun_sin_precio;
    const total =
      r.lineas > 0 && !sinPrecio && r.bruto != null
        ? new Decimal(r.bruto).minus(r.descuento_total ?? 0).toString()
        : null;
    return {
      id: r.compra_id,
      estado: r.estado,
      faltaCosto: r.estado === 'confirmada' && sinPrecio,
      fechaDocumento: r.fecha_documento,
      proveedorId: r.proveedor_id,
      proveedorNombre: r.proveedor_nombre,
      tipoDocumentoCompraId: r.tipo_documento_compra_id,
      tipoDocumentoNombre: r.tipo_documento_nombre,
      folio: r.folio,
      ubicacionId: r.ubicacion_id,
      ubicacionNombre: r.ubicacion_nombre,
      total,
    };
  }
}
