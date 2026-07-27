import { IsNumberString, IsOptional } from 'class-validator';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';

/**
 * Propina cargada desde el POS (venta directa). No lleva garzón: el service la
 * atribuye al placeholder "Mostrador" del tenant con atribución neutra. Ver
 * docs/features/pagos.md.
 */
export class PropinaDirectaDto {
  // 0 es un estado real ("sin propina", ver venta-propina.service.ts
  // EstadoVentaPropina.SIN_PROPINA — comparte service con propinaCierreMesa),
  // nunca negativo. El POS (pos.vue) hoy solo envía este bloque si el monto es
  // > 0, pero la validación no debe ser más estricta que la semántica real.
  @IsNumberString()
  @IsDecimalNoNegativo()
  montoPagado: string;

  @IsOptional()
  @IsNumberString()
  @IsDecimalNoNegativo()
  montoSugerido?: string;

  @IsOptional()
  @IsNumberString()
  @IsDecimalNoNegativo()
  porcentajeSugerido?: string;
}
