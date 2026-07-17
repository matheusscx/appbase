import { BadRequestException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';
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
  sesionGarzonId: string | null;
  turnoId: string | null;
  tipoGarzon: TipoGarzon | null;
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

    if (
      (input.sesionGarzonId == null) !== (input.turnoId == null) ||
      (input.sesionGarzonId == null) !== (input.tipoGarzon == null)
    ) {
      throw new BadRequestException(
        'Sesión, turno y tipo de propina deben ir juntos o ser todos null',
      );
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
      sesionGarzonId: input.sesionGarzonId,
      turnoId: input.turnoId,
      tipoGarzon: input.tipoGarzon,
      liquidacionId: null,
    });
    return manager.save(VentaPropina, entity);
  }
}
