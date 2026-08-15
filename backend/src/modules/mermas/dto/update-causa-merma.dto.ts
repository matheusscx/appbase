import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * ⚠️ **Los tres decoradores de `nombre` están acá por un bug distinto cada uno.**
 * Sacar cualquiera reabre el suyo, y ninguno cubre al otro:
 *
 * 1. **`@IsNotEmpty()`** — sin él, un `''` pasaba y el service, que solo mira
 *    `if (dto.nombre !== undefined)`, persistía el `.trim()`: la fila quedaba
 *    sin nombre y salía como una opción en blanco en el selector de causa de
 *    `mermas.vue`. El DTO de creación hermano ya lo tenía.
 * 2. **`@Transform` que trimea ANTES de validar** — `@IsNotEmpty()` rechaza
 *    `''` exacto pero **no `'   '`**, y como el service hace su propio `.trim()`
 *    *después* de validar, un nombre de solo espacios reproducía el bug entero.
 *    El patrón es el de `RestaurarDto`, que ya lo resolvía en el repo. El primer
 *    intento de esta corrección puso solo el decorador y lo dio por cerrado; lo
 *    cazó la revisión independiente, no el gate.
 * 3. **`@ValidateIf(v !== undefined)` en vez de `@IsOptional()`** — para
 *    `class-validator`, `IsOptional` trata `null` **igual que ausente** y se
 *    saltea TODOS los validadores. Con eso, un `{"nombre": null}` pasaba y el
 *    service entraba a hacer `.trim()` sobre `null`: `TypeError` y 500 crudo.
 *    Con `ValidateIf`, ausente sigue siendo opcional pero `null` llega a
 *    `@IsString()` y sale un 400 limpio.
 *
 * `activo` lleva el mismo `@ValidateIf` por el mismo motivo: la columna es
 * `NOT NULL`, así que un `null` terminaba en un 500 de Postgres en vez de un 400.
 *
 * Los tres se replican en `UpdateMotivoDiferenciaDto` y
 * `UpdateMotivoDiferenciaInventarioDto`, que sirven **rutas distintas**.
 */
export class UpdateCausaMermaDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombre?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  activo?: boolean;
}
