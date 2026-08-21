import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  ReembolsoAprobadoEvento,
  ReembolsoCallbackHandler,
  ReembolsoCallbackRegistry,
} from '../pasarela/services/reembolso-callback.registry';
import { VentasService } from './ventas.service';
import { MonedasService } from '../monedas/monedas.service';

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
  private readonly logger = new Logger(VentasReembolsoHandler.name);

  constructor(
    private readonly registry: ReembolsoCallbackRegistry,
    private readonly ventasService: VentasService,
    private readonly monedas: MonedasService,
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
        monto: await this.cuantizarMontoReembolso(evento),
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

  /**
   * La pasarela ya movió la plata: rechazar el callback por decimales de más
   * no deshace el cobro, solo pierde el evento (decisión P3 — un hecho
   * consumado se registra, no se rechaza como haría el guard de un cajero
   * tipeando un monto). Se cuantiza a la escala de la moneda con la que se
   * registró la venta original (no la oficial vigente del tenant, que puede
   * haber cambiado desde entonces) y, si el valor cambió, queda una traza con
   * el número exacto que informó la pasarela para poder reconstruirlo después.
   * Si ya venía bien no se loguea nada, para no llenar el log de ruido.
   */
  private async cuantizarMontoReembolso(
    evento: ReembolsoAprobadoEvento,
  ): Promise<string> {
    const decimales = await this.monedas.decimalesDeLaVenta(
      evento.ventaId,
      evento.tenantId,
    );
    const montoExacto = new Decimal(evento.monto);
    const montoCuantizado = montoExacto.toDecimalPlaces(
      decimales,
      Decimal.ROUND_HALF_UP,
    );
    if (montoCuantizado.eq(montoExacto)) {
      return evento.monto;
    }
    this.logger.warn(
      `Reembolso de la pasarela con más decimales que la moneda: ${evento.monto} → ${montoCuantizado.toString()} (venta ${evento.ventaId})`,
    );
    return montoCuantizado.toString();
  }
}
