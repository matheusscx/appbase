import { IsOptional, IsUUID, IsIn, IsDateString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const MOTIVOS = [
  'compra',
  'venta',
  'devolucion',
  'merma',
  'ajuste_manual',
  'inventario_inicial',
];

export class FindMovimientosDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsIn(MOTIVOS)
  motivo?: string;

  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;
}
