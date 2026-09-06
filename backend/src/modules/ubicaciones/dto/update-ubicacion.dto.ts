import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

// `tipo` no está acá a propósito: no se re-tipea una ubicación existente
// (una bodega que "se convierte" en local rompería la unicidad del local).
export class UpdateUbicacionDto {
  // Gemelo de `UpdateCausaMermaDto`/`UpdateMotivoDiferenciaInventarioDto`:
  // `@ValidateIf` en vez de `@IsOptional()` porque para `class-validator`
  // `IsOptional` trata `null` igual que ausente. `trim` antes de validar:
  // `'   '` tiene que fallar igual que `''`.
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
