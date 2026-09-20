import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';

/**
 * Filtros de `GET /reportes/varianza`, el listado paginado.
 *
 * ⚠️ **`desde`/`hasta` se declaran acá y no en una clase base compartida.**
 * TypeScript no tiene herencia múltiple y el `extends` ya lo ocupa la
 * paginación, que es la que trae `page`/`pageSize` con sus topes. Una base solo
 * para estos dos campos serviría al `/resumen` —que no pagina— pero no a este
 * DTO, así que mientras haya un solo reporte no tendría más consumidor que él:
 * se crea cuando exista el segundo, no antes. Si algún día un reporte necesita
 * las dos cosas a la vez, ahí se evalúa un mixin; para dos campos es más
 * maquinaria que la que ahorra.
 *
 * La convención que estos dos campos siguen —`@IsDateString()` para aceptar
 * fecha pura y timestamp, y `bordeHastaSql` inclusivo para el borde superior—
 * está en `docs/patterns/backend.md` § 10b y § 10c.
 *
 * ⚠️ **Todo id que entra del cliente se valida como UUID**
 * (`docs/patterns/backend.md` § 4): sin eso, un id basura llega al SQL y vuelve
 * como 500 en vez del 400 que corresponde.
 */
export class QueryVarianzaDto extends PaginationQueryDto {
  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;

  /** La pantalla lo manda con el local por defecto; vacío = todas las ubicaciones. */
  @IsOptional()
  @IsUUID()
  ubicacionId?: string;

  @IsOptional()
  @IsUUID()
  itemId?: string;

  /**
   * Esconde las filas cuyo "sin explicación" es cero **y también las que no se
   * pueden medir** — las de un solo recuento en el rango, cuyo número es `null`.
   *
   * ⛔ **Las dos cosas las decidió el owner (2026-09-20), no son un efecto
   * lateral.** Prefiere la lista corta que va derecho a lo que perdió plata. El
   * costo, que desde acá no se ve: un producto contado una sola vez, con el
   * filtro tildado, **no aparece en ninguna parte**. El porqué completo, con qué
   * otro número lo cubre y cuál no, está en `VarianzaService.findAll`, donde vive
   * la condición — acá repetirlo sería una segunda copia que puede derivar.
   *
   * El `@Transform` es necesario porque un query param llega **siempre como
   * string**: sin él, `@IsBoolean()` rechaza `?soloConVarianza=true` con un 400
   * y el filtro sería inusable desde la pantalla.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  soloConVarianza?: boolean;
}
