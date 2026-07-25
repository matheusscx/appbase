import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { LineaJustificacionDto } from './justificar-diferencias.dto';

export class FinalizarCierreDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineaJustificacionDto)
  lineas: LineaJustificacionDto[];
}
