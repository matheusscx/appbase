import { IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class AbrirCajaDto {
  @IsUUID('4')
  cajonId: string;

  @IsNumberString()
  saldoInicial: string;

  @IsOptional()
  @IsString()
  comentario?: string;
}
