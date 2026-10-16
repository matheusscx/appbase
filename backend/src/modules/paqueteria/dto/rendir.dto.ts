import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';

export class RendirDto {
  @IdEnMinusculas()
  @IsUUID()
  repartidorId: string;

  @IsArray()
  @ArrayNotEmpty()
  // Por encima de un mes de hojas de un repartidor; el service las bloquea con un solo `= ANY($1)`.
  @ArrayMaxSize(62)
  // En minúsculas antes del `@ArrayUnique`: `[x, X]` pasaba como dos ids distintos.
  @IdEnMinusculas()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  hojaIds: string[];
}
