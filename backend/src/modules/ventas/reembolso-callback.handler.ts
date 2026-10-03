import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { EntityManager } from 'typeorm';
import {
  MODO_REDONDEO_DEFAULT,
  modoToRounding,
} from '../calculo-precios/calculo-precios.engine';
import {
  ReembolsoAprobadoEvento,
  ReembolsoCallbackHandler,
  ReembolsoCallbackRegistry,
} from '../pasarela/services/reembolso-callback.registry';
import { VentasService } from './ventas.service';
import { MonedasService } from '../monedas/monedas.service';

/**
 * Callback in-process de reembolsos: cuando la pasarela aprueba un reembolso
 * sobre una orden con venta vinculada, materializa el lado de ventas — SIEMPRE
 * una corrección (nota de crédito), con las devoluciones de stock elegidas
 * dentro. Ya no hay un camino que solo mueva stock sin dejar documento.
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

  async exigirTopeDelReembolso(
    manager: EntityManager,
    params: { tenantId: string; ventaId: string; monto: string },
  ): Promise<void> {
    await this.ventasService.exigirTopeDelReembolsoPasarela(manager, params);
  }

  async onReembolsoAprobado(
    evento: ReembolsoAprobadoEvento,
  ): Promise<{ correccionVentaId: string }> {
    const nc = await this.ventasService.crearNotaCredito({
      tenantId: evento.tenantId,
      usuarioId: evento.usuarioId,
      ventaOriginalId: evento.ventaId,
      monto: await this.cuantizarMontoReembolso(evento),
      devoluciones: evento.devoluciones,
      comentario: `NC por reembolso orden ${evento.codigoOrden}`,
      // La plata ya volvió por el proveedor: no mueve caja. Corrige el único
      // documento válido de la venta, si lo hay (nunca rechaza el evento).
      via: await this.ventasService.viaDeReembolsoPasarela(
        evento.tenantId,
        evento.ventaId,
        evento.ordenId,
      ),
      // El REFUND se liga antes del commit de la nota: si no se puede, la nota
      // tampoco queda.
      enLaTransaccion: evento.ligarCorreccion,
    });
    return { correccionVentaId: nc.id };
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
    // `modoRedondeo` viene `null` cuando la venta referenciada no tiene
    // `config_calculo` congelada — ver `MonedasService.decimalesDeLaVenta`. Ya no
    // es el caso general de toda NC: `crearNotaCredito` congela la config heredada
    // en la NC que crea, y el camino manual (`validarVentaElegible: true`, una
    // PERSONA pidiéndola) falla ruidoso si esa venta no la tiene (decisión P5).
    // Acá sigue siendo alcanzable porque este handler es el OTRO llamador —el
    // webhook de la pasarela, sin ese flag— y `evento.ventaId` es la venta
    // ORIGINAL que se reembolsa: si esa venta no la tiene (dato roto aguas arriba,
    // no un caso esperado), este fallback es lo que evita perder el evento.
    //
    // Es el default del motor y no una constante local: acá había una con el
    // mismo valor que el fallback interno de `modoToRounding`, y nada obligaba a
    // moverlas juntas. Fallar ruidoso no es opción — la P5 es del camino manual y
    // acá gobierna la P3: un hecho consumado no se pierde por un dato ausente.
    const montoCuantizado = montoExacto.toDecimalPlaces(
      decimales,
      modoToRounding(modoRedondeo ?? MODO_REDONDEO_DEFAULT),
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
