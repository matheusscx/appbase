import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { RestaurarDto } from '../../../common/dto/restaurar.dto';

// `@ValidateIf` y no `@IsOptional()`: las cuatro columnas son NOT NULL e
// `IsOptional` trata `null` igual que ausente y saltea el validador de abajo;
// el `null` llegaría a la columna como un 500 de Postgres en vez de un 400.
// Omitir un campo conserva el valor que tenía.
export class UpdateTurnoDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'horaInicio debe ser HH:mm',
  })
  horaInicio?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'horaFin debe ser HH:mm' })
  horaFin?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  activo?: boolean;
}

// `RestaurarDto` es común a todos los recursos con nombre único, y en los demás
// la columna es `text`. La de turnos es `varchar(100)`: sin el tope, restaurar
// con un nombre más largo daba 500 (2026-10-08). Hereda el `trim` y el
// `@IsOptional`, pero **no** `@IsString`/`@IsNotEmpty`: class-validator descarta
// los validadores heredados del mismo tipo en cuanto la subclase pone uno
// propio sobre el campo, así que van repetidos. Sin ellos, un nombre vacío
// restauraba en silencio con el nombre viejo.
export class RestaurarTurnoDto extends RestaurarDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  declare nombre?: string;
}
