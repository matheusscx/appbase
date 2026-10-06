import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';

// `@ValidateIf` y no `@IsOptional()` en `incluido` y `monto`: sus columnas son
// NOT NULL e `IsOptional` trata `null` igual que ausente y saltea el validador
// de abajo; el `null` llegaba al service como un 500 en vez de un 400. Omitir un
// campo conserva el valor que tenía. `motivoAjuste`, `pesoManual` y
// `ajusteMotivoMonto` conservan `@IsOptional()`: son nullables y `null` los borra.
// `id`, `garzonId` y `grupoId` también: el service decide con ellos qué cambio es.
export class UpdateLiquidacionParticipanteDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsUUID()
  garzonId?: string;

  @IsOptional()
  @IsUUID()
  grupoId?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  incluido?: boolean;

  @IsOptional()
  @IsString()
  motivoAjuste?: string;

  @IsOptional()
  @IsNumberString()
  pesoManual?: string;

  // Mismo motivo que en `ajustes-reparto.dto.ts`: sin esto el negativo llegaba
  // al CHECK de BD y salía como 500 en vez de 400.
  // `@EsMontoCobrado()`, igual que su gemelo de `ajustes-reparto.dto.ts`: es el
  // monto que el garzón cobra. `pesoManual` de arriba NO se marca: es un peso
  // de reparto, no plata.
  @ValidateIf((_o, v) => v !== undefined)
  @IsDecimalNoNegativo()
  @EsMontoCobrado()
  monto?: string;

  @IsOptional()
  @IsString()
  ajusteMotivoMonto?: string;
}

// Mismo idioma que el participante: con `@IsOptional()` un `participantes`
// null se ignoraba y un `recalcular` null recalculaba, los dos con un 200.
// Omitirlos sigue siendo "sin cambios" y "recalcular".
export class UpdateLiquidacionDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  // Los participantes de una liquidación: los garzones del tenant. Una o dos
  // queries por elemento.
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => UpdateLiquidacionParticipanteDto)
  participantes?: UpdateLiquidacionParticipanteDto[];

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  recalcular?: boolean;
}
