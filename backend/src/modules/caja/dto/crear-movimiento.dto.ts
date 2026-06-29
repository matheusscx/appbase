import {
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';

export class CrearMovimientoDto {
  @IsIn(['entrada', 'salida'])
  tipo: string;

  @IsNotEmpty()
  @IsString()
  concepto: string;

  @IsNumberString({ no_symbols: true })
  monto: string;

  @IsOptional()
  @IsString()
  referencia?: string;
}
