// backend/src/modules/paqueteria/paqueteria.types.ts  (frontend/app/types/paqueteria.ts es su espejo)
export type EstadoPaquete = 'disponible' | 'en_ruta' | 'entregado';
export type EstadoLinea = 'en_ruta' | 'entregado' | 'no_entregado';
export type EstadoHoja = 'abierta' | 'rendida';
export type MedioCobro = 'efectivo' | 'transferencia';
export type ResultadoEscaneo = 'asignado_nuevo' | 'asignado' | 'ya_escaneado';

export interface PaqueteConfiguracionRespuesta {
  // false = no se guardó el precio de envío por defecto o no hay una tarifa de pago por defecto:
  // escanear y crear sin montos dan 400
  configurada: boolean;
  precioEnvioDefecto: string;
}

export interface RepartidorFila {
  id: string;
  nombre: string;
  telefono: string | null;
  activo: boolean;
  tarifaPagoId: string | null;
}

export interface TarifaPagoFila {
  id: string;
  nombre: string;
  monto: string;
  esDefecto: boolean;
  activa: boolean;
}

export interface PaqueteFila {
  id: string;
  codigo: string;
  destinatarioNombre: string | null;
  destinatarioTelefono: string | null;
  direccion: string | null;
  comuna: string | null;
  nota: string | null;
  remitenteTerceroId: string | null;
  remitenteNombre: string | null;
  cobroEnDestino: boolean;
  precioEnvio: string;
  tarifaPagoId: string | null; // null = se paga con la del repartidor o la por defecto (regla 10)
  tarifaPagoNombre: string | null;
  estado: EstadoPaquete; // derivado de las líneas (docs/features/paqueteria.md, regla 2)
  hojaRutaId: string | null; // la hoja de la línea en_ruta / entregado
  repartidorNombre: string | null;
  bloqueado: boolean; // entregado en una hoja rendida (regla 7)
}

export interface TotalesHoja {
  asignados: number;
  enRuta: number;
  entregados: number;
  cobroDestino: number; // cantidad de entregados con cobro en destino
  montoCobradoDestino: string;
  montoCobradoEfectivo: string; // montoCobradoEfectivo + montoCobradoTransferencia = montoCobradoDestino
  montoCobradoTransferencia: string;
  montoPagoRepartidor: string;
  montoTotalGeneral: string; // Σ precio_envio de todos los entregados
  netoARendir: string; // cobrado − pago (puede ser negativo)
}

export interface HojaRutaFila extends TotalesHoja {
  id: string;
  repartidorId: string;
  repartidorNombre: string;
  fecha: string; // YYYY-MM-DD
  estado: EstadoHoja;
  rendidaEl: string | null;
}

export interface LineaHoja {
  paqueteId: string;
  codigo: string;
  destinatarioNombre: string | null;
  direccion: string | null;
  comuna: string | null;
  cobroEnDestino: boolean;
  precioEnvio: string;
  // Entregada: lo fijado al entregar. Si no: lo que se pagaría hoy (`pagoEstimado`), que cambia
  // con la tarifa; null/0 si no hay ninguna que aplique.
  tarifaPagoId: string | null;
  tarifaPagoNombre: string | null;
  pagoRepartidor: string;
  pagoEstimado: boolean;
  medioCobro: MedioCobro | null; // solo en una entregada con cobro en destino
  estado: EstadoLinea;
}

export interface HojaRutaDetalle extends HojaRutaFila {
  lineas: LineaHoja[]; // la más reciente primero
}

export interface RespuestaEscaneo {
  resultado: ResultadoEscaneo;
  codigo: string; // ya normalizado
  hoja: HojaRutaDetalle;
}

export interface ResumenPaqueteria {
  asignados: number;
  entregados: number;
  cobroDestino: number;
  montoCobradoDestino: string;
  montoCobradoTransferencia: string;
  montoTotalGeneral: string;
  montoPagoRepartidor: string;
}
