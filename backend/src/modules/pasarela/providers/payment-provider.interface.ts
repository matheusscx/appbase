export type CredencialesResueltas = Record<string, string>; // siempre incluye baseUrl

export interface ResultadoProvider {
  aprobada: boolean;
  codigoRespuesta: string | null;
  request: Record<string, unknown>; // crudo — TransaccionesService lo redacta
  response: Record<string, unknown>;
}

export interface ResultadoInscripcion extends ResultadoProvider {
  identificadorExterno: string | null; // tbkUser en claro (el service lo cifra)
  codigoAutorizacion: string | null;
  tarjeta: { tipo: string; marca: string | null; ultimos4: string } | null;
}

export interface ResultadoCobro extends ResultadoProvider {
  codigoAutorizacion: string | null;
  identificadorTransaccionExterno: string | null;
  tipoPago: string | null;
  numeroCuotas: number | null;
  montoCuota: string | null;
}

export interface ResultadoEstado {
  estado: 'pagada' | 'fallida' | 'desconocido';
  response: Record<string, unknown>;
}

/** Error de red/HTTP contra el proveedor — NO significa rechazo del cobro. */
export class ProviderComunicacionError extends Error {
  constructor(
    message: string,
    public readonly request: Record<string, unknown>,
    public readonly response: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/**
 * Referencia de una transacción existente. Cada proveedor usa el identificador
 * que le corresponde: Oneclick por `codigoOrden` (buyOrder), Webpay Plus por
 * `tokenProveedor`. Ambos se pasan siempre; el proveedor elige.
 */
export interface ReferenciaTransaccion {
  codigoOrden: string;
  tokenProveedor: string | null;
}

/** Operaciones comunes a todo proveedor, independientes del flujo de cobro. */
export interface ProviderReembolsable {
  reembolsar(
    cred: CredencialesResueltas,
    p: ReferenciaTransaccion & { monto: string },
  ): Promise<ResultadoCobro>;
  consultarEstado(
    cred: CredencialesResueltas,
    referencia: ReferenciaTransaccion,
  ): Promise<ResultadoEstado>;
}

/**
 * Flujo tokenizado: se inscribe (tokeniza) la tarjeta una vez y luego se cobra
 * con el token guardado, sin redirect por cobro (ej. Transbank Oneclick).
 */
export interface ProviderTokenizado extends ProviderReembolsable {
  iniciarInscripcion(
    cred: CredencialesResueltas,
    p: { username: string; email: string; responseUrl: string },
  ): Promise<
    { tokenExterno: string; urlRedireccion: string } & ResultadoProvider
  >;
  confirmarInscripcion(
    cred: CredencialesResueltas,
    token: string,
  ): Promise<ResultadoInscripcion>;
  eliminarInscripcion(
    cred: CredencialesResueltas,
    p: { identificadorExterno: string; username: string },
  ): Promise<void>;
  autorizarCobro(
    cred: CredencialesResueltas,
    p: {
      username: string;
      identificadorExterno: string;
      codigoOrden: string;
      monto: string;
      moneda: string;
      cuotas: number;
    },
  ): Promise<ResultadoCobro>;
}

/**
 * Flujo de pago único con redirect: se crea la transacción, el comprador paga en
 * el formulario hosted del proveedor y al volver se confirma (ej. Webpay Plus).
 * No tokeniza tarjeta.
 */
export interface ProviderPagoRedirect extends ProviderReembolsable {
  iniciarPago(
    cred: CredencialesResueltas,
    p: {
      codigoOrden: string;
      monto: string;
      moneda: string;
      returnUrl: string;
    },
  ): Promise<
    { tokenExterno: string; urlRedireccion: string } & ResultadoProvider
  >;
  confirmarPago(
    cred: CredencialesResueltas,
    token: string,
  ): Promise<ResultadoCobro>;
}
