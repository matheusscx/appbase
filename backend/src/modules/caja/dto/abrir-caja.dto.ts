import { IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';

export class AbrirCajaDto {
  @IsUUID('4')
  cajonId: string;

  // El cajón puede abrirse vacío: 0 es un saldo inicial legítimo.
  @IsNumberString()
  @IsDecimalNoNegativo()
  saldoInicial: string;

  @IsOptional()
  @IsString()
  comentario?: string;
}
