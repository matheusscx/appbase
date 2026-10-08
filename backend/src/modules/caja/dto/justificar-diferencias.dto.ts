import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';
import { UnaLineaPorMedio } from './linea-cierre.dto';

export class LineaJustificacionDto {
  // Mismo cruce que `LineaCierreDto.metodoPagoId`, contra las filas congeladas:
  // en mayúsculas daba 400 "Falta el motivo de la diferencia" (medido el
  // 2026-10-08).
  @ValidateIf((_o, v) => v !== null)
  @IdEnMinusculas()
  @IsUUID('4')
  metodoPagoId: string | null;

  @IsOptional()
  @IsUUID('4')
  motivoDiferenciaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comentarioDiferencia?: string;
}

export class JustificarDiferenciasDto {
  @IsArray()
  // Una línea por medio de pago del arqueo, igual que el conteo.
  @ArrayMaxSize(50)
  @UnaLineaPorMedio()
  @ValidateNested({ each: true })
  @Type(() => LineaJustificacionDto)
  lineas: LineaJustificacionDto[];
}
