import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';
import { EsCosto } from '../../../common/decorators/escala-moneda.decorator';
import { MAX_INT } from '../../../common/constants/escalas';

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

  // Columna `int` de `grupo_modificador_opcion`.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_INT)
  orden?: number;
}

export class CreateGrupoModificadorDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsArray()
  // Opciones de un grupo (una carta de salsas, de bebidas); un INSERT por
  // opción.
  @ArrayMaxSize(100)
  @ArrayMinSize(1)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => GrupoOpcionInputDto)
  opciones: GrupoOpcionInputDto[];
}
