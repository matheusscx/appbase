import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class QueryUnidadesDto {
  @IsOptional()
  @IsString()
  estado?: string;

  /**
   * `true`: la lista del selector de la pantalla de venta (solo las
   * `disponible` del local y no apartadas por una cuenta abierta). `false` y
   * ausente: la lista de Inventario, sin filtrar.
   *
   * Coerción estricta, no `value === 'true'`: con ésa un `vendibles=TRUE`
   * caería a `false` y devolvería la lista entera sin avisar. Lo que no es
   * `true`/`false` llega tal cual a `@IsBoolean()` y sale como 400.
   */
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsOptional()
  @IsBoolean()
  vendibles?: boolean;
}
