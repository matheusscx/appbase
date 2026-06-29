import { IsNumberString, IsOptional, IsString } from 'class-validator';

export class AbrirCajaDto {
  @IsNumberString()
  saldoInicial: string;

  @IsOptional()
  @IsString()
  comentario?: string;
}
