import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LineaCierreDto } from './linea-cierre.dto';

export class CerrarCajaDto {
  @IsArray()
  // Una línea por medio de pago del arqueo (efectivo + los que tuvieron
  // movimiento): son pocos, y el service rechaza los que no están en él.
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LineaCierreDto)
  lineas: LineaCierreDto[];

  @IsOptional()
  @IsString()
  comentario?: string;
}
