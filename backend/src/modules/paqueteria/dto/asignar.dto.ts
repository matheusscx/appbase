import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';
import { EsFechaPura } from '../../../common/decorators/fecha-pura.decorator';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';

export class AsignarDto {
  @IsUUID()
  repartidorId: string;

  /** Columna `date`: `YYYY-MM-DD`, sin hora. */
  @EsFechaPura()
  fecha: string;

  @IsArray()
  @ArrayNotEmpty()
  // 200: por encima de una ruta de reparto real (un repartidor de Flex lleva del orden de 100
  // por día); el service bloquea las filas con un solo `= ANY($1)`, así que el costo es plano.
  @ArrayMaxSize(200)
  // En minúsculas antes del `@ArrayUnique`: `[x, X]` pasaba como dos ids y el INSERT de las
  // líneas chocaba con el índice único (500).
  @IdEnMinusculas()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  paqueteIds: string[];
}
