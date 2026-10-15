import Decimal from 'decimal.js';
import {
  type CodigoDteError,
  type DatosBoleta,
  DteError,
  type EmisorBoleta,
  type LineaBoleta,
  type MedioPagoSii,
  type ProveedorSoftware,
  type ReceptorBoleta,
  type TipoBoleta,
} from '../dte/dte.types';

/** Línea de la venta tal como la dejó `venta_detalles`, con lo que la boleta necesita de ella. */
export interface LineaParaBoleta {
  descripcion: string | null;
  /** `venta_detalles.cantidad` */
  cantidad: string;
  /** `venta_detalles.subtotal`: neto, antes de descuentos. */
  subtotal: string;
  /** `venta_detalles.total_linea`: con impuestos y con los descuentos ya repartidos. */
  totalLinea: string;
  /** `clasificacion_tributaria = 'exento'` */
  exenta: boolean;
  /** Suma de los `porcentaje_aplicado` de sus `ventas_impuestos` de tipo `iva` ('0' en una exenta). */
  tasaIva: string;
}

/** Los baldes que el documento ya congeló (ADR-028). */
export interface DocumentoParaBoleta {
  monto: string;
  montoAfecto: string;
  montoExento: string;
  montoImpuestos: string;
  /** `monto = ventas.total_final` */
  cubreTodo: boolean;
}

export interface VentaParaBoleta {
  /** AAAA-MM-DD en la hora de Chile (`fechaChile(ventas.creado_el)`). */
  fechaVenta: string;
  lineas: LineaParaBoleta[];
  documento: DocumentoParaBoleta;
  /** Suma de los `ventas_impuestos` de impuestos que no son de tipo `iva`. */
  adicionales: string;
  receptor: {
    rut: string;
    nombre: string | null;
    correo: string | null;
    telefono: string | null;
  } | null;
  superaUmbral: boolean;
  /** Ya en el orden en que se registraron. */
  pagos: { monto: string; medioPagoSii: MedioPagoSii | null }[];
}

export const NOMBRE_LINEA_SALDO = 'Saldo de la venta';
export const NOMBRE_LINEA_SALDO_EXENTO = 'Saldo de la venta (exento)';

/** `PrcItem` admite hasta 6 decimales (Dec5Type). */
const DECIMALES_PRECIO = 6;
/** Medio de pago "otro" del formato v4.2, para el pago sin código. */
const MEDIO_PAGO_OTRO: MedioPagoSii = 5;

const cero = (v: string) => new Decimal(v).isZero();

/**
 * 41 si la boleta no lleva nada afecto; 39 si no. Cubriendo todo se mira cada línea (y tiene que
 * haber al menos una); cubriendo una parte no hay líneas de la venta en la boleta, se miran los
 * baldes del documento.
 */
export function tipoBoletaDe(v: VentaParaBoleta): TipoBoleta {
  const d = v.documento;
  const todoExento = d.cubreTodo
    ? v.lineas.length > 0 && v.lineas.every((l) => l.exenta)
    : cero(d.montoAfecto) && cero(d.montoImpuestos);
  return todoExento ? 41 : 39;
}

/**
 * La línea de la venta como línea de la boleta, con IVA incluido. El precio unitario se arma de
 * `subtotal` y `tasaIva` y la diferencia con `total_linea` (los descuentos y el reparto de los de
 * nivel venta) va como descuento o recargo en pesos: así la igualdad de la regla 2 del motor
 * (`precio × cantidad − descuento + recargo = monto`) cierra por construcción, con menos de un
 * peso de diferencia.
 */
function lineaDeVenta(l: LineaParaBoleta, i: number): LineaBoleta {
  // Sin descripción no hay boleta: el motor emitiría `NmbItem` vacío y el SII la rechazaría.
  // No se inventa un nombre.
  const nombre = l.descripcion?.trim() ? l.descripcion : null;
  if (nombre === null)
    throw new DteError(
      'LINEA_SIN_NOMBRE',
      `La línea ${(i + 1).toString()} de la venta no tiene nombre: la boleta no puede salir sin la descripción del producto`,
    );
  const base = {
    nombre,
    monto: l.totalLinea,
    exenta: l.exenta,
  };
  const subtotal = new Decimal(l.subtotal);
  // Línea gratis: sin precio. El motor no la verifica, así que lleva solo su cantidad.
  if (subtotal.isZero()) return { ...base, cantidad: l.cantidad };

  const cantidad = new Decimal(l.cantidad);
  const precio = subtotal
    .div(cantidad)
    .mul(new Decimal(1).plus(l.tasaIva))
    .toDecimalPlaces(DECIMALES_PRECIO, Decimal.ROUND_HALF_UP);
  const dif = precio
    .mul(cantidad)
    .minus(l.totalLinea)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return {
    nombre: base.nombre,
    cantidad: l.cantidad,
    precioUnitario: precio.toFixed(),
    ...(dif.gt(0) ? { descuentoMonto: dif.toFixed() } : {}),
    ...(dif.lt(0) ? { recargoMonto: dif.neg().toFixed() } : {}),
    monto: base.monto,
    exenta: base.exenta,
  };
}

/**
 * Las líneas de saldo de un documento que cubre una parte. Sin cantidad ni precio, y sobre todo
 * sin descuento ni recargo: el motor no verifica una línea sin cantidad y precio, y un descuento
 * ahí podría "explicar" un total en cero sin corresponder a ningún precio.
 */
function lineasDeSaldo(d: DocumentoParaBoleta): LineaBoleta[] {
  const afecto = new Decimal(d.montoAfecto).plus(d.montoImpuestos);
  const exento = new Decimal(d.montoExento);
  const lineas: LineaBoleta[] = [];
  if (afecto.gt(0) || exento.lte(0))
    lineas.push({
      nombre: NOMBRE_LINEA_SALDO,
      monto: afecto.toFixed(),
      exenta: false,
    });
  if (exento.gt(0))
    lineas.push({
      nombre: NOMBRE_LINEA_SALDO_EXENTO,
      monto: exento.toFixed(),
      exenta: true,
    });
  return lineas;
}

/** El medio de pago del pago de mayor monto (empate: el primero); sin código es "otro". */
function medioPagoDe(
  pagos: VentaParaBoleta['pagos'],
): MedioPagoSii | undefined {
  let mayor: VentaParaBoleta['pagos'][number] | undefined;
  for (const p of pagos)
    if (!mayor || new Decimal(p.monto).gt(mayor.monto)) mayor = p;
  return mayor ? (mayor.medioPagoSii ?? MEDIO_PAGO_OTRO) : undefined;
}

function receptorDe(
  r: VentaParaBoleta['receptor'],
): ReceptorBoleta | undefined {
  if (!r?.rut) return undefined;
  return {
    rut: r.rut,
    ...(r.nombre ? { nombre: r.nombre } : {}),
    ...(r.correo ? { correo: r.correo } : {}),
    ...(r.telefono ? { telefono: r.telefono } : {}),
  };
}

/**
 * Los datos de la boleta de una venta (spec § 4.2–4.3). Función pura: no lee la base ni decide
 * nada que el motor deba decidir; las igualdades las verifica `emitirBoleta`. Los montos son los
 * baldes congelados del documento, tal cual (el motor exige pesos enteros).
 */
export function datosBoletaDeVenta(
  v: VentaParaBoleta,
  folio: number,
  emisor: EmisorBoleta,
  proveedor: ProveedorSoftware,
): DatosBoleta {
  const d = v.documento;
  const medioPago = v.superaUmbral ? medioPagoDe(v.pagos) : undefined;
  const receptor = receptorDe(v.receptor);
  return {
    tipo: tipoBoletaDe(v),
    folio,
    fechaEmision: v.fechaVenta,
    emisor,
    proveedorSoftware: proveedor,
    ...(receptor ? { receptor } : {}),
    ...(medioPago === undefined ? {} : { medioPago }),
    superaUmbralIdentificacion: v.superaUmbral,
    lineas: d.cubreTodo ? v.lineas.map(lineaDeVenta) : lineasDeSaldo(d),
    // Los descuentos y recargos de nivel venta ya vienen repartidos en cada línea (`ajuste_venta`).
    ajustesGlobales: [],
    montos: {
      neto: d.montoAfecto,
      exento: d.montoExento,
      iva: d.montoImpuestos,
      total: d.monto,
      adicionales: v.adicionales,
    },
  };
}

/**
 * Quién tiene que arreglar un error de emisión: `perfil` es de la configuración del emisor
 * (folios, certificado, datos fiscales) y `boleta` es de esta venta.
 */
export type GrupoErrorEmision = 'perfil' | 'boleta';

export function grupoDelError(codigo: CodigoDteError): GrupoErrorEmision {
  switch (codigo) {
    case 'SIN_FOLIOS':
    case 'SIN_CERTIFICADO':
    case 'CERTIFICADO_VENCIDO':
    case 'PERFIL_INCOMPLETO':
    case 'AMBIENTE_DISTINTO':
      return 'perfil';
    default:
      return 'boleta';
  }
}
