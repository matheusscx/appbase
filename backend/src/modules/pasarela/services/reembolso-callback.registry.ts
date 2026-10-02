import { Injectable } from '@nestjs/common';

/**
 * Evento emitido tras el COMMIT de un reembolso aprobado sobre una orden con
 * venta vinculada. `devoluciones` viene del DTO del endpoint; `usuarioId`
 * siempre del token (nunca del body).
 */
export interface ReembolsoAprobadoEvento {
  tenantId: string;
  ordenId: string;
  codigoOrden: string;
  ventaId: string;
  monto: string;
  /**
   * `reponerStock` ausente = repone si el ítem puede. Por este camino pedir que
   * reponga algo que no puede NO se rechaza: se acredita igual y no se repone
   * (ver `validarDevolucionesReembolso`), porque un throw acá pierde el evento.
   */
  devoluciones: {
    itemId: string;
    cantidad: string;
    reponerStock?: boolean;
  }[];
  /**
   * Quién reembolsó, siempre del token. `null` por la API externa (llave de API):
   * no hay usuario, y un `''` reventaba el INSERT del movimiento de stock (columna
   * uuid) y con él toda la corrección.
   */
  usuarioId: string | null;
}

/**
 * Contrato del callback in-process de reembolsos. Un módulo de negocio
 * (`ventas`) lo implementa para materializar su lado cuando la pasarela
 * aprueba un reembolso: SIEMPRE crea la corrección de la venta (con las
 * devoluciones de stock dentro) y devuelve su id. Mantiene el borde: la
 * pasarela NO importa los módulos de negocio; ellos se registran contra esta
 * interfaz. Los errores del handler los captura el caller (CobrosService) — el
 * reembolso nunca se revierte.
 *
 * El handler NO escribe en `pasarela_transacciones`: devuelve el id y
 * `CobrosService`, dueño de esa tabla, lo liga al REFUND.
 */
export interface ReembolsoCallbackHandler {
  onReembolsoAprobado(
    evento: ReembolsoAprobadoEvento,
  ): Promise<{ correccionVentaId: string }>;
}

/**
 * Registro singleton del handler de reembolsos, mismo patrón que
 * PagoCallbackRegistry: un único handler por proceso, registrado en el
 * `onModuleInit` del módulo consumidor.
 */
@Injectable()
export class ReembolsoCallbackRegistry {
  private handler: ReembolsoCallbackHandler | null = null;

  register(handler: ReembolsoCallbackHandler): void {
    this.handler = handler;
  }

  get(): ReembolsoCallbackHandler | null {
    return this.handler;
  }
}
