import { IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';

export class CrearMovimientoDto {
  @IsIn(['entrada', 'salida'])
  tipo: string;

  @IsString()
  concepto: string;

  @IsNumberString()
  monto: string;

  @IsOptional()
  @IsString()
  referencia?: string;
}
