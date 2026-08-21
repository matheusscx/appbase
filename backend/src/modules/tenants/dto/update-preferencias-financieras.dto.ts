import {
  IsArray,
  IsIn,
  ArrayMinSize,
  ArrayMaxSize,
  IsInt,
  Min,
  Max,
  IsNumberString,
} from 'class-validator';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';
import type {
  ModoRedondeo,
  NivelRedondeo,
} from '../../calculo-precios/calculo-precios.engine';

export class UpdatePreferenciasFinancierasDto {
  @IsIn(['base', 'compuesto'])
  calculoDescuentos: string;

  @IsIn(['base', 'compuesto'])
  calculoRecargos: string;

  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @IsIn(['descuentos', 'recargos', 'impuestos'], { each: true })
  formula: string[];

  @IsInt()
  @Min(0)
  @Max(12)
  escalaCalculo: number;

  @IsIn(['HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEIL'])
  modoRedondeo: ModoRedondeo;

  /**
   * 'linea' cuantiza cada línea y el total es suma de enteros; 'documento' deja
   * las líneas a `escalaCalculo` y cuantiza solo el total (regla mexicana). El
   * service rechaza 'documento' cuando la moneda oficial del tenant tiene 0
   * decimales — ver `TenantsService.updatePreferenciasFinancieras`.
   */
  @IsIn(['linea', 'documento'])
  nivelRedondeo: NivelRedondeo;

  /**
   * Tolerancia de descuadre del arqueo. Nunca negativa: una tolerancia negativa
   * no significa nada (el `0` sí, y es el default: cero tolerancia).
   */
  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsMontoCobrado()
  montoTolerancia: string;
}
