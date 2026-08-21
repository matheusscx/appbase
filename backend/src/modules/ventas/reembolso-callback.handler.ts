import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  modoToRounding,
  type ModoRedondeo,
} from '../calculo-precios/calculo-precios.engine';
import {
  ReembolsoAprobadoEvento,
  ReembolsoCallbackHandler,
  ReembolsoCallbackRegistry,
} from '../pasarela/services/reembolso-callback.registry';
import { VentasService } from './ventas.service';
import { MonedasService } from '../monedas/monedas.service';

/**
 * Fallback de `modoRedondeo` cuando la venta referenciada no tiene
 * `config_calculo` congelada — ver `MonedasService.decimalesDeLaVenta`. Ya
 * no es el caso general de toda NC: desde la Fase 5 de este plan,
 * `crearNotaCredito` congela `config_calculo` en la NC que crea, heredado de
 * la venta que corrige, y el camino manual (`validarVentaElegible: true`,
 * una PERSONA pidiéndola) falla ruidoso si esa venta no lo tiene (decisión
 * P5). Acá sigue siendo alcanzable porque este handler es el OTRO llamador
 * de `crearNotaCredito` —el webhook de la pasarela, sin ese flag— y
 * `evento.ventaId` es la venta ORIGINAL que se reembolsa: si esa venta
 * particular no tiene `config_calculo` congelada (dato roto aguas arriba,
 * no un caso esperado), este fallback es lo que evita perder el evento.
 * Deliberadamente el mismo default que ya usa `modoToRounding` para un modo
 * desconocido (HALF_UP), y NO un fallo ruidoso: la decisión P5 es del
 * camino manual, y acá gobierna la P3 — un hecho ya consumado no se puede
 * perder por un dato de configuración ausente; fallar acá sería el mismo
 * error que P3 prohíbe, solo que por otra puerta.
 */
const MODO_REDONDEO_FALLBACK: ModoRedondeo = 'HALF_UP';

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
   * tipeando un monto). Se cuantiza a la escala Y al modo de redondeo
   * CONGELADOS en la venta original (no los vigentes del tenant, que pueden
   * haber cambiado desde entonces): el reembolso corrige *ese* documento —
   * crea una nota de crédito sobre él— y tiene que heredar su criterio, no el
   * de hoy (mismo principio que la NC hereda al arreglar su propia línea, en
   * la Fase 5 de este plan). Si el valor cambió, queda una traza con el
   * número exacto que informó la pasarela para poder reconstruirlo después.
   * Si ya venía bien no se loguea nada, para no llenar el log de ruido.
   */
  private async cuantizarMontoReembolso(
    evento: ReembolsoAprobadoEvento,
  ): Promise<string> {
    const { decimales, modoRedondeo } = await this.monedas.decimalesDeLaVenta(
      evento.ventaId,
      evento.tenantId,
    );
    const montoExacto = new Decimal(evento.monto);
    const montoCuantizado = montoExacto.toDecimalPlaces(
      decimales,
      modoToRounding(modoRedondeo ?? MODO_REDONDEO_FALLBACK),
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
