import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateCausaMermaDto {
  // `@IsNotEmpty()` junto a `@IsOptional()` no se contradicen: opcional deja
  // omitir el campo, no mandarlo vacío. Sin esto, un `''` pasaba la validación
  // y el service —que solo mira `if (dto.nombre !== undefined)`— persistía el
  // `.trim()`, dejando la fila sin nombre y una opción sin etiqueta en el
  // selector de causa de `mermas.vue`. El DTO de creación hermano ya lo tenía.
  //
  // ⚠️ Y `@IsNotEmpty()` **solo** no alcanza: rechaza `''` exacto, no `'   '`.
  // Como el service hace su `.trim()` DESPUÉS de validar, un nombre de solo
  // espacios reproducía el mismo bug. Por eso el `@Transform` que trimea ANTES,
  // copiado de `RestaurarDto`, que ya resolvía esto en el repo. El primer
  // intento de esta corrección puso solo el decorador y lo dio por cerrado; lo
  // cazó la revisión independiente.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @MaxLength(120)
  nombre?: string;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;
}
