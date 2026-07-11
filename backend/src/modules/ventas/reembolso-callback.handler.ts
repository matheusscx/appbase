import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  ReembolsoAprobadoEvento,
  ReembolsoCallbackHandler,
  ReembolsoCallbackRegistry,
} from '../pasarela/services/reembolso-callback.registry';
import { VentasService } from './ventas.service';

/**
 * Callback in-process de reembolsos: cuando la pasarela aprueba un reembolso
 * sobre una orden con venta vinculada, materializa el lado de ventas — nota de
 * crédito interna si el admin la pidió y/o devoluciones de stock elegidas.
 *
 * Se registra en el ReembolsoCallbackRegistry al arrancar, evitando que la
 * pasarela dependa de `ventas` (el borde se cruza solo en esta dirección).
 * Los errores se propagan: los captura CobrosService, que responde con
 * warning sin revertir el reembolso (la plata ya volvió al cliente).
 */
@Injectable()
export class VentasReembolsoHandler
  implements ReembolsoCallbackHandler, OnModuleInit
{
  constructor(
    private readonly registry: ReembolsoCallbackRegistry,
    private readonly ventasService: VentasService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async onReembolsoAprobado(
    evento: ReembolsoAprobadoEvento,
  ): Promise<{ notaCreditoId?: string }> {
    if (evento.generarNotaCredito) {
      const nc = await this.ventasService.crearNotaCredito({
        tenantId: evento.tenantId,
        usuarioId: evento.usuarioId,
        ventaOriginalId: evento.ventaId,
        monto: evento.monto,
        devoluciones: evento.devoluciones,
        comentario: `NC por reembolso orden ${evento.codigoOrden}`,
      });
      return { notaCreditoId: nc.id };
    }
    if (evento.devoluciones.length) {
      await this.ventasService.registrarDevolucionesPorReembolso({
        tenantId: evento.tenantId,
        usuarioId: evento.usuarioId,
        ventaOriginalId: evento.ventaId,
        devoluciones: evento.devoluciones,
        comentario: `Devolución por reembolso orden ${evento.codigoOrden}`,
      });
    }
    return {};
  }
}
