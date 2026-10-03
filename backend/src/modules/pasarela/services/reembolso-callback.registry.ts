import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

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
  /**
   * Liga el REFUND con la corrección. El handler lo corre con el `manager` de la
   * transacción que crea la corrección, antes de su commit, y si lanza la
   * corrección se revierte: una corrección commiteada con el REFUND sin ligar
   * descontaba dos veces lo mismo del tope del pago. Lanza también si no ligó
   * ninguna fila.
   */
  ligarCorreccion: (
    manager: EntityManager,
    correccionVentaId: string,
  ) => Promise<void>;
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
 * El handler NO escribe en `pasarela_transacciones`: `CobrosService`, dueño de
 * esa tabla, le pasa en el evento cómo ligar el REFUND (`ligarCorreccion`), y el
 * handler lo corre dentro de la transacción de la corrección.
 */
export interface ReembolsoCallbackHandler {
  /**
   * El tope por pago del lado de ventas, ANTES de llamar al proveedor: la plata
   * que ese reembolso devolvería no puede pasar de lo que el pago de la venta
   * todavía puede devolver (descontadas las notas "por el pago" del POS). Lanza un
   * 400 sin cifras si no alcanza; con una venta sin un único pago, o que ya no
   * existe, no hay tope y no lanza.
   *
   * Corre en la transacción del reembolso, con el `FOR UPDATE` de la orden ya
   * tomado, y toma el de la venta: el orden orden → venta es el único que existe
   * (ver `CobrosService.reembolsar`).
   */
  exigirTopeDelReembolso(
    manager: EntityManager,
    params: { tenantId: string; ventaId: string; monto: string },
  ): Promise<void>;

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
