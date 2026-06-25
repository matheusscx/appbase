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

  @IsNumberString()
  montoTolerancia: string;
}
