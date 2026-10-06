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

export class LineaJustificacionDto {
  @ValidateIf((_o, v) => v !== null)
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
  @ValidateNested({ each: true })
  @Type(() => LineaJustificacionDto)
  lineas: LineaJustificacionDto[];
}
