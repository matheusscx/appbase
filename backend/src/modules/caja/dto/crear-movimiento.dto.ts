import {
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';

export class CrearMovimientoDto {
  @IsIn(['entrada', 'salida'])
  tipo: string;

  @IsNotEmpty()
  @IsString()
  concepto: string;

  // `tipo` (entrada/salida) ya codifica el signo: monto nunca es 0 ni
  // negativo. Una "salida" con monto negativo sumaría al esperado en vez de
  // restar.
  @IsNumberString()
  @IsDecimalPositivo()
  monto: string;

  @IsOptional()
  @IsString()
  referencia?: string;
}
