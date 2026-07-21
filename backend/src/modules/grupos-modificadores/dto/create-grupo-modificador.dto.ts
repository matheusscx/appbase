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

  @IsNumberString()
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
