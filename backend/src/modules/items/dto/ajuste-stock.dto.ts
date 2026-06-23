import { IsIn, IsNumber, Min, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

const MOTIVOS = [
  'compra',
  'devolucion',
  'merma',
  'ajuste_manual',
  'inventario_inicial',
];

export class AjusteStockDto {
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  cantidad: number;

  @IsIn(['entrada', 'salida'])
  tipo: 'entrada' | 'salida';

  @IsIn(MOTIVOS)
  motivo: string;

  @IsOptional()
  @IsString()
  comentario?: string;
}
