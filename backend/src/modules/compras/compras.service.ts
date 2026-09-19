import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';
import { unwrap } from '../../common/utils/pg-returning.util';
import { CatalogService } from '../catalog/catalog.service';
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
    const cabecera: CabeceraRow[] = await this.db.query(
      `SELECT ${SELECT_CABECERA}
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
                fecha_documento, ubicacion_id, observacion, creado_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
                  actualizado_el = NOW()
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

  /** Soft delete. Una compra confirmada no se descarta: se anula. */
  async descartarBorrador(
    tenantId: string,
    usuarioId: string,
    id: string,
  ): Promise<void> {
    await this.db.transaccion(async () => {
      await this.bloquearBorrador(tenantId, id);
      await this.db.query(
        `UPDATE compra_lineas SET eliminado_el = NOW()
          WHERE tenant_id = $1 AND compra_id = $2 AND eliminado_el IS NULL`,
        [tenantId, id],
      );
      await this.db.query(
        `UPDATE compras SET eliminado_el = NOW(), eliminado_por = $3
          WHERE tenant_id = $1 AND compra_id = $2`,
        [tenantId, id, usuarioId],
      );
    });
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
  ): Promise<void> {
    if (!lineas.length) return;

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
