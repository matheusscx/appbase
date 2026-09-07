import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateRecuentoDto {
  // Requerido, no opcional-con-default: la Tarea 11 del frente "bodegas y
  // traslados" levanta el tapón que fijaba el recuento al local (ver el
  // docblock de `RecuentosService.create`). Un default silencioso volvería a
  // meter el tapón por la puerta de atrás.
  @IsUUID()
  ubicacionId: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  itemIds: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comentario?: string;
}
