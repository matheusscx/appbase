import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { SolicitudIdempotenteInput } from '../../idempotencia/idempotencia.service';

/**
 * Lo que pasa con lo devuelto en una línea con stock de por medio (owner,
 * 2026-08-23): vuelve al stock, o vuelve y sale como merma con la causa fija
 * "Devolución". Vive acá porque es el contrato entre los dos lados del borde:
 * la pasarela lo valida en su DTO y ventas lo aplica, y la pasarela no importa
 * ventas.
 */
export const DESTINOS_STOCK_DEVOLUCION = ['recupera', 'pierde'] as const;
export type DestinoStockDevolucion = (typeof DESTINOS_STOCK_DEVOLUCION)[number];

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
   * Las líneas que se acreditan, con lo que pasa con lo devuelto (`stock`). La
   * respuesta ya se exigió antes de llamar al proveedor
   * (`validarDevolucionesDelReembolso`); por este camino nada se rechaza, porque
   * un throw acá pierde el evento: sin respuesta (la `metadata` de un REFUND
   * anterior a la pregunta) no se mueve stock.
   */
  devoluciones: {
    itemId: string;
    cantidad: string;
    stock?: DestinoStockDevolucion;
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
  /**
   * Solo "Generar nota" (la corrección de un REFUND que quedó sin ella): la
   * `Idempotency-Key` del intento, que la nota reclama como primera sentencia de
   * su transacción (ADR-026). El hook post-commit no la pasa: no hay nadie que
   * reintente, y su nota ya es una por REFUND.
   */
  idempotencia?: SolicitudIdempotenteInput;
  /**
   * Solo "Generar nota": lo que se chequea DESPUÉS del reclamo y bajo el
   * `FOR UPDATE` de la venta, antes de componer nada —que el REFUND siga sin
   * corrección y las líneas, con la regla de la nota manual—. Antes del reclamo
   * haría rebotar la reproducción (ADR-026). Si lanza, no queda nada.
   */
  alTomarLaVenta?: (manager: EntityManager) => Promise<void>;
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
   *
   * Los REFUND sin confirmar de la venta gastan el tope (ADR-029), salvo
   * `excluirReembolsoId`: el del propio reembolso, que en tx1 ya está en `iniciada`.
   */
  exigirTopeDelReembolso(
    manager: EntityManager,
    params: {
      tenantId: string;
      ventaId: string;
      monto: string;
      excluirReembolsoId: string | null;
    },
  ): Promise<void>;

  /**
   * Las líneas que se van a acreditar, validadas como en la nota manual —ítem de
   * la venta, cantidad disponible y, en la línea con stock de por medio, la
   * respuesta a "¿se recupera o se pierde?"—, ANTES de llamar al proveedor:
   * después la plata ya salió y la nota no puede rechazar nada. Lanza un 400 con
   * el motivo. Corre en tx0, después de `exigirTopeDelReembolso` (que ya tomó el
   * lock de la venta); con una venta que ya no existe no lanza.
   */
  validarDevoluciones(
    manager: EntityManager,
    params: {
      tenantId: string;
      ventaId: string;
      devoluciones: ReembolsoAprobadoEvento['devoluciones'];
    },
  ): Promise<void>;

  /** `repetida`: la clave del evento ya había emitido esta nota y se reprodujo. */
  onReembolsoAprobado(
    evento: ReembolsoAprobadoEvento,
  ): Promise<{ correccionVentaId: string; repetida?: true }>;
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
