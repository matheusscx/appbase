import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateRecuentoDto {
  // Requerido, no opcional-con-default: el recuento por ubicación del frente de
  // bodegas y traslados levanta el tapón que lo fijaba al local (ver el
  // docblock de `RecuentosService.create`). Un default silencioso volvería a
  // meter el tapón por la puerta de atrás.
  @IsUUID()
  ubicacionId: string;

  @IsArray()
  // Un recuento puede abarcar todos los productos del local. 2.000 cabe en un
  // solo INSERT (4 parámetros por fila, lejos del máximo de Postgres) y en el
  // body de 100 kB, que corta en ~2.500 ids.
  @ArrayMaxSize(2000)
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  itemIds: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comentario?: string;
}
