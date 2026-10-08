import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';

export class FusionarCuentasDto {
  @IsArray()
  // Cuentas abiertas de una mesa; cada origen cuesta dos queries más una o dos
  // por línea movida, y el lock de todas dura la transacción entera.
  @ArrayMaxSize(50)
  @ArrayMinSize(2)
  @IsUUID('4', { each: true })
  // En minúsculas: `fusionarCuentas` deduplica con un `Set`, y `[X, x]` eran
  // dos ids que el lock encontraba como una sola cuenta (400 que decía que
  // alguna no era de la mesa, medido el 2026-10-08).
  @IdEnMinusculas()
  cuentaIds: string[];
}
