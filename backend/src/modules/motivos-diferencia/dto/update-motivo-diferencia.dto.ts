import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
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
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @MaxLength(120)
  nombre?: string;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;

  @IsBoolean()
  @IsOptional()
  requiereComentario?: boolean;
}
