import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateMotivoDiferenciaDto {
  // ⚠️ Este es el DTO que sirve la ruta `/motivos-diferencia`. Existe un módulo
  // gemelo `motivos-diferencia-inventario` con su propio DTO y su propia ruta:
  // los dos están vivos y los dos tenían el mismo hueco. Tocar uno solo deja el
  // otro abierto — pasó, y lo cazó el e2e.
  // `trim` antes de validar: `'   '` tiene que fallar igual que `''`. Ver el
  // comentario largo en `UpdateCausaMermaDto`.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  // `@ValidateIf(v !== undefined)` en vez de `@IsOptional()`: para
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

  // `requiere_comentario` también es NOT NULL: mismo motivo que arriba.
  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  requiereComentario?: boolean;
}
