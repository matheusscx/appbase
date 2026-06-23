import { IsIn, IsNumberString } from 'class-validator';

export class AjusteStockDto {
  @IsNumberString()
  cantidad: string;

  @IsIn(['entrada', 'salida'])
  tipo: string;
}
