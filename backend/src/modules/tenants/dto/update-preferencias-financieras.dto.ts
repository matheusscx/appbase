import { IsArray, IsIn, ArrayMinSize, ArrayMaxSize } from 'class-validator';

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
}
