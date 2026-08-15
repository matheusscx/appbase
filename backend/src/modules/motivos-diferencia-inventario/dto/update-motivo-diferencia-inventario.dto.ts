import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateMotivoDiferenciaInventarioDto {
  // Gemelo de `UpdateCausaMermaDto`: mismo hueco, mismo arreglo. Sin
  // `@IsNotEmpty()`, un `''` dejaba el motivo sin nombre y aparecía como una
  // opción en blanco en el override de línea de `recuentos/[id].vue`.
  // `trim` antes de validar: `'   '` tiene que fallar igual que `''`. Ver el
  // comentario largo en `UpdateCausaMermaDto`.
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
