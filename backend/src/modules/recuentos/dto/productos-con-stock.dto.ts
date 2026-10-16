import { IsUUID } from 'class-validator';

export class ProductosConStockDto {
  @IsUUID()
  ubicacionId: string;
}
