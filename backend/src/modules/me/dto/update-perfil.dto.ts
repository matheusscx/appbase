import { IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdatePerfilDto {
  /**
   * Mismo trío de decoradores que los DTOs de catálogo (ver
   * `UpdateCausaMermaDto`, que tiene el porqué largo). `usuarios.nombre` es
   * `NOT NULL`, así que `''`, `'   '` y `null` terminaban los tres en un
   * usuario sin nombre o en un 500 de Postgres.
   *
   * Sin `@MaxLength`: la columna es `varchar` sin largo y su DTO hermano
   * (`RegisterDto`) tampoco lo pone. No se agrega un límite que el resto del
   * sistema no tiene.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  nombre?: string;

  // `apellido` y `telefono` NO llevan el mismo trato: sus columnas son
  // nullables, así que mandar `null` es la forma legítima de **borrar** el
  // dato. Vaciarlos no deja al usuario en un estado inválido.
  @IsOptional()
  @IsString()
  apellido?: string;

  @IsOptional()
  @IsString()
  telefono?: string;
}
