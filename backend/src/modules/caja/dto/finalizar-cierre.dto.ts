import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LineaJustificacionDto } from './justificar-diferencias.dto';

export class FinalizarCierreDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineaJustificacionDto)
  lineas: LineaJustificacionDto[];

  // Opcional a nivel DTO: solo se exige en el service cuando el cierre es
  // forzado y nadie firmó como testigo (`CajaService.cerrar`) — al congelar
  // el conteo (fase 1) todavía no hay firmas para saber si hará falta.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comentario?: string;
}
