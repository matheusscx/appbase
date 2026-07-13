import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class FusionarCuentasDto {
  @IsArray()
  @ArrayMinSize(2)
  @IsUUID('4', { each: true })
  cuentaIds: string[];
}
