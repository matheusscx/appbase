import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryItemsDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn([
    'producto',
    'servicio',
    'suscripcion',
    'receta',
    'ingrediente',
    'combo',
  ])
  tipo?:
    | 'producto'
    | 'servicio'
    | 'suscripcion'
    | 'receta'
    | 'ingrediente'
    | 'combo';

  @IsOptional()
  @IsUUID()
  categoriaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;

  // Mismo campo que `QueryIncluirEliminadosDto` (nombre y coerción del
  // booleano), duplicado en vez de `extends`: TS solo permite una herencia y
  // esta clase ya extiende `PaginationQueryDto` para la paginación. El
  // nombre del query param sigue siendo el contrato único de los 16 recursos
  // de la papelera.
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  incluirEliminados?: boolean;

  /**
   * Filtra por ítem pausado. **Tres estados, no dos**: ausente no filtra nada
   * (el listado de configuración muestra pausados y activos juntos, con su
   * badge), `true` deja solo los vendibles, `false` solo los pausados.
   *
   * Por eso la coerción no es la de `incluirEliminados`. **El ausente no es el
   * problema** —`@Transform` no corre sobre una clave que no vino, medido— sino
   * la basura: con `value === 'true'`, un `activo=TRUE` o `activo=1` cae a
   * `false`, o sea al catálogo **invertido**, en silencio. Acá lo que no es
   * `true`/`false` se deja pasar tal cual para que `@IsBoolean()` lo corte con
   * un 400. En `incluirEliminados` el mismo error es inofensivo (mostrar de
   * menos); acá muestra justo lo que no se pidió.
   */
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
