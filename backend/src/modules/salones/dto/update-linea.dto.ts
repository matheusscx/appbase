import {
  ArrayMaxSize,
  IsArray,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

/**
 * Se manda `cantidad` **o** `unidadIds`, según el producto: el service exige
 * `cantidad` en una línea sin serie y `unidadIds` (el conjunto nuevo) en una
 * línea con serie, donde la cantidad se deriva. Los dos son opcionales acá
 * porque el DTO no sabe de qué producto es la línea.
 */
export class UpdateLineaDto {
  @IsOptional()
  @IsNumberString()
  cantidad?: string;

  @IsOptional()
  @IsNumberString()
  cantidadPresentacion?: string;

  @IsOptional()
  @IsString()
  unidadCodigoPresentacion?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  unidadIds?: string[];
}
