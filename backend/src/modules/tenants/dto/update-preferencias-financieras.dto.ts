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
  modoRedondeo: string;

  /**
   * 'linea' cuantiza cada línea y el total es suma de enteros; 'documento' deja
   * las líneas a `escalaCalculo` y cuantiza solo el total (regla mexicana). El
   * service rechaza 'documento' cuando la moneda oficial del tenant tiene 0
   * decimales — ver `TenantsService.updatePreferenciasFinancieras`.
   */
  @IsIn(['linea', 'documento'])
  nivelRedondeo: string;

  @IsNumberString()
  montoTolerancia: string;
}
