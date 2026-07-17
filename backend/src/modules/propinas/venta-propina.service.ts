import { BadRequestException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import {
  EstadoVentaPropina,
  TipoVentaPropina,
  VentaPropina,
} from './entities/venta-propina.entity';

export interface CrearVentaPropinaInput {
  tenantId: string;
  ventaId: string;
  garzonId: string;
  porcentajeSugerido: string;
  montoSugerido: string;
  montoPagado: string;
}

@Injectable()
export class VentaPropinaService {
  async crearEnTransaccion(
    manager: EntityManager,
    input: CrearVentaPropinaInput,
  ): Promise<VentaPropina> {
    const montoPagado = new Decimal(input.montoPagado || '0');
    const montoSugerido = new Decimal(input.montoSugerido || '0');
    if (montoPagado.lt(0)) {
      throw new BadRequestException('Propina inválida');
    }

    const tipo = montoPagado.equals(montoSugerido)
      ? TipoVentaPropina.SUGERIDA
      : TipoVentaPropina.MANUAL;
    const estado = montoPagado.gt(0)
      ? EstadoVentaPropina.PAGADA
      : EstadoVentaPropina.SIN_PROPINA;

    const entity = manager.create(VentaPropina, {
      tenantId: input.tenantId,
      ventaId: input.ventaId,
      garzonId: input.garzonId,
      porcentajeSugerido: input.porcentajeSugerido,
      montoSugerido: montoSugerido.toFixed(4),
      montoPagado: montoPagado.toFixed(4),
      tipo,
      estado,
    });
    return manager.save(VentaPropina, entity);
  }
}
