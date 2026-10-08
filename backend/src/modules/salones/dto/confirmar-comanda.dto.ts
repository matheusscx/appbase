import {
  ArrayMaxSize,
  IsArray,
  IsNumberString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MAX_LINEAS_POR_VENTA } from '../../../common/utils/tope-unidades-venta.util';

class LineaEnviadaDto {
  @IsUUID()
  cuentaLineaId: string;

  // numeric viaja como string (ver Global Constraints)
  @IsNumberString()
  cantidadEnviada: string;
}

export class ConfirmarComandaDto {
  @IsArray()
  // Líneas de una cuenta, mismo tope que `CreateVentaDto.lineas`; el service
  // hace un UPDATE por línea.
  @ArrayMaxSize(MAX_LINEAS_POR_VENTA)
  @ValidateNested({ each: true })
  @Type(() => LineaEnviadaDto)
  lineas: LineaEnviadaDto[];
}
