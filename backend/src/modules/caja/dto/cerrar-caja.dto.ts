import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { LineaCierreDto } from './linea-cierre.dto';

export class CerrarCajaDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineaCierreDto)
  lineas: LineaCierreDto[];

  @IsOptional()
  @IsString()
  comentario?: string;
}
