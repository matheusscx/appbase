import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class FusionarCuentasDto {
  @IsArray()
  // Cuentas abiertas de una mesa; cada origen cuesta dos queries más una o dos
  // por línea movida, y el lock de todas dura la transacción entera.
  @ArrayMaxSize(50)
  @ArrayMinSize(2)
  @IsUUID('4', { each: true })
  cuentaIds: string[];
}
