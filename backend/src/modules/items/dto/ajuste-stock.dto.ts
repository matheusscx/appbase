import { IsIn, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AjusteStockDto {
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  cantidad: number;

  @IsIn(['entrada', 'salida'])
  tipo: string;
}
