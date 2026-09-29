import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
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
import {
  diaNegocioTenant,
  diaNegocioEnZona,
} from '../../common/utils/rango-fecha.util';
import { CatalogService } from '../catalog/catalog.service';
import {
  InventarioService,
  type RegistrarMovimientoParams,
} from '../inventario/inventario.service';
import { UbicacionesService } from '../ubicaciones/ubicaciones.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import {
  cuantizar,
  type ConfigCalculo,
} from '../calculo-precios/calculo-precios.engine';
import { MonedasService } from '../monedas/monedas.service';
import { CajaService, IntentoRechazadoError } from '../caja/caja.service';
import { IdempotenciaService } from '../idempotencia/idempotencia.service';
import { huellaDe } from '../idempotencia/huella';
import { costearLineas } from './reparto-descuento';
import {
  vencimiento,
  fondear,
  recortar,
  totalCompra,
  estadoPagoCompra,
  sumarDias,
  type EstadoPagoCompra,
} from './deuda';
// `TIPOS_CON_STOCK` nació acá y se movió a `presentaciones-compra.service.ts`
// (Tarea 1 de compras-unidad-de-compra) porque esta clase importa
// `PresentacionesCompraService` (Tarea 2): si la constante siguiera acá ese
// import sería circular.
import {
  PresentacionesCompraService,
  TIPOS_CON_STOCK,
} from './presentaciones-compra.service';
import { LecturaDteService } from './lectura-dte.service';
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
  ActualizarDocumentoDto,
  CorregirDescuentoDto,
  CorregirLineaDto,
} from './dto/corregir-compra.dto';
import type {
  AnularPagoProveedorDto,
  CrearPagoProveedorDto,
  PagoAlConfirmarDto,
} from './dto/pago-proveedor.dto';
import type { EstadoPagoProveedor } from './entities/pago-proveedor.entity';

export interface TipoDocumentoCompraOpcion {
  id: string;
  nombre: string;
  codigo: string | null;
  requiereFolio: boolean;
  /** Qué total lleva (spec § 3, decisión 10): gobierna el campo "Total del documento". */
  totalDocumento: string;
}

export interface ProveedorOpcion {
  id: string;
  nombre: string;
  rut: string | null;
  /** Para sugerir "Vence el" en el borrador (spec § 4.2). Null = 30 días. */
  plazoPagoDias: number | null;
}

export interface ProductoCompraOpcion {
  id: string;
  nombre: string;
  modoInventario: string;
  unidadMedida: string | null;
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
  /**
   * Lo que se sabe que hay que pagar (spec § 4.1, decisión 10): el total
   * transcrito en un tipo `obligatorio`/`opcional`, o Σ cantidad × precio −
   * descuento en un `suma_lineas`. Null si es desconocido (falta el
   * transcrito, o falta el precio de alguna línea).
   */
  total: string | null;
  /** Lo transcrito, tal cual (null en un tipo `suma_lineas`, o si no se cargó). */
  totalDocumento: string | null;
  /** Se fija al confirmar; null en un borrador. */
  fechaVencimiento: string | null;
  /**
   * Los datos de pago (spec § 8, decisión 12): SOLO presentes cuando el
   * caller tiene `Compras:Pagar` — el controller resuelve el permiso, el
   * service arma la consulta con o sin esta parte, y sin `Pagar` la clave ni
   * viaja en la respuesta (nunca `null`: `undefined`, que `JSON.stringify`
   * omite). Solo tiene sentido en una `confirmada`: un borrador o una
   * anulada no deben nada (spec § 4.1).
   */
  estadoPago?: EstadoPagoCompra;
  deuda?: string | null;
  vencida?: boolean;
}

/** La presentación de una línea, para el detalle (spec pieza 2 § 5). */
export interface PresentacionLinea {
  id: string;
  nombre: string;
  /** Borrador: como está hoy, en `unidadCodigo`. Confirmada: el congelado, en la unidad base. */
  contenido: string;
  unidadCodigo: string;
}

export interface CompraLineaDetalle {
  id: string;
  orden: number;
  itemId: string;
  itemNombre: string | null;
  modoInventario: string | null;
  unidadMedidaBase: string | null;
  cantidad: string;
  /** Null si la línea va en una presentación. */
  unidadCodigo: string | null;
  precioUnitario: string | null;
  series: SerieCompraInput[] | null;
  lote: LoteCompraInput | null;
  presentacion: PresentacionLinea | null;
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
  /** Solo con `Pagar` (spec § 8): Σ aplicaciones vivas. */
  aplicado?: string;
  /** Solo con `Pagar`: los pagos vigentes que aplicaron algo a esta compra. */
  pagos?: PagoProveedorInfo[];
}

/** Medio de pago habilitado del tenant, para `PagarProveedorModal` (spec § 5.1). */
export interface MedioPagoOpcion {
  id: string;
  nombre: string;
  esEfectivo: boolean;
}

/** Lo aplicado de un pago (o de este pago recién hecho) a una compra. */
export interface AplicacionPagoInfo {
  compraId: string;
  monto: string;
}

/** Un pago a proveedor, con sus aplicaciones (spec § 3 y § 8). */
export interface PagoProveedorInfo {
  /** `null` cuando el pago fue "usar el saldo a favor" (monto 0, spec § 5.1): no se creó fila. */
  id: string | null;
  proveedorId: string;
  fecha: string | null;
  monto: string;
  metodoPagoId: string | null;
  metodoPagoNombre: string | null;
  referencia: string | null;
  cajaId: string | null;
  estado: 'vigente' | 'anulado' | null;
  anuladoPor: string | null;
  anuladoEl: Date | null;
  motivoAnulacion: string | null;
  aplicaciones: AplicacionPagoInfo[];
  /** Lo que quedó a favor del proveedor DESPUÉS de este pago (spec § 5.1). */
  sobranteAFavor: string;
}

/** Una fila de `GET /compras/por-pagar` (spec § 8): un proveedor. */
export interface PorPagarProveedorItem {
  proveedorId: string;
  proveedorNombre: string | null;
  /** Σ deuda conocida de sus compras confirmadas. */
  deuda: string;
  /** De esa deuda, la que ya venció. */
  vencido: string;
  /** De esa deuda, la que vence dentro de los próximos 7 días (sin contar la ya vencida). */
  venceProximos7Dias: string;
  /** Compras confirmadas cuyo total todavía no se sabe (decisión 8). */
  comprasTotalDesconocido: number;
  saldoAFavor: string;
}

/** Una compra de `GET /compras/por-pagar/:proveedorId` (spec § 8). */
export interface PorPagarCompraItem {
  id: string;
  fechaDocumento: string;
  folio: string | null;
  tipoDocumentoNombre: string | null;
  total: string | null;
  totalDocumento: string | null;
  fechaVencimiento: string | null;
  estadoPago: EstadoPagoCompra;
  deuda: string | null;
  vencida: boolean;
}

export interface PorPagarProveedorDetalle {
  compras: PorPagarCompraItem[];
  /** Sus pagos vigentes con saldo a favor > 0. */
  pagos: PagoProveedorInfo[];
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
  tipo_documento_total_documento: string | null;
  ubicacion_id: string;
  ubicacion_nombre: string | null;
  descuento_total: string | null;
  observacion: string | null;
  lineas: number;
  algun_sin_precio: boolean;
  bruto: string | null;
  total_documento: string | null;
  fecha_vencimiento: string | null;
  /** Σ aplicaciones vivas de pagos vigentes (spec § 4.1). Solo se USA con `Pagar`. */
  aplicado: string;
}

interface LineaRow {
  compra_linea_id: string;
  orden: number;
  item_id: string;
  item_nombre: string | null;
  modo_inventario: string | null;
  unidad_medida: string | null;
  cantidad: string;
  unidad_codigo: string | null;
  precio_unitario: string | null;
  series: SerieCompraInput[] | null;
  lote: LoteCompraInput | null;
  presentacion_compra_id: string | null;
  presentacion_nombre: string | null;
  contenido_base: string | null;
  /** La presentación VIVA, si la línea sigue en borrador y no fue retirada. */
  pc_nombre: string | null;
  pc_contenido: string | null;
  pc_unidad: string | null;
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
  /** Qué total lleva el tipo de esta compra (spec § 6, decisión 10). */
  tipo_documento_total_documento: string | null;
  proveedor_nombre: string | null;
  total_documento: string | null;
  fecha_vencimiento: string | null;
}

/** Una línea de una compra confirmada, con lo congelado al confirmar. */
interface LineaConfirmada {
  compra_linea_id: string;
  item_id: string;
  item_nombre: string;
  item_eliminado: boolean;
  modo_inventario: string;
  unidad_base: string;
  /** Null si la línea va en una presentación. */
  unidad_codigo: string | null;
  cantidad: string;
  precio_unitario: string | null;
  cantidad_base: string;
  costo_unitario_base: string | null;
  /** El congelado al confirmar (null sin presentación): corregir la cantidad usa este, no el vivo. */
  contenido_base: string | null;
  presentacion_nombre: string | null;
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
  /** Qué total lleva el tipo (spec § 3, decisión 10). */
  tipoDocumentoTotalDocumento: string;
  /** El plazo de pago del proveedor; null = usa el default (spec § 2). */
  plazoPagoDias: number | null;
}

type Conversor = (cantidad: string, desde: string, hacia: string) => string;

/**
 * La cantidad de una línea en la unidad base del producto: el ÚNICO lugar que
 * la calcula (spec compras-unidad-de-compra § 4.2). Lo llaman la validación del
 * borrador, confirmar y la corrección de cantidad. Si alguno convirtiera por su
 * cuenta, ese sería el camino que lee "10 cajas" como 10 unidades.
 *
 * `conversor` es perezoso: una factura toda en la unidad base, o toda en
 * presentaciones con contenido ya en base, no consulta el catálogo.
 */
export async function cantidadEnBase(
  cantidad: string,
  unidad: { contenidoBase: string } | { unidadCodigo: string },
  unidadBase: string,
  conversor: () => Promise<Conversor>,
): Promise<string> {
  if ('contenidoBase' in unidad) {
    const base = new Decimal(cantidad)
      .times(unidad.contenidoBase)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    if (base.isZero()) {
      throw new BadRequestException(
        `La cantidad (${cantidad} × ${unidad.contenidoBase}) es menor a la precisión de stock (4 decimales)`,
      );
    }
    return base.toString();
  }
  if (unidad.unidadCodigo === unidadBase) return cantidad;
  return (await conversor())(cantidad, unidad.unidadCodigo, unidadBase);
}

/** Por índice de línea: con qué se convierte a la unidad base. */
interface UnidadResuelta {
  unidadBase: string;
  /** Null si la línea va en una unidad del catálogo. */
  presentacion: { id: string; nombre: string; contenidoBase: string } | null;
}

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
 * `td.total_documento` (spec compras-deuda-proveedor § 3, decisión 10) viaja
 * por el mismo `LEFT JOIN` sin filtro, y por la misma razón: qué total lleva
 * el tipo es un atributo **inmutable** de esa fila del catálogo —no cambia
 * con el tiempo, a diferencia de `activo`—, así que leerlo sin filtrar
 * `eliminado_el` no es distinto de leer `td.nombre`. Si el tipo se borra
 * después, la compra sigue sabiendo si su total era transcrito o calculado, y
 * `mapCabecera` (más abajo) lo necesita para decidir qué mostrar como
 * `total`.
 *
 * El agregado de líneas sí filtra: una línea reemplazada en un borrador queda
 * borrada y no cuenta.
 */
const SELECT_CABECERA = `
  c.compra_id, c.estado, c.fecha_documento::text AS fecha_documento, c.folio,
  c.proveedor_id, pr.nombre AS proveedor_nombre,
  c.tipo_documento_compra_id, td.nombre AS tipo_documento_nombre,
  td.total_documento AS tipo_documento_total_documento,
  c.ubicacion_id, ub.nombre AS ubicacion_nombre,
  c.descuento_total, c.observacion,
  c.total_documento, c.fecha_vencimiento::text AS fecha_vencimiento,
  COALESCE(ag.lineas, 0)::int AS lineas,
  COALESCE(ag.algun_sin_precio, false) AS algun_sin_precio,
  ag.bruto,
  COALESCE(pagoag.aplicado, 0)::text AS aplicado`;

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
  LEFT JOIN ubicaciones ub ON ub.ubicacion_id = c.ubicacion_id
  -- Aplicado (spec § 4.1): SUM de aplicaciones VIVAS. Sin filtrar por el
  -- estado de pagos_proveedor: anular un pago (spec § 5.2) ya marca
  -- eliminado_el en TODAS sus aplicaciones, y anular una compra (§ 6,
  -- decisión 6b) también -- así que "vigente" y "aplicación viva" coinciden
  -- acá, y agregar el JOIN a pagos_proveedor solo para repetir el mismo
  -- filtro sería una vuelta de más.
  LEFT JOIN (
    SELECT compra_id, SUM(monto) AS aplicado
      FROM pago_proveedor_aplicaciones
     WHERE tenant_id = $1 AND eliminado_el IS NULL
     GROUP BY compra_id
  ) pagoag ON pagoag.compra_id = c.compra_id`;

@Injectable()
export class ComprasService {
  constructor(
    private readonly db: Db,
    private readonly catalogService: CatalogService,
    private readonly inventarioService: InventarioService,
    private readonly ubicacionesService: UbicacionesService,
    private readonly calculoPreciosService: CalculoPreciosService,
    private readonly monedasService: MonedasService,
    private readonly presentacionesService: PresentacionesCompraService,
    private readonly lecturaDteService: LecturaDteService,
    private readonly cajaService: CajaService,
    private readonly idempotencia: IdempotenciaService,
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
      total_documento: string;
    }[] = await this.db.query(
      `SELECT td.tipo_documento_compra_id, td.nombre, td.codigo,
              td.requiere_folio, td.total_documento
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
      totalDocumento: r.total_documento,
    }));
  }

  /**
   * Terceros activos de tipo `proveedor`. Endpoint propio de Compras a
   * propósito: el bodeguero no necesita permiso de Terceros para elegir a
   * quién le compró (spec § 5).
   */
  async proveedores(tenantId: string): Promise<ProveedorOpcion[]> {
    const rows: {
      tercero_id: string;
      nombre: string;
      rut: string | null;
      plazo_pago_dias: number | null;
    }[] = await this.db.query(
      `SELECT tercero_id, nombre, rut, plazo_pago_dias
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
      plazoPagoDias: r.plazo_pago_dias,
    }));
  }

  /**
   * Lo que se puede comprar: los productos e ingredientes con stock del
   * tenant. Es propio de Compras por lo mismo que `proveedores` (spec § 5,
   * owner 2026-09-19): el bodeguero elige qué recibió sin permiso sobre el
   * catálogo de ítems, que muestra precios de venta y deja editarlos. Sin él,
   * `encargado.compras` recibía 403 en `GET /items` y no podía cargar una
   * compra desde la pantalla.
   *
   * Es el mismo conjunto que acepta `validarLineas`: ofrecer algo que después
   * rebota, o esconder algo que se acepta, desincroniza la pantalla del
   * backend.
   */
  async productos(tenantId: string): Promise<ProductoCompraOpcion[]> {
    const rows: {
      item_id: string;
      nombre: string;
      modo_inventario: string;
      unidad_medida: string | null;
    }[] = await this.db.query(
      `SELECT i.item_id, i.nombre, ip.modo_inventario, ip.unidad_medida
         FROM items i
         JOIN item_producto ip ON ip.item_id = i.item_id
        WHERE i.tenant_id = $1 AND i.tipo = ANY($2::text[])
          AND i.eliminado_el IS NULL
        ORDER BY i.nombre`,
      [tenantId, TIPOS_CON_STOCK],
    );
    return rows.map((r) => ({
      id: r.item_id,
      nombre: r.nombre,
      modoInventario: r.modo_inventario,
      unidadMedida: r.unidad_medida,
    }));
  }

  /**
   * Las unidades serializadas que trajo una línea y siguen disponibles en la
   * ubicación de la compra: las únicas que pueden salir al bajar su cantidad
   * (owner, 2026-09-19). Propio de Compras por lo mismo que `productos`: sin
   * él, corregir exigía `Items:Leer`.
   *
   * `item_unidad` filtra `eliminado_el`; `compras` y `compra_lineas` también,
   * aunque una confirmada no se borra.
   */
  async unidadesDeLinea(
    tenantId: string,
    compraId: string,
    lineaId: string,
  ): Promise<{ id: string; serie: string }[]> {
    const linea: { compra_linea_id: string }[] = await this.db.query(
      `SELECT cl.compra_linea_id
         FROM compra_lineas cl
         JOIN compras c ON c.compra_id = cl.compra_id
          AND c.tenant_id = cl.tenant_id AND c.eliminado_el IS NULL
        WHERE cl.tenant_id = $1 AND cl.compra_id = $2
          AND cl.compra_linea_id = $3 AND cl.eliminado_el IS NULL`,
      [tenantId, compraId, lineaId],
    );
    if (!linea.length) {
      throw new NotFoundException('Línea no encontrada');
    }
    const rows: { unidad_id: string; serie: string }[] = await this.db.query(
      `SELECT u.unidad_id, u.serie
         FROM compra_lineas cl
         JOIN compras c
           ON c.compra_id = cl.compra_id AND c.tenant_id = cl.tenant_id
          AND c.eliminado_el IS NULL
         JOIN item_unidad u
           ON u.item_id = cl.item_id AND u.tenant_id = cl.tenant_id
          AND u.ubicacion_id = c.ubicacion_id AND u.estado = 'disponible'
          AND u.eliminado_el IS NULL
        WHERE cl.tenant_id = $1 AND cl.compra_linea_id = $2
          AND cl.eliminado_el IS NULL
          AND u.serie IN (
            SELECT s->>'serie' FROM jsonb_array_elements(cl.series) s
          )
        ORDER BY u.serie`,
      [tenantId, lineaId],
    );
    return rows.map((r) => ({ id: r.unidad_id, serie: r.serie }));
  }

  // ───────────────────────────────────────────────────────────────────────
  // Lecturas
  // ───────────────────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    query: FindComprasDto,
    /** `Compras:Pagar`, resuelto por el controller (spec § 8, decisión 12). */
    tienePagar: boolean,
  ): Promise<PaginatedResponse<CompraListItem>> {
    const { page, pageSize, offset } = resolvePagination(query);
    const cfg = await this.cfgTenant(tenantId);
    const pago = tienePagar
      ? {
          tienePagar: true,
          hoy: await this.hoyNegocio(tenantId),
        }
      : null;

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

    // El filtro `estadoPago` (spec § 8, decisión 12 — el controller ya
    // verificó `Pagar` antes de llegar acá) no se puede resolver en SQL: el
    // total de un `suma_lineas` pasa por `cuantizar` (Decimal.js, Global
    // Constraints — no se reimplementa en SQL). Se trae TODO lo que cumple
    // el resto de los filtros —sigue siendo UNA consulta, sin N+1— y la
    // paginación se resuelve en memoria en vez de `LIMIT`/`OFFSET`.
    if (query.estadoPago) {
      const todas: CabeceraRow[] = await this.db.query(
        `SELECT ${SELECT_CABECERA}
           FROM compras c
           ${JOINS_CABECERA}
          WHERE ${where}
          ORDER BY c.fecha_documento DESC, c.creado_el DESC`,
        params,
      );
      const filtradas = todas
        .map((r) => this.mapListItem(r, cfg, pago))
        .filter((m) =>
          query.estadoPago === 'vencida'
            ? m.vencida === true
            : m.estadoPago === query.estadoPago,
        );
      return {
        data: filtradas.slice(offset, offset + pageSize),
        meta: buildPaginationMeta(page, pageSize, filtradas.length),
      };
    }

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
      data: rows.map((r) => this.mapListItem(r, cfg, pago)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  /** Encabezado, líneas e historial: tres consultas fijas, sin importar el largo (más una cuarta con `Pagar`). */
  async findOne(
    tenantId: string,
    id: string,
    /**
     * `Compras:Pagar`, resuelto por el controller (spec § 8, decisión 12).
     * Default `false` SOLO para el caller que no lo resuelve (`crearBorrador`/
     * `actualizarBorrador`, que operan sobre un borrador — sin aplicaciones,
     * no hay nada que traer de todos modos). Los caminos que devuelven una
     * `CompraDetalle` después de escribir sobre una confirmada
     * (`corregirLinea`, `corregirDescuento`, `actualizarDocumento`, `anular`,
     * `confirmar` con `pago`) reciben el `tienePagar` de SU controller y lo
     * reenvían acá: la opción segura (omitir) solo aplica cuando de verdad no
     * hay con qué resolverlo.
     */
    tienePagar = false,
  ): Promise<CompraDetalle> {
    const cfg = await this.cfgTenant(tenantId);
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
              cl.precio_unitario, cl.series, cl.lote,
              cl.presentacion_compra_id, cl.presentacion_nombre, cl.contenido_base,
              pc.nombre AS pc_nombre, pc.contenido AS pc_contenido,
              pc.unidad_codigo AS pc_unidad
         FROM compra_lineas cl
         LEFT JOIN items i ON i.item_id = cl.item_id
         LEFT JOIN item_producto ip ON ip.item_id = cl.item_id
         LEFT JOIN presentaciones_compra pc
                ON pc.presentacion_compra_id = cl.presentacion_compra_id
               AND pc.eliminado_el IS NULL
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

    // Con `Pagar` (spec § 8): los pagos vigentes que cubren ESTA compra, con
    // el mismo shape que `listarPagos`. Solo en `confirmada` (un borrador o
    // una anulada no tienen aplicaciones vivas: § 4.1 y decisión 6b).
    const pago =
      tienePagar && cabecera[0].estado === 'confirmada'
        ? {
            tienePagar: true,
            hoy: await this.hoyNegocio(tenantId),
          }
        : null;
    const pagos = pago ? await this.pagosQueCubren(tenantId, id) : undefined;

    return {
      ...this.mapCabecera(cabecera[0], cfg, pago),
      observacion: cabecera[0].observacion,
      descuentoTotal: cabecera[0].descuento_total,
      motivoAnulacion: cabecera[0].motivo_anulacion,
      ...(pago ? { aplicado: cabecera[0].aplicado, pagos } : {}),
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
        // Confirmada: lo congelado. Borrador: la presentación viva (o null si
        // fue retirada — no se lee la fila borrada).
        presentacion:
          l.contenido_base != null
            ? {
                id: l.presentacion_compra_id!,
                nombre: l.presentacion_nombre!,
                contenido: l.contenido_base,
                unidadCodigo: l.unidad_medida ?? 'unidad',
              }
            : l.pc_nombre != null
              ? {
                  id: l.presentacion_compra_id!,
                  nombre: l.pc_nombre,
                  contenido: l.pc_contenido!,
                  unidadCodigo: l.pc_unidad!,
                }
              : null,
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
      await this.validarLineas(tenantId, dto.proveedorId, dto.lineas);
      if (dto.rutProveedor) {
        await this.lecturaDteService.completarRutProveedor(
          tenantId,
          dto.proveedorId,
          dto.rutProveedor,
        );
      }
      await this.lecturaDteService.aprender(
        tenantId,
        dto.proveedorId,
        dto.lineas,
        dto.apartadas ?? [],
      );
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
                descuento_total, total_documento, fecha_vencimiento)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
              dto.totalDocumento ?? null,
              dto.fechaVencimiento ?? null,
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
      await this.validarLineas(tenantId, dto.proveedorId, dto.lineas);
      if (dto.rutProveedor) {
        await this.lecturaDteService.completarRutProveedor(
          tenantId,
          dto.proveedorId,
          dto.rutProveedor,
        );
      }
      await this.lecturaDteService.aprender(
        tenantId,
        dto.proveedorId,
        dto.lineas,
        dto.apartadas ?? [],
      );
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
                  descuento_total = $9, total_documento = $10,
                  fecha_vencimiento = $11, actualizado_el = NOW()
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
            dto.totalDocumento ?? null,
            dto.fechaVencimiento ?? null,
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
   * **Sin `pago`:** el reintento es el de siempre (`MAX_REINTENTOS_DEADLOCK`),
   * y vale porque el único llamador es el controller: sin transacción
   * envolvente, un `40P01` reintenta limpio (mismo razonamiento que
   * `TrasladosService.crear`).
   *
   * **Con `pago`** (spec § 7, "la compra al contado en un solo gesto"): la
   * composición cambia porque ahora hay un cobro adentro, y tiene que valer
   * la MISMA garantía que `registrarPago` (task-2-report): un reintento con
   * la misma clave no paga dos veces, y si el pago falla no se confirma nada.
   *
   * - `conRastroDeRechazo` sigue siendo el borde MÁS externo, por la misma
   *   razón que en `registrarPago`: su `catch` necesita que
   *   `IdempotenciaService.ejecutar` ya haya hecho rollback —reclamo de la
   *   clave incluido— antes de escribir el rastro con `db.sinTransaccion`.
   * - El reintento de deadlock (`conReintentoGenerico`, genérico y no atado a
   *   `db.transaccion`) pasa a envolver a `idempotencia.ejecutar` ENTERO, en
   *   vez de ir adentro como en la confirmación sin pago. `ejecutar` abre su
   *   propia transacción NUEVA cada vez que se lo llama; si un `40P01` la
   *   aborta, se lleva puesto el reclamo de la clave —nada quedó comprometido—
   *   así que reintentar el `ejecutar()` completo es un intento limpio, no
   *   una segunda escritura bajo la misma clave. Ponerlo ADENTRO (como
   *   `conReintento` de siempre) no serviría: ahí `db.transaccion` REUSA el
   *   manager activo de `ejecutar` (no abre uno propio), así que un
   *   `40P01` deja esa transacción abortada y el "reintento" fallaría de
   *   nuevo contra la misma conexión rota.
   * - `confirmarEnTransaccion` corre dentro de esa transacción y, al final,
   *   llama a `pagarEnTransaccion` (Tarea 2) con una única aplicación a esta
   *   compra: si el pago revienta (sin caja, sin plata), la excepción
   *   propaga y TODO —el estado `confirmada`, el stock movido, el reclamo de
   *   la clave— se revierte. "Confirmar con un pago que falla no confirma
   *   nada" sale gratis de que las dos cosas viven en la misma transacción.
   */
  async confirmar(
    tenantId: string,
    usuarioId: string,
    id: string,
    pago?: PagoAlConfirmarDto,
    clave?: string,
    /**
     * `Compras:Pagar`, resuelto por el controller (spec § 8, decisión 12).
     * Con `pago`, el controller ya lo exigió (403 si no) así que este valor
     * siempre es `true` en ese camino — pero el que PASA `pago` es el
     * controller, no un default acá: sin `pago`, confirmar es el camino
     * común (el bodeguero confirma sin pagar) y el dueño que SÍ tiene
     * `Pagar` también pasa por acá — su respuesta tiene que traer
     * `estadoPago`/`deuda`/etc. igual que un `GET /compras/:id` posterior.
     */
    tienePagar = false,
  ): Promise<CompraDetalle & { repetida?: true }> {
    if (!pago) {
      return this.conReintento((manager) =>
        this.confirmarEnTransaccion(
          manager,
          tenantId,
          usuarioId,
          id,
          null,
          tienePagar,
        ),
      );
    }
    return this.cajaService.conRastroDeRechazo(tenantId, () =>
      this.conReintentoGenerico(() =>
        this.idempotencia.ejecutar(
          {
            tenantId,
            usuarioId,
            clave: clave!,
            operacion: 'compras.confirmar',
            huella: huellaDe('compras.confirmar', { id, pago }),
          },
          () =>
            this.db.transaccion((manager) =>
              // `pago` presente ya significa `Pagar` (el controller lo exigió
              // antes de llamar acá): la respuesta trae sus propios datos de
              // pago (spec § 8), no hace falta resolverlo dos veces.
              this.confirmarEnTransaccion(
                manager,
                tenantId,
                usuarioId,
                id,
                pago,
                true,
              ),
            ),
          () => null,
        ),
      ),
    );
  }

  private async confirmarEnTransaccion(
    manager: EntityManager,
    tenantId: string,
    usuarioId: string,
    id: string,
    pago: PagoAlConfirmarDto | null,
    tienePagar: boolean,
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
      total_documento: string | null;
      fecha_vencimiento: string | null;
    }[] = await this.db.query(
      `SELECT proveedor_id, tipo_documento_compra_id, folio,
              fecha_documento::text AS fecha_documento, ubicacion_id,
              observacion, descuento_total, total_documento,
              fecha_vencimiento::text AS fecha_vencimiento
         FROM compras
        WHERE tenant_id = $1 AND compra_id = $2 AND eliminado_el IS NULL`,
      [tenantId, id],
    );
    const c = cabecera[0];
    const lineas: {
      compra_linea_id: string;
      item_id: string;
      cantidad: string;
      unidad_codigo: string | null;
      presentacion_compra_id: string | null;
      precio_unitario: string | null;
      series: SerieCompraInput[] | null;
      lote: LoteCompraInput | null;
    }[] = await this.db.query(
      `SELECT compra_linea_id, item_id, cantidad, unidad_codigo,
              presentacion_compra_id, precio_unitario, series, lote
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
    // confirmar pudo pausarse el proveedor, desactivarse la bodega, cargarse
    // el mismo folio en otra compra o retirarse una presentación.
    //
    // Sin lock sobre la presentación, a propósito: si alguien la edita
    // mientras se confirma, la compra entra con el valor que leyó y la
    // edición vale para las siguientes — el mismo resultado que si la edición
    // hubiera llegado un segundo después.
    const dto: CompraBorradorDto = {
      proveedorId: c.proveedor_id,
      tipoDocumentoCompraId: c.tipo_documento_compra_id,
      folio: c.folio,
      fechaDocumento: c.fecha_documento,
      ubicacionId: c.ubicacion_id,
      observacion: c.observacion,
      totalDocumento: c.total_documento,
      fechaVencimiento: c.fecha_vencimiento,
      lineas: lineas.map((l) => ({
        itemId: l.item_id,
        cantidad: l.cantidad,
        unidadCodigo: l.unidad_codigo ?? undefined,
        presentacionId: l.presentacion_compra_id ?? undefined,
        precioUnitario: l.precio_unitario,
        series: l.series ?? undefined,
        lote: l.lote ?? undefined,
      })),
    };
    const enc = await this.validarEncabezado(tenantId, dto);
    const { unidades } = await this.validarLineas(
      tenantId,
      c.proveedor_id,
      dto.lineas,
    );
    validarDescuento(dto.lineas, c.descuento_total);
    await this.assertFolioLibre(
      tenantId,
      c.proveedor_id,
      c.tipo_documento_compra_id,
      enc,
      id,
    );

    // 2b. La deuda (spec § 4.1 y § 4.2, decisión 10): un tipo `obligatorio`
    // no se confirma sin su total transcrito; el vencimiento se fija ahora
    // (la tipeada del borrador manda, si no, fecha_documento + el plazo del
    // proveedor).
    if (
      enc.tipoDocumentoTotalDocumento === 'obligatorio' &&
      c.total_documento == null
    ) {
      throw new BadRequestException('Falta el total del documento');
    }
    const fechaVencimiento = vencimiento(
      c.fecha_documento,
      enc.plazoPagoDias,
      c.fecha_vencimiento,
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
    // `conversorPerezoso`: una carga del catálogo para toda la compra, ninguna
    // query por línea (Promise.all sobre funciones que solo esperan el
    // conversor memoizado).
    const conversor = this.conversorPerezoso();
    const bases = await Promise.all(
      lineas.map((l, i) =>
        cantidadEnBase(
          l.cantidad,
          unidades[i].presentacion
            ? { contenidoBase: unidades[i].presentacion.contenidoBase }
            : { unidadCodigo: l.unidad_codigo! },
          unidades[i].unidadBase,
          conversor,
        ),
      ),
    );
    const costosBase = await this.costearCompra(
      tenantId,
      lineas.map((l, i) => ({
        cantidad: l.cantidad,
        precioUnitario: l.precio_unitario,
        cantidadBase: bases[i],
        unidadBase: unidades[i].unidadBase,
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
      presentacionNombre: string | null;
      contenidoBase: string | null;
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
        presentacionNombre: unidades[i].presentacion?.nombre ?? null,
        contenidoBase: unidades[i].presentacion?.contenidoBase ?? null,
      });
      acumulado.set(l.item_id, anterior.plus(bases[i]));
    }

    // 7. Lo congelado, en UN update para todas las líneas.
    const COLUMNAS = 8;
    const valores = congelados
      .map((_, k) => {
        const p = k * COLUMNAS + 2;
        return `($${p}::uuid, $${p + 1}::numeric, $${p + 2}::numeric, $${p + 3}::uuid, $${p + 4}::numeric, $${p + 5}::numeric, $${p + 6}::varchar, $${p + 7}::numeric)`;
      })
      .join(', ');
    await this.db.query(
      `UPDATE compra_lineas cl
          SET cantidad_base = v.cantidad_base,
              costo_unitario_base = v.costo_unitario_base,
              movimiento_id = v.movimiento_id,
              stock_total_anterior = v.stock_total_anterior,
              costo_producto_anterior = v.costo_producto_anterior,
              presentacion_nombre = v.presentacion_nombre,
              contenido_base = v.contenido_base,
              actualizado_el = NOW()
         FROM (VALUES ${valores}) AS v(compra_linea_id, cantidad_base,
              costo_unitario_base, movimiento_id, stock_total_anterior,
              costo_producto_anterior, presentacion_nombre, contenido_base)
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
          g.presentacionNombre,
          g.contenidoBase,
        ]),
      ],
    );

    // 8. El estado y el vencimiento (spec § 4.2).
    await this.db.query(
      `UPDATE compras
          SET estado = 'confirmada', confirmado_por = $3,
              confirmado_el = NOW(), actualizado_el = NOW(),
              fecha_vencimiento = $4
        WHERE tenant_id = $1 AND compra_id = $2`,
      [tenantId, id, usuarioId, fechaVencimiento],
    );

    // 9. El pago, si vino (spec § 7): una única aplicación a ESTA compra por
    // `min(monto, total)` — o por `monto` entero si el total todavía es
    // desconocido (decisión 8: la compra puede pagarse antes de saberse el
    // total exacto). `pagarEnTransaccion` (Tarea 2) hace TODO lo suyo en esta
    // misma transacción: sus propios locks siguen el orden de spec § 11
    // (compras → pagos del proveedor → caja), que acá cae DESPUÉS del stock
    // ya movido arriba — el orden global completo queda respetado.
    if (pago) {
      const esSumaLineas =
        enc.tipoDocumentoTotalDocumento !== 'obligatorio' &&
        enc.tipoDocumentoTotalDocumento !== 'opcional';
      const totalConocido = esSumaLineas
        ? totalCompra(
            lineas.map((l) => ({
              cantidad: l.cantidad,
              precioUnitario: l.precio_unitario,
            })),
            c.descuento_total,
            await this.cfgTenant(tenantId),
          )
        : c.total_documento;
      const montoAplicado =
        totalConocido != null
          ? Decimal.min(pago.monto, totalConocido).toString()
          : pago.monto;
      await this.pagarEnTransaccion(manager, tenantId, usuarioId, {
        proveedorId: c.proveedor_id,
        monto: pago.monto,
        metodoPagoId: pago.metodoPagoId,
        referencia: pago.referencia,
        aplicaciones: [{ compraId: id, monto: montoAplicado }],
      });
    }

    return this.findOne(tenantId, id, tienePagar);
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
    /** `Compras:Pagar`, resuelto por el controller (spec § 8, decisión 12). */
    tienePagar = false,
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

      // El recorte (spec § 6): en un tipo `suma_lineas` corregir una línea
      // puede bajar el total o completarlo (el "queso sin precio", decisión
      // 8) — en un `obligatorio`/`opcional` NO, porque ahí la deuda es el
      // total transcrito y una línea no lo toca (decisión 10, duda del
      // revisor). Si el total sigue desconocido (otra línea sin precio),
      // `totalCompra` devuelve `null` y no hay nada que recortar todavía.
      const esSumaLineas =
        compra.tipo_documento_total_documento !== 'obligatorio' &&
        compra.tipo_documento_total_documento !== 'opcional';
      if (esSumaLineas) {
        const cfg = await this.cfgTenant(tenantId);
        const totalNuevo = totalCompra(
          lineas.map((l) => ({
            cantidad: l.cantidad,
            precioUnitario: l.precio_unitario,
          })),
          compra.descuento_total,
          cfg,
        );
        if (totalNuevo != null) {
          await this.recortarAplicaciones(manager, tenantId, id, totalNuevo);
        }
      }
      return this.findOne(tenantId, id, tienePagar);
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
    // El congelado, nunca el vivo: con la presentación ya editada, corregir
    // tiene que seguir usando el contenido que se congeló al confirmar.
    const nuevaBase = await cantidadEnBase(
      dto.cantidad!,
      linea.contenido_base != null
        ? { contenidoBase: linea.contenido_base }
        : { unidadCodigo: linea.unidad_codigo! },
      linea.unidad_base,
      this.conversorPerezoso(),
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
    /** `Compras:Pagar`, resuelto por el controller (spec § 8, decisión 12). */
    tienePagar = false,
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

      // El recorte (spec § 6): el descuento solo mueve la deuda en un tipo
      // `suma_lineas` — en un `obligatorio`/`opcional` la deuda es el total
      // transcrito, que el descuento no toca (decisión 10). `validarDescuento`
      // ya exigió que todas las líneas tengan precio, así que el total sale
      // conocido siempre que sea `suma_lineas`.
      const esSumaLineas =
        compra.tipo_documento_total_documento !== 'obligatorio' &&
        compra.tipo_documento_total_documento !== 'opcional';
      if (esSumaLineas) {
        const cfg = await this.cfgTenant(tenantId);
        const totalNuevo = totalCompra(
          lineas.map((l) => ({
            cantidad: l.cantidad,
            precioUnitario: l.precio_unitario,
          })),
          nuevo,
          cfg,
        );
        if (totalNuevo != null) {
          await this.recortarAplicaciones(manager, tenantId, id, totalNuevo);
        }
      }
      return this.findOne(tenantId, id, tienePagar);
    });
  }

  /**
   * Corrige lo transcrito de una confirmada: el total del documento, su
   * vencimiento, o los dos (spec compras-deuda-proveedor § 6). Corregir lo
   * transcrito es lo mismo que corregir un precio: mismo permiso
   * (`Actualizar`) que `corregirLinea`/`corregirDescuento`. No toca el costo
   * ni las líneas — el recorte de aplicaciones de pago llega en la tarea 3.
   */
  async actualizarDocumento(
    tenantId: string,
    id: string,
    dto: ActualizarDocumentoDto,
    /** `Compras:Pagar`, resuelto por el controller (spec § 8, decisión 12). */
    tienePagar = false,
  ): Promise<CompraDetalle> {
    if (
      dto.totalDocumento === undefined &&
      dto.fechaVencimiento === undefined
    ) {
      throw new BadRequestException(
        'No hay nada que corregir: falta el total o el vencimiento',
      );
    }
    return this.db.transaccion(async (manager) => {
      const compra = await this.bloquearConfirmada(tenantId, id);
      let totalDocumento = compra.total_documento;
      if (dto.totalDocumento !== undefined) {
        if (compra.tipo_documento_total_documento === 'suma_lineas') {
          throw new BadRequestException(
            `"${compra.tipo_documento_nombre}" no lleva total transcrito: su total es la suma de las líneas`,
          );
        }
        if (
          dto.totalDocumento === null &&
          compra.tipo_documento_total_documento !== 'opcional'
        ) {
          throw new BadRequestException(
            `"${compra.tipo_documento_nombre}" necesita el total del documento`,
          );
        }
        totalDocumento = dto.totalDocumento;
      }
      const fechaVencimiento =
        dto.fechaVencimiento !== undefined
          ? dto.fechaVencimiento
          : compra.fecha_vencimiento;

      await this.db.query(
        `UPDATE compras
            SET total_documento = $3, fecha_vencimiento = $4,
                actualizado_el = NOW()
          WHERE tenant_id = $1 AND compra_id = $2`,
        [tenantId, id, totalDocumento, fechaVencimiento],
      );

      // El recorte (spec § 6): corregir lo transcrito es lo mismo que
      // corregir un precio. Si baja, o si pasa de `null` a conocido (un
      // `opcional` recién completado), lo aplicado puede superarlo. Si queda
      // `null` (se vacía un `opcional`), no hay nada que recortar: la deuda
      // vuelve a ser desconocida, no baja.
      if (totalDocumento != null) {
        await this.recortarAplicaciones(manager, tenantId, id, totalDocumento);
      }
      return this.findOne(tenantId, id, tienePagar);
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
    /** `Compras:Pagar`, resuelto por el controller (spec § 8, decisión 12). */
    tienePagar = false,
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

      // El recorte (spec § 6, decisión 6b): anular deja lo pagado a favor —
      // `recortar(..., '0')` borra TODA aplicación viva, que es exactamente
      // "esta compra ya no debe nada". Va DESPUÉS del stock (spec § 11: las
      // compras primero, después lo que mueve stock, recién ahí los pagos)
      // y la compra no toca caja, así que acá termina el orden de locks.
      await this.recortarAplicaciones(manager, tenantId, id, '0');
      return this.findOne(tenantId, id, tienePagar);
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

  // ───────────────────────────────────────────────────────────────────────
  // Pagar (spec compras-deuda-proveedor § 5)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Los medios habilitados del tenant, con `esEfectivo` (spec § 5.1).
   * Consulta propia de Compras (pattern backend § 19: "la pantalla de un
   * módulo lee de listas propias") — mismo `JOIN` país→método que
   * `MetodosPagoService.findMetodosPago`, leído desde acá para no sumarle a
   * ESE servicio una columna que solo esta pantalla necesita.
   */
  async mediosPago(tenantId: string): Promise<MedioPagoOpcion[]> {
    const rows: {
      metodo_pago_id: string;
      nombre: string;
      es_efectivo: boolean;
    }[] = await this.db.query(
      `SELECT mp.metodo_pago_id, mp.nombre, mp.es_efectivo
         FROM tenants t
         JOIN provincia prov ON prov.provincia_id = t.provincia_id
              AND prov.eliminado_el IS NULL
         JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
         JOIN metodo_pago_pais mpp ON mpp.pais_id = p.pais_id
              AND mpp.eliminado_el IS NULL
         JOIN metodos_pago mp ON mp.metodo_pago_id = mpp.metodo_pago_id
              AND mp.eliminado_el IS NULL
         JOIN tenant_metodo_pago tmp ON tmp.tenant_id = t.tenant_id
              AND tmp.metodo_pago_id = mp.metodo_pago_id
              AND tmp.eliminado_el IS NULL AND tmp.habilitada = true
        WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL
        ORDER BY mp.nombre ASC`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.metodo_pago_id,
      nombre: r.nombre,
      esEfectivo: r.es_efectivo,
    }));
  }

  /**
   * Los pagos vigentes y anulados de un proveedor, con sus aplicaciones
   * (spec § 8). Dos consultas fijas (pagos, después sus aplicaciones en
   * lote por `ANY`), nunca una por pago.
   */
  /**
   * Los pagos vigentes que aplicaron algo a UNA compra (spec § 8, detalle de
   * `GET /compras/:id` con `Pagar`), con el mismo shape que `listarPagos`.
   * Dos consultas fijas (los pagos que la tocan, y TODAS sus aplicaciones —
   * no solo las de esta compra, porque `PagoProveedorInfo.aplicaciones` es
   * el reparto completo del pago): nunca una por pago.
   */
  private async pagosQueCubren(
    tenantId: string,
    compraId: string,
  ): Promise<PagoProveedorInfo[]> {
    const pagos: {
      pago_proveedor_id: string;
      proveedor_id: string;
      fecha: Date;
      monto: string;
      metodo_pago_id: string;
      metodo_pago_nombre: string | null;
      referencia: string | null;
      caja_id: string | null;
      estado: EstadoPagoProveedor;
      anulado_por: string | null;
      anulado_el: Date | null;
      motivo_anulacion: string | null;
    }[] = await this.db.query(
      `SELECT DISTINCT pp.pago_proveedor_id, pp.proveedor_id, pp.fecha,
              pp.monto, pp.metodo_pago_id, mp.nombre AS metodo_pago_nombre,
              pp.referencia, pp.caja_id, pp.estado, pp.anulado_por,
              pp.anulado_el, pp.motivo_anulacion
         FROM pago_proveedor_aplicaciones a
         JOIN pagos_proveedor pp ON pp.pago_proveedor_id = a.pago_proveedor_id
              AND pp.tenant_id = a.tenant_id
         -- Sin "mp.eliminado_el IS NULL": mismo criterio que listarPagos,
         -- el método con el que se pagó es un dato histórico.
         LEFT JOIN metodos_pago mp ON mp.metodo_pago_id = pp.metodo_pago_id
        WHERE a.tenant_id = $1 AND a.compra_id = $2 AND a.eliminado_el IS NULL
          AND pp.eliminado_el IS NULL
        ORDER BY pp.fecha DESC, pp.pago_proveedor_id DESC`,
      [tenantId, compraId],
    );
    if (!pagos.length) return [];

    const aplicaciones: {
      pago_proveedor_id: string;
      compra_id: string;
      monto: string;
    }[] = await this.db.query(
      `SELECT pago_proveedor_id, compra_id, monto
         FROM pago_proveedor_aplicaciones
        WHERE tenant_id = $1
          AND pago_proveedor_id = ANY($2::uuid[])
          AND eliminado_el IS NULL
        ORDER BY creado_el`,
      [tenantId, pagos.map((p) => p.pago_proveedor_id)],
    );
    const porPago = new Map<string, AplicacionPagoInfo[]>();
    for (const a of aplicaciones) {
      const lista = porPago.get(a.pago_proveedor_id) ?? [];
      lista.push({ compraId: a.compra_id, monto: a.monto });
      porPago.set(a.pago_proveedor_id, lista);
    }

    return pagos.map((p) => {
      const propias = porPago.get(p.pago_proveedor_id) ?? [];
      const aplicado = propias.reduce(
        (acc, a) => acc.plus(a.monto),
        new Decimal(0),
      );
      return {
        id: p.pago_proveedor_id,
        proveedorId: p.proveedor_id,
        fecha: p.fecha?.toISOString?.() ?? null,
        monto: p.monto,
        metodoPagoId: p.metodo_pago_id,
        metodoPagoNombre: p.metodo_pago_nombre,
        referencia: p.referencia,
        cajaId: p.caja_id,
        estado: p.estado,
        anuladoPor: p.anulado_por,
        anuladoEl: p.anulado_el,
        motivoAnulacion: p.motivo_anulacion,
        aplicaciones: propias,
        sobranteAFavor:
          p.estado === 'vigente'
            ? new Decimal(p.monto).minus(aplicado).toFixed(4)
            : '0.0000',
      };
    });
  }

  async listarPagos(
    tenantId: string,
    proveedorId: string,
  ): Promise<PagoProveedorInfo[]> {
    const pagos: {
      pago_proveedor_id: string;
      fecha: Date;
      monto: string;
      metodo_pago_id: string;
      metodo_pago_nombre: string | null;
      referencia: string | null;
      caja_id: string | null;
      estado: EstadoPagoProveedor;
      anulado_por: string | null;
      anulado_el: Date | null;
      motivo_anulacion: string | null;
    }[] = await this.db.query(
      `SELECT pp.pago_proveedor_id, pp.fecha, pp.monto, pp.metodo_pago_id,
              mp.nombre AS metodo_pago_nombre, pp.referencia, pp.caja_id,
              pp.estado, pp.anulado_por, pp.anulado_el, pp.motivo_anulacion
         FROM pagos_proveedor pp
         -- Sin "mp.eliminado_el IS NULL" a propósito: el método con el que
         -- se pagó es un dato HISTÓRICO del pago, y tiene que seguir
         -- nombrándolo aunque el método se retire después — mismo criterio
         -- que calcularEsperadoEfectivo/calcularArqueo en caja.service.ts.
         LEFT JOIN metodos_pago mp ON mp.metodo_pago_id = pp.metodo_pago_id
        WHERE pp.tenant_id = $1 AND pp.proveedor_id = $2
          AND pp.eliminado_el IS NULL
        ORDER BY pp.fecha DESC, pp.pago_proveedor_id DESC`,
      [tenantId, proveedorId],
    );
    if (!pagos.length) return [];

    const aplicaciones: {
      pago_proveedor_id: string;
      compra_id: string;
      monto: string;
    }[] = await this.db.query(
      `SELECT pago_proveedor_id, compra_id, monto
         FROM pago_proveedor_aplicaciones
        WHERE tenant_id = $1
          AND pago_proveedor_id = ANY($2::uuid[])
          AND eliminado_el IS NULL
        ORDER BY creado_el`,
      [tenantId, pagos.map((p) => p.pago_proveedor_id)],
    );
    const porPago = new Map<string, AplicacionPagoInfo[]>();
    for (const a of aplicaciones) {
      const lista = porPago.get(a.pago_proveedor_id) ?? [];
      lista.push({ compraId: a.compra_id, monto: a.monto });
      porPago.set(a.pago_proveedor_id, lista);
    }

    return pagos.map((p) => {
      const propias = porPago.get(p.pago_proveedor_id) ?? [];
      const aplicado = propias.reduce(
        (acc, a) => acc.plus(a.monto),
        new Decimal(0),
      );
      return {
        id: p.pago_proveedor_id,
        proveedorId,
        fecha: p.fecha?.toISOString?.() ?? null,
        monto: p.monto,
        metodoPagoId: p.metodo_pago_id,
        metodoPagoNombre: p.metodo_pago_nombre,
        referencia: p.referencia,
        cajaId: p.caja_id,
        estado: p.estado,
        anuladoPor: p.anulado_por,
        anuladoEl: p.anulado_el,
        motivoAnulacion: p.motivo_anulacion,
        aplicaciones: propias,
        sobranteAFavor:
          p.estado === 'vigente'
            ? new Decimal(p.monto).minus(aplicado).toFixed(4)
            : '0.0000',
      };
    });
  }

  /**
   * Fila cruda de una compra confirmada para las lecturas de deuda (spec §
   * 8): compartida por `porPagar`, `porPagarProveedor` y `findOne`/`findAll`
   * no la usan porque ya tienen su propio `CabeceraRow`. Una consulta, sin
   * `LIMIT`: el universo es "compras confirmadas", acotado como mucho por
   * `proveedorId`.
   */
  private async comprasConfirmadasParaDeuda(
    tenantId: string,
    proveedorId?: string,
  ): Promise<
    {
      compra_id: string;
      proveedor_id: string;
      proveedor_nombre: string | null;
      fecha_documento: string;
      folio: string | null;
      tipo_documento_nombre: string | null;
      descuento_total: string | null;
      total_documento: string | null;
      tipo_total_documento: string | null;
      fecha_vencimiento: string | null;
      algun_sin_precio: boolean;
      bruto: string | null;
      aplicado: string;
    }[]
  > {
    return this.db.query(
      `SELECT c.compra_id, c.proveedor_id, pr.nombre AS proveedor_nombre,
              c.fecha_documento::text AS fecha_documento, c.folio,
              td.nombre AS tipo_documento_nombre,
              c.descuento_total, c.total_documento,
              td.total_documento AS tipo_total_documento,
              c.fecha_vencimiento::text AS fecha_vencimiento,
              COALESCE(ag.algun_sin_precio, false) AS algun_sin_precio,
              ag.bruto,
              COALESCE(pagoag.aplicado, 0)::text AS aplicado
         FROM compras c
         -- Sin filtro de borrado en terceros/tipos_documento: mismo criterio
         -- que SELECT_CABECERA — un proveedor o tipo retirado después sigue
         -- nombrando la deuda que dejó.
         LEFT JOIN terceros pr ON pr.tercero_id = c.proveedor_id
         LEFT JOIN tipos_documento_compra td
                ON td.tipo_documento_compra_id = c.tipo_documento_compra_id
         LEFT JOIN (
           SELECT cl.compra_id,
                  bool_or(cl.precio_unitario IS NULL) AS algun_sin_precio,
                  SUM(cl.cantidad * cl.precio_unitario) AS bruto
             FROM compra_lineas cl
            WHERE cl.tenant_id = $1 AND cl.eliminado_el IS NULL
            GROUP BY cl.compra_id
         ) ag ON ag.compra_id = c.compra_id
         LEFT JOIN (
           SELECT compra_id, SUM(monto) AS aplicado
             FROM pago_proveedor_aplicaciones
            WHERE tenant_id = $1 AND eliminado_el IS NULL
            GROUP BY compra_id
         ) pagoag ON pagoag.compra_id = c.compra_id
        WHERE c.tenant_id = $1 AND c.estado = 'confirmada'
          AND c.eliminado_el IS NULL
          AND ($2::uuid IS NULL OR c.proveedor_id = $2::uuid)`,
      [tenantId, proveedorId ?? null],
    );
  }

  /**
   * `GET /compras/por-pagar` (spec § 8, `Pagar`): una fila por proveedor con
   * la deuda conocida, lo vencido, lo que vence en 7 días, cuántas compras
   * tienen el total desconocido y el saldo a favor. Dos consultas fijas (las
   * compras confirmadas y los pagos vigentes), agregadas en memoria — el
   * total `suma_lineas` pasa por `cuantizar` (Decimal.js), así que la cuenta
   * no se puede empujar entera a SQL. Sin deuda y sin saldo a favor, el
   * proveedor no aparece.
   */
  async porPagar(tenantId: string): Promise<PorPagarProveedorItem[]> {
    const cfg = await this.cfgTenant(tenantId);
    const hoy = await this.hoyNegocio(tenantId);
    const en7Dias = sumarDias(hoy, 7);
    const filas = await this.comprasConfirmadasParaDeuda(tenantId);

    interface Acc {
      proveedorNombre: string | null;
      deuda: Decimal;
      vencido: Decimal;
      venceProximos7Dias: Decimal;
      comprasTotalDesconocido: number;
    }
    const porProveedor = new Map<string, Acc>();
    for (const f of filas) {
      const total = this.totalDeFila(f, cfg);
      const acc = porProveedor.get(f.proveedor_id) ?? {
        proveedorNombre: f.proveedor_nombre,
        deuda: new Decimal(0),
        vencido: new Decimal(0),
        venceProximos7Dias: new Decimal(0),
        comprasTotalDesconocido: 0,
      };
      if (total == null) {
        acc.comprasTotalDesconocido += 1;
      } else {
        const deuda = Decimal.max(0, new Decimal(total).minus(f.aplicado));
        if (deuda.gt(0)) {
          acc.deuda = acc.deuda.plus(deuda);
          const vencimientoF = f.fecha_vencimiento;
          if (vencimientoF != null && vencimientoF < hoy) {
            acc.vencido = acc.vencido.plus(deuda);
          } else if (vencimientoF != null && vencimientoF <= en7Dias) {
            acc.venceProximos7Dias = acc.venceProximos7Dias.plus(deuda);
          }
        }
      }
      porProveedor.set(f.proveedor_id, acc);
    }

    const saldos = await this.saldoAFavorPorProveedor(tenantId);

    const resultado: PorPagarProveedorItem[] = [];
    const proveedorIds = new Set([...porProveedor.keys(), ...saldos.keys()]);
    for (const proveedorId of proveedorIds) {
      const acc = porProveedor.get(proveedorId);
      const saldoAFavor = saldos.get(proveedorId) ?? new Decimal(0);
      const deuda = acc?.deuda ?? new Decimal(0);
      const comprasTotalDesconocido = acc?.comprasTotalDesconocido ?? 0;
      if (
        deuda.isZero() &&
        comprasTotalDesconocido === 0 &&
        saldoAFavor.isZero()
      ) {
        continue;
      }
      resultado.push({
        proveedorId,
        proveedorNombre: acc?.proveedorNombre ?? null,
        deuda: deuda.toString(),
        vencido: (acc?.vencido ?? new Decimal(0)).toString(),
        venceProximos7Dias: (
          acc?.venceProximos7Dias ?? new Decimal(0)
        ).toString(),
        comprasTotalDesconocido,
        saldoAFavor: saldoAFavor.toString(),
      });
    }

    // Ordenada por vencido y después por lo que vence pronto (spec § 8).
    resultado.sort((a, b) => {
      const porVencido = new Decimal(b.vencido).minus(a.vencido).toNumber();
      if (porVencido !== 0) return porVencido;
      return new Decimal(b.venceProximos7Dias)
        .minus(a.venceProximos7Dias)
        .toNumber();
    });
    return resultado;
  }

  /**
   * `GET /compras/por-pagar/:proveedorId` (spec § 8, `Pagar`): sus compras
   * confirmadas con deuda o total desconocido, con estado y vencimiento; sus
   * pagos vigentes con saldo a favor.
   */
  async porPagarProveedor(
    tenantId: string,
    proveedorId: string,
  ): Promise<PorPagarProveedorDetalle> {
    const cfg = await this.cfgTenant(tenantId);
    const hoy = await this.hoyNegocio(tenantId);
    const filas = await this.comprasConfirmadasParaDeuda(tenantId, proveedorId);

    const compras: PorPagarCompraItem[] = filas
      .map((f) => {
        const total = this.totalDeFila(f, cfg);
        const esSumaLineas =
          f.tipo_total_documento !== 'obligatorio' &&
          f.tipo_total_documento !== 'opcional';
        const derivado = estadoPagoCompra({
          total,
          aplicado: f.aplicado,
          fechaVencimiento: f.fecha_vencimiento,
          hoy,
          esSumaLineas,
        });
        return {
          id: f.compra_id,
          fechaDocumento: f.fecha_documento,
          folio: f.folio,
          tipoDocumentoNombre: f.tipo_documento_nombre,
          total,
          totalDocumento: f.total_documento,
          fechaVencimiento: f.fecha_vencimiento,
          estadoPago: derivado.estadoPago,
          deuda: derivado.deuda,
          vencida: derivado.vencida,
        };
      })
      // Solo con deuda o total desconocido (spec § 8): una `pagada` no entra.
      .filter((c) => c.deuda == null || new Decimal(c.deuda).gt(0));

    const pagos = (await this.listarPagos(tenantId, proveedorId)).filter(
      (p) => p.estado === 'vigente' && new Decimal(p.sobranteAFavor).gt(0),
    );

    return { compras, pagos };
  }

  /** El total de una fila de `comprasConfirmadasParaDeuda`, con la misma regla que `mapCabecera` (decisión 10). */
  private totalDeFila(
    f: {
      tipo_total_documento: string | null;
      total_documento: string | null;
      algun_sin_precio: boolean;
      bruto: string | null;
      descuento_total: string | null;
    },
    cfg: ConfigCalculo,
  ): string | null {
    const esSumaLineas =
      f.tipo_total_documento !== 'obligatorio' &&
      f.tipo_total_documento !== 'opcional';
    if (!esSumaLineas) return f.total_documento;
    if (f.algun_sin_precio || f.bruto == null) return null;
    return cuantizar(
      new Decimal(f.bruto).minus(f.descuento_total ?? 0),
      cfg,
    ).toString();
  }

  /** Saldo a favor vigente por proveedor: Σ (monto − aplicado) de sus pagos vigentes. */
  private async saldoAFavorPorProveedor(
    tenantId: string,
  ): Promise<Map<string, Decimal>> {
    const rows: { proveedor_id: string; saldo: string }[] = await this.db.query(
      `SELECT pp.proveedor_id,
              SUM(pp.monto - COALESCE(ap.aplicado, 0))::text AS saldo
         FROM pagos_proveedor pp
         LEFT JOIN (
           SELECT pago_proveedor_id, SUM(monto) AS aplicado
             FROM pago_proveedor_aplicaciones
            WHERE tenant_id = $1 AND eliminado_el IS NULL
            GROUP BY pago_proveedor_id
         ) ap ON ap.pago_proveedor_id = pp.pago_proveedor_id
        WHERE pp.tenant_id = $1 AND pp.estado = 'vigente'
          AND pp.eliminado_el IS NULL
        GROUP BY pp.proveedor_id`,
      [tenantId],
    );
    return new Map(rows.map((r) => [r.proveedor_id, new Decimal(r.saldo)]));
  }

  /**
   * `POST /compras/pagos` (spec § 5.1). Orden de composición del spike
   * (ver `task-2-report.md`): `conRastroDeRechazo` es el borde MÁS externo
   * —fuera de cualquier transacción—, porque su `catch` necesita que
   * `IdempotenciaService.ejecutar` ya haya hecho rollback (incluido el
   * reclamo de la clave) antes de escribir el rastro con `db.sinTransaccion`.
   * `ejecutar` abre su propia `db.transaccion` (reclama la clave primero) y
   * llama a `pagarEnTransaccion` con el manager activo: si el 422 de "sin
   * plata en caja" sale de ahí adentro, TODA la transacción de `ejecutar`
   * revierte —el reclamo incluido—, así que el reintento con la misma clave
   * vuelve a intentar de verdad (`idempotencia.service.ts`, doc de
   * `ejecutar`), y recién ahí `conRastroDeRechazo` escribe la fila del
   * rastro, ya sin ninguna transacción viva.
   */
  async registrarPago(
    tenantId: string,
    usuarioId: string,
    dto: CrearPagoProveedorDto,
    clave: string,
  ): Promise<PagoProveedorInfo & { repetida?: true }> {
    return this.cajaService.conRastroDeRechazo(tenantId, () =>
      this.idempotencia.ejecutar(
        {
          tenantId,
          usuarioId,
          clave,
          operacion: 'compras.pago',
          huella: huellaDe('compras.pago', dto),
        },
        () =>
          this.db.transaccion((manager) =>
            this.pagarEnTransaccion(manager, tenantId, usuarioId, dto),
          ),
        () => null,
      ),
    );
  }

  /**
   * El pago en sí, corriendo en la transacción de `manager` (spec § 5.1). Se
   * expone aparte de `registrarPago` para que la Tarea 3 lo reuse desde
   * `confirmar` (spec § 7): confirmar y pagar en la MISMA transacción, sin
   * un segundo `IdempotenciaService.ejecutar` anidado. El llamador de
   * `confirmar` es quien decide idempotencia y rastro para SU propia
   * operación (`compras.confirmar` o la que corresponda).
   *
   * Orden de locks (spec § 11): las compras del reparto (`FOR UPDATE OF c`,
   * `ORDER BY compra_id`) → los pagos vigentes del proveedor que pueden
   * fondear (`FOR UPDATE`, `ORDER BY pago_proveedor_id`) → la caja
   * (`bloquearCajaAbierta`, al final, solo si el medio es efectivo).
   */
  async pagarEnTransaccion(
    manager: EntityManager,
    tenantId: string,
    usuarioId: string,
    dto: CrearPagoProveedorDto,
  ): Promise<PagoProveedorInfo> {
    const proveedorRows: { nombre: string; activo: boolean }[] =
      await manager.query(
        `SELECT nombre, activo FROM terceros
          WHERE tenant_id = $1 AND tercero_id = $2 AND tipo = 'proveedor'
            AND eliminado_el IS NULL`,
        [tenantId, dto.proveedorId],
      );
    if (!proveedorRows.length) {
      throw new NotFoundException('Proveedor no encontrado');
    }
    if (!proveedorRows[0].activo) {
      throw new BadRequestException('El proveedor no está activo');
    }
    const proveedorNombre = proveedorRows[0].nombre;

    const compraIds = dto.aplicaciones.map((a) => a.compraId);
    if (new Set(compraIds).size !== compraIds.length) {
      throw new BadRequestException(
        'Una misma compra no puede repetirse en el reparto',
      );
    }

    // 1. Las compras involucradas (spec § 11, PRIMERO).
    const deudaPorCompra = compraIds.length
      ? await this.deudaDeComprasLockeadas(
          manager,
          tenantId,
          dto.proveedorId,
          compraIds,
        )
      : new Map<string, string | null>();

    for (const a of dto.aplicaciones) {
      const deuda = deudaPorCompra.get(a.compraId);
      if (deuda != null && new Decimal(a.monto).gt(deuda)) {
        throw new BadRequestException(
          `La aplicación a la compra ${a.compraId} (${a.monto}) supera su deuda conocida (${deuda})`,
        );
      }
    }

    // 2. Los pagos del proveedor que pueden fondear (spec § 11, SEGUNDO).
    const saldoAFavor = await this.saldoAFavorLockeado(
      manager,
      tenantId,
      dto.proveedorId,
    );

    const montoNuevo = new Decimal(dto.monto);
    const totalSolicitado = dto.aplicaciones.reduce(
      (acc, a) => acc.plus(a.monto),
      new Decimal(0),
    );
    const totalDisponible = saldoAFavor
      .reduce((acc, f) => acc.plus(f.disponible), new Decimal(0))
      .plus(montoNuevo);
    if (totalSolicitado.gt(totalDisponible)) {
      throw new BadRequestException(
        `El reparto (${totalSolicitado.toString()}) supera lo disponible entre saldo a favor y el pago (${totalDisponible.toString()})`,
      );
    }

    // 3. El medio y, si es efectivo, la caja (spec § 11, la caja va AL FINAL).
    let cajaId: string | null = null;
    if (montoNuevo.gt(0)) {
      if (!dto.metodoPagoId) {
        throw new BadRequestException(
          'metodoPagoId es obligatorio cuando el monto es mayor a cero',
        );
      }
      const metodoRows: { es_efectivo: boolean }[] = await manager.query(
        `SELECT mp.es_efectivo
           FROM tenants t
           JOIN provincia prov ON prov.provincia_id = t.provincia_id
                AND prov.eliminado_el IS NULL
           JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
           JOIN metodo_pago_pais mpp ON mpp.pais_id = p.pais_id
                AND mpp.eliminado_el IS NULL
           JOIN metodos_pago mp ON mp.metodo_pago_id = mpp.metodo_pago_id
                AND mp.eliminado_el IS NULL
           JOIN tenant_metodo_pago tmp ON tmp.tenant_id = t.tenant_id
                AND tmp.metodo_pago_id = mp.metodo_pago_id
                AND tmp.eliminado_el IS NULL AND tmp.habilitada = true
          WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL
            AND mp.metodo_pago_id = $2`,
        [tenantId, dto.metodoPagoId],
      );
      if (!metodoRows.length) {
        throw new BadRequestException('Método de pago no habilitado');
      }
      if (metodoRows[0].es_efectivo) {
        // La caja SIEMPRE la resuelve el servidor (invariante 1 y spec § 2,
        // decisión 3): nunca viene del body.
        const caja = await this.cajaService.findActiva(tenantId, usuarioId);
        if (!caja) {
          throw new BadRequestException(
            'Para pagar en efectivo necesitás tu caja abierta',
          );
        }
        await this.cajaService.bloquearCajaAbierta(manager, caja.id, tenantId);
        const esperado = await this.cajaService.calcularEsperadoEfectivo(
          caja.id,
          manager,
        );
        if (new Decimal(esperado).minus(montoNuevo).lt(0)) {
          // El chequeo NO se toca (mismo cálculo que la salida manual, spec §
          // 2 y § 5.3): existe para impedir retirar plata que no está. El
          // rechazo deja rastro vía `conRastroDeRechazo`, en el borde.
          throw new IntentoRechazadoError('Saldo insuficiente en caja', {
            cajaId: caja.id,
            usuarioId,
            tipo: 'pago_proveedor',
            motivo: 'saldo_insuficiente',
            montoSolicitado: montoNuevo.toFixed(4),
          });
        }
        cajaId = caja.id;
      }
    }

    const pagoProveedorId = randomUUID();
    if (montoNuevo.gt(0)) {
      await manager.query(
        `INSERT INTO pagos_proveedor
           (pago_proveedor_id, tenant_id, proveedor_id, fecha, monto,
            metodo_pago_id, referencia, caja_id, creado_por, estado,
            creado_el, actualizado_el)
         VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, 'vigente', NOW(), NOW())`,
        [
          pagoProveedorId,
          tenantId,
          dto.proveedorId,
          montoNuevo.toFixed(4),
          dto.metodoPagoId,
          dto.referencia ?? null,
          cajaId,
          usuarioId,
        ],
      );
    }

    // El fondeo en sí (deuda.ts): saldo a favor primero (más viejo primero,
    // ya ordenado), después el pago nuevo — spec § 5.1.
    const { partes, sobranteNuevo } = fondear(
      dto.aplicaciones.map((a) => ({ compraId: a.compraId, monto: a.monto })),
      saldoAFavor,
      montoNuevo.toFixed(4),
      pagoProveedorId,
    );

    if (partes.length) {
      await manager.query(
        `INSERT INTO pago_proveedor_aplicaciones
           (pago_proveedor_aplicacion_id, tenant_id, pago_proveedor_id,
            compra_id, monto, creado_el, actualizado_el)
         SELECT gen_random_uuid(), $1, x.pago_id, x.compra_id, x.monto, NOW(), NOW()
           FROM unnest($2::uuid[], $3::uuid[], $4::numeric[])
                AS x(pago_id, compra_id, monto)`,
        [
          tenantId,
          partes.map((p) => p.pagoId),
          partes.map((p) => p.compraId),
          partes.map((p) => p.monto),
        ],
      );
    }

    if (cajaId && montoNuevo.gt(0)) {
      await this.cajaService.registrarMovimientoEnTransaccion(manager, {
        cajaId,
        tipo: 'salida',
        concepto: `Pago a proveedor · ${proveedorNombre}`,
        monto: montoNuevo.toFixed(4),
        metodoPagoId: dto.metodoPagoId,
        pagoProveedorId,
      });
    }

    const aplicadoPorCompra = new Map<string, Decimal>();
    for (const p of partes) {
      aplicadoPorCompra.set(
        p.compraId,
        (aplicadoPorCompra.get(p.compraId) ?? new Decimal(0)).plus(p.monto),
      );
    }

    return {
      id: montoNuevo.gt(0) ? pagoProveedorId : null,
      proveedorId: dto.proveedorId,
      fecha: montoNuevo.gt(0) ? new Date().toISOString() : null,
      monto: montoNuevo.toFixed(4),
      metodoPagoId: montoNuevo.gt(0) ? (dto.metodoPagoId ?? null) : null,
      metodoPagoNombre: null,
      referencia: dto.referencia ?? null,
      cajaId,
      estado: montoNuevo.gt(0) ? 'vigente' : null,
      anuladoPor: null,
      anuladoEl: null,
      motivoAnulacion: null,
      aplicaciones: [...aplicadoPorCompra.entries()].map(
        ([compraId, monto]) => ({ compraId, monto: monto.toFixed(4) }),
      ),
      sobranteAFavor: new Decimal(sobranteNuevo).toFixed(4),
    };
  }

  /**
   * Lock de las compras del reparto (spec § 11: primero) y la deuda conocida
   * de cada una — `total − aplicado`, `null` si el total es desconocido
   * (spec § 4.1). 404 si alguna no existe (u otro tenant); 400 si no es del
   * proveedor o no está confirmada.
   */
  private async deudaDeComprasLockeadas(
    manager: EntityManager,
    tenantId: string,
    proveedorId: string,
    compraIds: string[],
  ): Promise<Map<string, string | null>> {
    const compras: {
      compra_id: string;
      estado: EstadoCompra;
      proveedor_id: string;
      descuento_total: string | null;
      total_documento: string | null;
      tipo_total_documento: string | null;
    }[] = await manager.query(
      `SELECT c.compra_id, c.estado, c.proveedor_id, c.descuento_total,
              c.total_documento, td.total_documento AS tipo_total_documento
         FROM compras c
         LEFT JOIN tipos_documento_compra td
                ON td.tipo_documento_compra_id = c.tipo_documento_compra_id
        WHERE c.tenant_id = $1 AND c.compra_id = ANY($2::uuid[])
          AND c.eliminado_el IS NULL
        ORDER BY c.compra_id
        FOR UPDATE OF c`,
      [tenantId, compraIds],
    );
    if (compras.length !== compraIds.length) {
      throw new NotFoundException('Alguna compra no existe');
    }
    for (const c of compras) {
      if (c.proveedor_id !== proveedorId) {
        throw new BadRequestException(
          `La compra ${c.compra_id} no es de este proveedor`,
        );
      }
      if (c.estado !== 'confirmada') {
        throw new BadRequestException(
          `La compra ${c.compra_id} no está confirmada`,
        );
      }
    }

    const cfg = await this.cfgTenant(tenantId);
    const bruteRows: {
      compra_id: string;
      algun_sin_precio: boolean;
      bruto: string | null;
    }[] = await manager.query(
      `SELECT compra_id, bool_or(precio_unitario IS NULL) AS algun_sin_precio,
              SUM(cantidad * precio_unitario) AS bruto
         FROM compra_lineas
        WHERE tenant_id = $1 AND compra_id = ANY($2::uuid[])
          AND eliminado_el IS NULL
        GROUP BY compra_id`,
      [tenantId, compraIds],
    );
    const bruteMap = new Map(bruteRows.map((r) => [r.compra_id, r]));

    const aplicadoRows: { compra_id: string; aplicado: string }[] =
      await manager.query(
        `SELECT compra_id, COALESCE(SUM(monto), 0)::text AS aplicado
           FROM pago_proveedor_aplicaciones
          WHERE tenant_id = $1 AND compra_id = ANY($2::uuid[])
            AND eliminado_el IS NULL
          GROUP BY compra_id`,
        [tenantId, compraIds],
      );
    const aplicadoMap = new Map(
      aplicadoRows.map((r) => [r.compra_id, r.aplicado]),
    );

    const deudaPorCompra = new Map<string, string | null>();
    for (const c of compras) {
      const esSumaLineas =
        c.tipo_total_documento !== 'obligatorio' &&
        c.tipo_total_documento !== 'opcional';
      const b = bruteMap.get(c.compra_id);
      const total = esSumaLineas
        ? b && !b.algun_sin_precio && b.bruto != null
          ? cuantizar(
              new Decimal(b.bruto).minus(c.descuento_total ?? 0),
              cfg,
            ).toString()
          : null
        : c.total_documento;
      const aplicado = new Decimal(aplicadoMap.get(c.compra_id) ?? '0');
      deudaPorCompra.set(
        c.compra_id,
        total == null
          ? null
          : Decimal.max(0, new Decimal(total).minus(aplicado)).toString(),
      );
    }
    return deudaPorCompra;
  }

  /**
   * Lock de los pagos vigentes del proveedor (spec § 11: segundo, después de
   * las compras) y su saldo a favor — `monto − aplicado`, solo los que
   * quedan con algo (> 0), ordenados por fecha ascendente (el más viejo
   * primero, spec § 5.1) para que `fondear` los consuma en ese orden. El
   * `ORDER BY` del `FOR UPDATE` es por `pago_proveedor_id` (orden de
   * ADQUISICIÓN del lock, spec § 11) — distinto del orden de FONDEO, que es
   * por fecha: son dos preguntas distintas y no tienen que coincidir.
   */
  private async saldoAFavorLockeado(
    manager: EntityManager,
    tenantId: string,
    proveedorId: string,
  ): Promise<{ pagoId: string; disponible: string }[]> {
    const pagos: { pago_proveedor_id: string; fecha: Date; monto: string }[] =
      await manager.query(
        `SELECT pago_proveedor_id, fecha, monto
           FROM pagos_proveedor
          WHERE tenant_id = $1 AND proveedor_id = $2 AND estado = 'vigente'
            AND eliminado_el IS NULL
          ORDER BY pago_proveedor_id
          FOR UPDATE`,
        [tenantId, proveedorId],
      );
    if (!pagos.length) return [];

    const aplicadoRows: { pago_proveedor_id: string; aplicado: string }[] =
      await manager.query(
        `SELECT pago_proveedor_id, COALESCE(SUM(monto), 0)::text AS aplicado
           FROM pago_proveedor_aplicaciones
          WHERE tenant_id = $1
            AND pago_proveedor_id = ANY($2::uuid[])
            AND eliminado_el IS NULL
          GROUP BY pago_proveedor_id`,
        [tenantId, pagos.map((p) => p.pago_proveedor_id)],
      );
    const aplicadoMap = new Map(
      aplicadoRows.map((r) => [r.pago_proveedor_id, r.aplicado]),
    );

    return pagos
      .map((p) => ({
        pagoId: p.pago_proveedor_id,
        fecha: p.fecha,
        disponible: new Decimal(p.monto).minus(
          aplicadoMap.get(p.pago_proveedor_id) ?? '0',
        ),
      }))
      .filter((f) => f.disponible.gt(0))
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
      .map((f) => ({ pagoId: f.pagoId, disponible: f.disponible.toString() }));
  }

  /**
   * El recorte de aplicaciones de una compra cuyo total bajó o recién se
   * conoce (spec § 6, `deuda.ts#recortar`): de la más nueva a la más vieja,
   * hasta que lo aplicado no supere `totalNuevo`. El sobrante de cada
   * aplicación tocada vuelve a su pago como saldo a favor SOLO: no hace
   * falta escribirlo aparte, `saldoAFavorLockeado` ya lo deriva de
   * `monto − aplicaciones vivas`.
   *
   * `anular` reusa este mismo camino con `totalNuevo = '0'` (decisión 6b):
   * "esta compra no debe nada" es exactamente recortar hasta 0.
   *
   * Orden de locks (spec § 11, tercero — la compra ya está lockeada por el
   * llamador ANTES de esto): los pagos que fondean la compra,
   * `FOR UPDATE ORDER BY pago_proveedor_id`. Las aplicaciones no llevan lock
   * propio: con la compra y sus pagos ya tomados, nadie puede insertarles ni
   * borrarlas por debajo (mismo razonamiento que `anularPagoEnTransaccion`).
   *
   * Nunca `UPDATE` del monto (Global Constraints del plan): una aplicación
   * tocada se marca `eliminado_el` y, si queda un resto, se reinserta como
   * fila NUEVA — mismo molde que `pagarEnTransaccion` al insertar las partes.
   */
  private async recortarAplicaciones(
    manager: EntityManager,
    tenantId: string,
    compraId: string,
    totalNuevo: string,
  ): Promise<void> {
    const vivas: {
      pago_proveedor_aplicacion_id: string;
      pago_proveedor_id: string;
      monto: string;
      creado_el: Date;
    }[] = await manager.query(
      `SELECT pago_proveedor_aplicacion_id, pago_proveedor_id, monto, creado_el
         FROM pago_proveedor_aplicaciones
        WHERE tenant_id = $1 AND compra_id = $2 AND eliminado_el IS NULL`,
      [tenantId, compraId],
    );
    if (!vivas.length) return;

    const pagoIds = [...new Set(vivas.map((v) => v.pago_proveedor_id))].sort(
      (a, b) => a.localeCompare(b),
    );
    await manager.query(
      `SELECT pago_proveedor_id FROM pagos_proveedor
        WHERE tenant_id = $1 AND pago_proveedor_id = ANY($2::uuid[])
        ORDER BY pago_proveedor_id
        FOR UPDATE`,
      [tenantId, pagoIds],
    );

    const { aBorrar, aReducir } = recortar(
      vivas.map((v) => ({
        aplicacionId: v.pago_proveedor_aplicacion_id,
        pagoId: v.pago_proveedor_id,
        monto: v.monto,
        creadoEl: v.creado_el,
      })),
      totalNuevo,
    );
    if (!aBorrar.length && !aReducir.length) return;

    const todos = [...aBorrar, ...aReducir.map((r) => r.aplicacionId)];
    await manager.query(
      `UPDATE pago_proveedor_aplicaciones
          SET eliminado_el = NOW(), actualizado_el = NOW()
        WHERE tenant_id = $1 AND pago_proveedor_aplicacion_id = ANY($2::uuid[])`,
      [tenantId, todos],
    );
    if (aReducir.length) {
      await manager.query(
        `INSERT INTO pago_proveedor_aplicaciones
           (pago_proveedor_aplicacion_id, tenant_id, pago_proveedor_id,
            compra_id, monto, creado_el, actualizado_el)
         SELECT gen_random_uuid(), $1, x.pago_id, $2, x.monto, NOW(), NOW()
           FROM unnest($3::uuid[], $4::numeric[]) AS x(pago_id, monto)`,
        [
          tenantId,
          compraId,
          aReducir.map((r) => r.pagoId),
          aReducir.map((r) => r.montoNuevo),
        ],
      );
    }
  }

  /**
   * `POST /compras/pagos/:id/anular` (spec § 5.2). Sin `Idempotency-Key`: no
   * cobra, así que no le aplica ADR-026 (pattern backend § 18 es solo para
   * lo que COBRA).
   */
  async anularPago(
    tenantId: string,
    usuarioId: string,
    pagoId: string,
    dto: AnularPagoProveedorDto,
  ): Promise<PagoProveedorInfo> {
    return this.db.transaccion((manager) =>
      this.anularPagoEnTransaccion(manager, tenantId, usuarioId, pagoId, dto),
    );
  }

  private async anularPagoEnTransaccion(
    manager: EntityManager,
    tenantId: string,
    usuarioId: string,
    pagoId: string,
    dto: AnularPagoProveedorDto,
  ): Promise<PagoProveedorInfo> {
    // Qué compras toca esta anulación, ANTES de lockear nada (spec § 11: las
    // compras van primero). Es una lectura sin lock: lo único que puede
    // sumarle una aplicación NUEVA a este pago es fondear() de OTRO pago que
    // lo use como saldo a favor, y ESE camino toma el lock de
    // `pagos_proveedor` (abajo) antes de tocar sus aplicaciones — así que en
    // cuanto lockeamos ese pago, la lista ya no puede cambiar por debajo.
    const previas: { compra_id: string }[] = await manager.query(
      `SELECT DISTINCT compra_id FROM pago_proveedor_aplicaciones
        WHERE tenant_id = $1 AND pago_proveedor_id = $2 AND eliminado_el IS NULL`,
      [tenantId, pagoId],
    );
    if (previas.length) {
      await manager.query(
        `SELECT compra_id FROM compras
          WHERE tenant_id = $1 AND compra_id = ANY($2::uuid[])
            AND eliminado_el IS NULL
          ORDER BY compra_id
          FOR UPDATE OF compras`,
        [tenantId, previas.map((p) => p.compra_id)],
      );
    }

    const pagos: {
      pago_proveedor_id: string;
      proveedor_id: string;
      monto: string;
      metodo_pago_id: string;
      referencia: string | null;
      caja_id: string | null;
      estado: EstadoPagoProveedor;
    }[] = await manager.query(
      `SELECT pago_proveedor_id, proveedor_id, monto, metodo_pago_id,
              referencia, caja_id, estado
         FROM pagos_proveedor
        WHERE tenant_id = $1 AND pago_proveedor_id = $2
          AND eliminado_el IS NULL
        ORDER BY pago_proveedor_id
        FOR UPDATE`,
      [tenantId, pagoId],
    );
    if (!pagos.length) {
      throw new NotFoundException('Pago no encontrado');
    }
    const pago = pagos[0];
    if (pago.estado === 'anulado') {
      throw new ConflictException('El pago ya está anulado');
    }

    await manager.query(
      `UPDATE pago_proveedor_aplicaciones
          SET eliminado_el = NOW(), actualizado_el = NOW()
        WHERE tenant_id = $1 AND pago_proveedor_id = $2 AND eliminado_el IS NULL`,
      [tenantId, pagoId],
    );
    await manager.query(
      `UPDATE pagos_proveedor
          SET estado = 'anulado', anulado_por = $1, anulado_el = NOW(),
              motivo_anulacion = $2, actualizado_el = NOW()
        WHERE tenant_id = $3 AND pago_proveedor_id = $4`,
      [usuarioId, dto.motivo, tenantId, pagoId],
    );

    if (pago.caja_id) {
      // La caja va AL FINAL (spec § 11). Efectivo con la caja todavía
      // abierta: solo su dueño puede anular (403), y la plata vuelve a ESA
      // caja (decisión 6). Cerrada o en conciliación: no se toca ninguna.
      const cajas: { estado: string; usuario_id: string | null }[] =
        await manager.query(
          `SELECT estado, usuario_id FROM cajas
            WHERE tenant_id = $1 AND caja_id = $2 AND eliminado_el IS NULL`,
          [tenantId, pago.caja_id],
        );
      const caja = cajas[0];
      if (caja?.estado === 'abierta') {
        if (caja.usuario_id !== usuarioId) {
          throw new ForbiddenException(
            'Solo el dueño de la caja puede anular este pago',
          );
        }
        await this.cajaService.bloquearCajaAbierta(
          manager,
          pago.caja_id,
          tenantId,
        );
        // Sin "eliminado_el IS NULL" a propósito: el concepto de esta
        // reversa tiene que seguir nombrando al proveedor aunque se haya
        // borrado DESPUÉS de este pago — mismo criterio que el resto del
        // módulo (comentarioDeCompra, SELECT_CABECERA) para el nombre de un
        // proveedor en un documento histórico.
        const proveedorRows: { nombre: string }[] = await manager.query(
          `SELECT nombre FROM terceros WHERE tercero_id = $1 AND tenant_id = $2`,
          [pago.proveedor_id, tenantId],
        );
        await this.cajaService.registrarMovimientoEnTransaccion(manager, {
          cajaId: pago.caja_id,
          tipo: 'entrada',
          concepto: `Reversa pago a proveedor · ${proveedorRows[0]?.nombre ?? ''}`,
          monto: pago.monto,
          metodoPagoId: pago.metodo_pago_id,
          pagoProveedorId: pagoId,
        });
      }
    }

    return {
      id: pago.pago_proveedor_id,
      proveedorId: pago.proveedor_id,
      fecha: null,
      monto: pago.monto,
      metodoPagoId: pago.metodo_pago_id,
      metodoPagoNombre: null,
      referencia: pago.referencia,
      cajaId: pago.caja_id,
      estado: 'anulado',
      anuladoPor: usuarioId,
      anuladoEl: new Date(),
      motivoAnulacion: dto.motivo,
      aplicaciones: [],
      sobranteAFavor: '0.0000',
    };
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
   *
   * `td.total_documento` viaja por el mismo `LEFT JOIN` sin filtro y por la
   * misma razón que `SELECT_CABECERA`: es un atributo inmutable del tipo
   * (spec compras-deuda-proveedor § 3), así que `actualizarDocumento` puede
   * decidir con él aunque el tipo se haya borrado después de confirmar.
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
                td.total_documento AS tipo_documento_total_documento,
                pr.nombre AS proveedor_nombre,
                c.ubicacion_id, ub.nombre AS ubicacion_nombre,
                (ub.eliminado_el IS NULL) AS ubicacion_viva,
                c.total_documento,
                c.fecha_vencimiento::text AS fecha_vencimiento
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
              cl.cantidad_base, cl.costo_unitario_base, cl.contenido_base,
              cl.presentacion_nombre, cl.series, cl.lote
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
   * La misma política de reintento de `conReintento`, pero sobre una
   * función SIN manager: para envolver `idempotencia.ejecutar(...)` entero
   * (confirmar con `pago`, spec § 7), que abre su PROPIA `db.transaccion` en
   * vez de recibir una. `conReintento` no sirve ahí: reusa el manager activo
   * si ya hay uno, y adentro de `ejecutar` SIEMPRE lo hay — un `40P01`
   * dejaría esa transacción abortada y el "reintento" fallaría de nuevo
   * contra la misma conexión rota. Con esto, cada intento vuelve a llamar a
   * `ejecutar()` de cero, que abre transacción nueva.
   */
  private async conReintentoGenerico<T>(fn: () => Promise<T>): Promise<T> {
    for (let intento = 0; ; intento++) {
      try {
        return await fn();
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
      plazo_pago_dias: number | null;
    }[] = await this.db.query(
      `SELECT nombre, tipo, activo, plazo_pago_dias FROM terceros
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
    const tipos: {
      nombre: string;
      requiere_folio: boolean;
      total_documento: string;
    }[] = await this.db.query(
      `SELECT td.nombre, td.requiere_folio, td.total_documento
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

    // El total transcrito solo lo llevan los tipos `obligatorio`/`opcional`
    // (spec § 3, decisión 10): en un `suma_lineas` es 400, igual que un
    // descuento sin precios.
    if (dto.totalDocumento != null && tipo.total_documento === 'suma_lineas') {
      throw new BadRequestException(
        `"${tipo.nombre}" no lleva total transcrito: su total es la suma de las líneas`,
      );
    }

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
      tipoDocumentoTotalDocumento: tipo.total_documento,
      plazoPagoDias: proveedor.plazo_pago_dias ?? null,
    };
  }

  /** El conversor del catálogo, cargado la primera vez que se pide y no antes. */
  private conversorPerezoso(): () => Promise<Conversor> {
    let cargado: Promise<Conversor> | null = null;
    return () => (cargado ??= this.catalogService.crearConversor());
  }

  /**
   * Una consulta para todos los ítems, una para las presentaciones citadas
   * (`presentacionesService.vivasPorIds`) y una para el catálogo de unidades
   * (`crearConversor`, perezoso), no una por línea. El conversor valida cada
   * línea en memoria y en su lugar del loop, así que el orden de los 400 no
   * cambia (spec pieza 2 § 4.1).
   */
  private async validarLineas(
    tenantId: string,
    proveedorId: string,
    lineas: LineaCompraDto[],
  ): Promise<{
    items: Map<string, { unidadBase: string }>;
    unidades: UnidadResuelta[];
  }> {
    if (!lineas.length) return { items: new Map(), unidades: [] };

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

    const presentacionIds = [
      ...new Set(
        lineas.filter((l) => l.presentacionId).map((l) => l.presentacionId!),
      ),
    ];
    const presentaciones = await this.presentacionesService.vivasPorIds(
      tenantId,
      presentacionIds,
    );

    const conversor = this.conversorPerezoso();
    const unidades: UnidadResuelta[] = [];
    for (const linea of lineas) {
      const item = porId.get(linea.itemId);
      if (!item) {
        throw new BadRequestException('Producto no encontrado');
      }
      if (!TIPOS_CON_STOCK.includes(item.tipo) || !item.modo_inventario) {
        throw new BadRequestException(`"${item.nombre}" no lleva stock`);
      }
      if ((linea.unidadCodigo != null) === (linea.presentacionId != null)) {
        throw new BadRequestException(
          linea.unidadCodigo != null
            ? `"${item.nombre}": elegí una unidad o una presentación, no las dos`
            : `"${item.nombre}": falta la unidad`,
        );
      }

      const base = item.unidad_medida ?? 'unidad';
      let presentacion: UnidadResuelta['presentacion'] = null;
      if (linea.presentacionId) {
        const p = presentaciones.get(linea.presentacionId);
        // Un solo mensaje para no existe, es de otro tenant o fue retirada:
        // distinguirlos obligaría a leer una fila borrada, y un id ajeno no
        // tiene que distinguirse de uno inexistente.
        if (!p) {
          throw new BadRequestException(
            `La presentación de "${item.nombre}" ya no existe o fue retirada: elegí otra unidad`,
          );
        }
        if (p.proveedorId !== proveedorId) {
          throw new BadRequestException(
            `La presentación de "${item.nombre}" es de otro proveedor`,
          );
        }
        if (p.itemId !== linea.itemId) {
          throw new BadRequestException(
            `La presentación elegida no es de "${item.nombre}"`,
          );
        }
        if (item.modo_inventario === 'serie') {
          throw new BadRequestException(
            `"${item.nombre}" va por serie: no admite presentación`,
          );
        }
        const contenidoBase = await cantidadEnBase(
          p.contenido,
          { unidadCodigo: p.unidadCodigo },
          base,
          conversor,
        );
        presentacion = { id: p.id, nombre: p.nombre, contenidoBase };
      } else {
        if (
          linea.unidadCodigo !== base &&
          item.modo_inventario !== 'cantidad'
        ) {
          // El mismo mensaje que `ItemsService.ajustarStock`.
          throw new BadRequestException(
            'Los productos por serie o lote solo admiten su unidad base',
          );
        }
        // El catálogo se carga la primera vez que hace falta, no antes: una
        // factura toda en la unidad base no lo consulta. Tira con el mensaje
        // del catálogo, sin reescribirlo.
        await cantidadEnBase(
          linea.cantidad,
          { unidadCodigo: linea.unidadCodigo! },
          base,
          conversor,
        );
      }

      this.validarTrazabilidad(linea, item.nombre, item.modo_inventario);
      unidades.push({ unidadBase: base, presentacion });
    }

    return {
      items: new Map(
        items.map((i) => [
          i.item_id,
          { unidadBase: i.unidad_medida ?? 'unidad' },
        ]),
      ),
      unidades,
    };
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
    const COLUMNAS = 10;
    const valores = lineas
      .map((_, i) => {
        const p = i * COLUMNAS;
        return `($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}::uuid, $${p + 8}, $${p + 9}::jsonb, $${p + 10}::jsonb)`;
      })
      .join(', ');
    const params = lineas.flatMap((l, i) => [
      compraId,
      tenantId,
      l.itemId,
      i + 1,
      l.cantidad,
      l.unidadCodigo ?? null,
      l.presentacionId ?? null,
      l.precioUnitario ?? null,
      l.series?.length ? JSON.stringify(l.series) : null,
      l.lote ? JSON.stringify(l.lote) : null,
    ]);
    await this.db.query(
      `INSERT INTO compra_lineas
         (compra_id, tenant_id, item_id, orden, cantidad, unidad_codigo,
          presentacion_compra_id, precio_unitario, series, lote)
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

  /**
   * La config del motor de precios para cuantizar el total `suma_lineas`
   * (spec § 4.1 y § 14): una consulta por request, nunca por fila — la
   * misma para toda la lista o el detalle de un mismo tenant.
   */
  private async cfgTenant(tenantId: string): Promise<ConfigCalculo> {
    return this.calculoPreciosService.cargarConfig(
      tenantId,
      await this.monedasService.decimalesOficiales(tenantId),
    );
  }

  /**
   * "Hoy" para marcar `vencida` (spec § 4.1 y § 8): el día del NEGOCIO del
   * tenant (zona + hora de corte), no el día de calendario de la hora de
   * reloj — mismo mecanismo que el resto del proyecto usa para "hoy"
   * (`docs/patterns/backend.md` § 10b; lo hace cumplir
   * `dia-negocio.invariant.spec.ts`, que prohíbe `fechaLocalTenant` fuera de
   * la allowlist del motor de precios/promociones).
   */
  private async hoyNegocio(tenantId: string): Promise<string> {
    const dia = await diaNegocioTenant(this.db, tenantId);
    return diaNegocioEnZona(dia, new Date());
  }

  private mapListItem(
    r: CabeceraRow,
    cfg: ConfigCalculo,
    pago: { tienePagar: boolean; hoy: string } | null,
  ): CompraListItem {
    return { ...this.mapCabecera(r, cfg, pago), lineas: r.lineas };
  }

  private mapCabecera(
    r: CabeceraRow,
    cfg: ConfigCalculo,
    /** `null` = no calcular nada de pago (llamador sin `Pagar`, spec § 8). */
    pago: { tienePagar: boolean; hoy: string } | null,
  ): Omit<CompraListItem, 'lineas'> {
    const sinPrecio = r.algun_sin_precio;
    // Un tipo `obligatorio`/`opcional` no calcula: el total es lo transcrito
    // (decisión 10). Un `suma_lineas` (o un tipo borrado, que ya no informa
    // su clasificación) sigue con la cuenta de siempre, cuantizada una vez.
    const esSumaLineas =
      r.tipo_documento_total_documento !== 'obligatorio' &&
      r.tipo_documento_total_documento !== 'opcional';
    const total = esSumaLineas
      ? r.lineas > 0 && !sinPrecio && r.bruto != null
        ? cuantizar(
            new Decimal(r.bruto).minus(r.descuento_total ?? 0),
            cfg,
          ).toString()
        : null
      : r.total_documento;
    // El estado de pago solo tiene sentido en una compra CONFIRMADA (spec §
    // 4.1: "solo cuentan las compras confirmada"; un borrador o una anulada
    // no deben nada, aunque tengan aplicaciones vivas de antes de anularse
    // — que `anular` ya recortó a 0, decisión 6b).
    const datosDePago =
      pago?.tienePagar && r.estado === 'confirmada'
        ? estadoPagoCompra({
            total,
            aplicado: r.aplicado,
            fechaVencimiento: r.fecha_vencimiento,
            hoy: pago.hoy,
            esSumaLineas,
          })
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
      totalDocumento: r.total_documento,
      fechaVencimiento: r.fecha_vencimiento,
      ...(datosDePago
        ? {
            estadoPago: datosDePago.estadoPago,
            deuda: datosDePago.deuda,
            vencida: datosDePago.vencida,
          }
        : {}),
    };
  }
}
