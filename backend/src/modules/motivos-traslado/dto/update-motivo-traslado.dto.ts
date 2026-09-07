import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateMotivoTrasladoDto {
  // Gemelo de `UpdateCausaMermaDto`/`UpdateMotivoDiferenciaInventarioDto`:
  // mismo hueco, mismo arreglo. Sin `@IsNotEmpty()`, un `''` dejaba el motivo
  // sin nombre y aparecería en blanco en cualquier selector que lo liste.
  // `trim` antes de validar: `'   '` tiene que fallar igual que `''`. Ver el
  // comentario largo en `UpdateCausaMermaDto`.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  // `@ValidateIf((_o, v) => v !== undefined)` en vez de `@IsOptional()`: para
  // `class-validator`, `IsOptional` trata `null` **igual que ausente** y se
  // saltea TODOS los validadores. Con eso, un `{"nombre": null}` pasaba la
  // validación y el service —que pregunta `!== undefined`— entraba a hacer
  // `.trim()` sobre `null`: TypeError y 500 crudo. Con `ValidateIf`, ausente
  // sigue siendo opcional, pero `null` llega a `@IsString()` y sale 400.
  // Las dos columnas son NOT NULL, así que `activo: null` tenía el mismo
  // final por el lado de Postgres.
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombre?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  activo?: boolean;
}
