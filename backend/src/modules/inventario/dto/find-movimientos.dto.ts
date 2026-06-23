import { IsOptional, IsUUID, IsIn, IsDateString } from 'class-validator';

const MOTIVOS = [
  'compra',
  'venta',
  'devolucion',
  'merma',
  'ajuste_manual',
  'inventario_inicial',
];

export class FindMovimientosDto {
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
