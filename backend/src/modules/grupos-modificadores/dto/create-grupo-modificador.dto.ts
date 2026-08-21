import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';
import { EsCosto } from '../../../common/decorators/escala-moneda.decorator';

export class GrupoOpcionInputDto {
  @IsUUID()
  itemId: string;

  @IsOptional()
  @IsNumberString()
  cantidad?: string;

  // Solo opciones de familia ingrediente; el backend lo verifica.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unidadCodigo?: string;

  // Dinero: se suma al precio de la línea al elegir la opción. `>= 0` — una opción
  // sin recargo es el caso más común. `UpdateGrupoModificadorDto` reusa este DTO.
  // `@EsCosto()` (escala 4): gemelo exacto de
  // `ItemGrupoOpcionOverrideInputDto.precioExtra` —misma semántica, misma
  // columna NUMERIC(18,4)—, y como aquél es precio **por unidad** de la opción.
  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsCosto()
  precioExtra: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  orden?: number;
}

export class CreateGrupoModificadorDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GrupoOpcionInputDto)
  opciones: GrupoOpcionInputDto[];
}
