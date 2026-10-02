import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

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
