import { Injectable } from '@nestjs/common';

/**
 * Evento emitido tras el COMMIT de un reembolso aprobado sobre una orden con
 * venta vinculada. `devoluciones` y `generarNotaCredito` vienen del DTO del
 * endpoint admin; `usuarioId` siempre del token (nunca del body).
 */
export interface ReembolsoAprobadoEvento {
  tenantId: string;
  ordenId: string;
  codigoOrden: string;
  ventaId: string;
  monto: string;
  generarNotaCredito: boolean;
  devoluciones: { itemId: string; cantidad: string }[];
  usuarioId: string;
}

/**
 * Contrato del callback in-process de reembolsos. Un módulo de negocio
 * (`ventas`) lo implementa para materializar su lado (nota de crédito y/o
 * devoluciones de stock) cuando la pasarela aprueba un reembolso. Mantiene el
 * borde: la pasarela NO importa los módulos de negocio; ellos se registran
 * contra esta interfaz. Los errores del handler los captura el caller
 * (CobrosService) — el reembolso nunca se revierte.
 */
export interface ReembolsoCallbackHandler {
  onReembolsoAprobado(
    evento: ReembolsoAprobadoEvento,
  ): Promise<{ notaCreditoId?: string }>;
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
