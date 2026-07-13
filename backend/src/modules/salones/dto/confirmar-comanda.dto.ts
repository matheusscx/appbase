import {
  IsArray,
  IsNumberString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class LineaEnviadaDto {
  @IsUUID()
  cuentaLineaId: string;

  // numeric viaja como string (ver Global Constraints)
  @IsNumberString()
  cantidadEnviada: string;
}

export class ConfirmarComandaDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineaEnviadaDto)
  lineas: LineaEnviadaDto[];
}
