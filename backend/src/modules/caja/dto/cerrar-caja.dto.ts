import { IsNumberString, IsOptional, IsString } from 'class-validator';

export class CerrarCajaDto {
  @IsNumberString({ no_symbols: true })
  montoContado: string;

  @IsOptional()
  @IsString()
  comentario?: string;
}
