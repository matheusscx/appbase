/** Tipos de boleta que emite el motor (SII, Formato Boletas v4.2, campo 2). */
export type TipoBoleta = 39 | 41;

/** Campo 10 del formato: 1 efectivo, 2 electrónico, 3 transferencia, 4 cheque, 5 otro. */
export type MedioPagoSii = 1 | 2 | 3 | 4 | 5;

export interface EmisorBoleta {
  rut: string;
  razonSocial: string;
  giro: string;
  direccion: string;
  comuna: string;
  /** Código de sucursal del SII; se omite si el emisor no tiene sucursales. */
  cdgSiiSucur?: string;
}

/** Nosotros: `RutProvSW` / `RznSocProvSW` (formato v4.2). */
export interface ProveedorSoftware {
  rut: string;
  razonSocial: string;
}

export interface ReceptorBoleta {
  rut: string;
  nombre?: string;
  correo?: string;
  telefono?: string;
}

/** Una línea del detalle. Los montos van CON IVA incluido (sin IndMntNeto). */
export interface LineaBoleta {
  nombre: string;
  cantidad?: string;
  precioUnitario?: string;
  descuentoMonto?: string;
  recargoMonto?: string;
  /** `MontoItem`: lo congelado de la línea, en pesos enteros. */
  monto: string;
  exenta: boolean;
}

/** `DscRcgGlobal` en pesos: D descuento, R recargo. */
export interface AjusteGlobal {
  tipo: 'D' | 'R';
  glosa: string;
  monto: string;
  exento: boolean;
}

/** Lo congelado en la venta (ADR-010): el motor lo verifica, no lo recalcula. */
export interface MontosBoleta {
  neto: string;
  exento: string;
  iva: string;
  total: string;
  /** Suma de impuestos adicionales congelados (ILA…). > 0 hoy es error. */
  adicionales: string;
}

export interface DatosBoleta {
  tipo: TipoBoleta;
  folio: number;
  /** AAAA-MM-DD, en la hora de Chile; la decide quien llama. */
  fechaEmision: string;
  emisor: EmisorBoleta;
  proveedorSoftware: ProveedorSoftware;
  receptor?: ReceptorBoleta;
  medioPago?: MedioPagoSii;
  /** La venta supera 135 UF (Res. Ex. SII 44/2025): lo calcula quien llama. */
  superaUmbralIdentificacion: boolean;
  lineas: LineaBoleta[];
  ajustesGlobales: AjusteGlobal[];
  montos: MontosBoleta;
}

export type CodigoDteError =
  | 'TOTALES_NO_CIERRAN'
  | 'LINEA_NO_CIERRA'
  | 'MONTO_NO_ENTERO'
  | 'MONTO_NEGATIVO'
  | 'TOTAL_NO_POSITIVO'
  | 'BOLETA_EXENTA_CON_AFECTO'
  | 'FOLIO_FUERA_DE_RANGO'
  | 'CAF_OTRO_RUT'
  | 'CAF_OTRO_TIPO'
  | 'CAF_INVALIDO'
  | 'CERTIFICADO_INVALIDO'
  | 'TEXTO_NO_ISO_8859_1'
  | 'TEXTO_DEMASIADO_LARGO'
  | 'RUT_INVALIDO'
  | 'FALTA_IDENTIFICACION_135_UF'
  | 'IMPUESTO_ADICIONAL_NO_SOPORTADO'
  | 'ENVIO_VACIO'
  | 'ENVIO_DEMASIADAS_BOLETAS';

/** Error del motor con un código por motivo, para que el que llama sepa qué pasó. */
export class DteError extends Error {
  constructor(
    readonly codigo: CodigoDteError,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'DteError';
  }
}
