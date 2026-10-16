import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { EsFechaPura } from '../../../common/decorators/fecha-pura.decorator';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';

export class QueryRendicionesDto {
  /** Columna `date`: `YYYY-MM-DD`; el rango es inclusivo y se compara con la fecha de las hojas. */
  @EsFechaPura()
  desde: string;

  @EsFechaPura()
  hasta: string;

  @IsOptional()
  @IdEnMinusculas()
  @IsUUID()
  repartidorId?: string;
}

/** Acepta `hojaIds=a,b,c` y `hojaIds=a&hojaIds=b`. */
const aLista = ({ value }: { value: unknown }): unknown => {
  const partes = (Array.isArray(value) ? value : [value]) as unknown[];
  return partes.flatMap((v) =>
    typeof v === 'string' ? v.split(',').filter((s) => s !== '') : [v],
  );
};

export class QueryPreviaRendicionDto {
  @IdEnMinusculas()
  @IsUUID()
  repartidorId: string;

  @Transform(aLista)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(62)
  @IdEnMinusculas()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  hojaIds: string[];
}
