import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import type { CalcularVentaDto } from '../calculo-precios/dto/calcular.dto';
import type { ResultadoVenta } from '../calculo-precios/calculo-precios.engine';

export interface CheckoutResponse {
  resultado: ResultadoVenta;
  checkoutRef: string;
  checkoutUrl: string;
}

/**
 * Checkout de la tienda online: solo calcula (motor de precios, sin
 * persistencia) y devuelve una URL dummy de pasarela. La venta real se
 * crea recién cuando el usuario aprueba en la pasarela (ver VentasService,
 * canal 'online'), evitando ventas huérfanas por intentos abandonados.
 */
@Injectable()
export class OnlineService {
  constructor(private readonly calculoPreciosService: CalculoPreciosService) {}

  async checkout(
    tenantId: string,
    dto: CalcularVentaDto,
  ): Promise<CheckoutResponse> {
    const resultado = await this.calculoPreciosService.calcular(tenantId, dto);
    const checkoutRef = randomUUID();

    return {
      resultado,
      checkoutRef,
      checkoutUrl: `/tienda/pasarela?ref=${checkoutRef}`,
    };
  }
}
