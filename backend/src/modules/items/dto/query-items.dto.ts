import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const TIPOS_ITEM = [
  'producto',
  'servicio',
  'suscripcion',
  'receta',
  'ingrediente',
  'combo',
] as const;

export type TipoItem = (typeof TIPOS_ITEM)[number];

/**
 * `tipo=producto,receta` e `ids=<uuid>,<uuid>` (o un valor suelto, o la clave
 * repetida) llegan como lista sin repetidos. Ausente queda `undefined` (no
 * filtra). **Un elemento vacío no se descarta**: `tipo=`, `tipo=,` o `ids=` se
 * quedan como `''` para que el validador del campo los corte con un 400 —
 * ignorarlos haría que un filtro mal armado devolviera el catálogo entero,
 * justo lo que no se pidió. Lo que no es texto queda como centinela por lo
 * mismo.
 */
function parseLista({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null) return undefined;
  const source: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [value];
  return [
    ...new Set(
      source.map((t) => (typeof t === 'string' ? t.trim() : '__invalid__')),
    ),
  ];
}

export class QueryItemsDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(parseLista)
  @IsIn(TIPOS_ITEM, { each: true })
  tipo?: TipoItem[];

  /**
   * Ítems por id, para que un selector resuelva lo ya elegido sin depender de
   * la página que cargó el listado. Tope 100 = `MAX_PAGE_SIZE`: la respuesta no
   * puede traer más filas que eso.
   */
  @IsOptional()
  @Transform(parseLista)
  @IsUUID('4', { each: true })
  @ArrayMaxSize(100)
  ids?: string[];

  /**
   * Solo productos con ese modo de inventario (el selector de unidades de serie
   * pide `serie`). Excluye todo lo que no es producto: solo `item_producto`
   * tiene modo.
   */
  @IsOptional()
  @IsIn(['cantidad', 'lote', 'serie'])
  modoInventario?: 'cantidad' | 'lote' | 'serie';

  /**
   * `disponibilidad`: el orden de la grilla de venta (pedibles primero, después
   * nombre, después id), calculado en el servidor porque depende de la
   * disponibilidad de cada ítem y paginar con el orden en el cliente lo cambiaba
   * entre páginas. Sin el parámetro (o `nombre`), el de siempre.
   */
  @IsOptional()
  @IsIn(['nombre', 'disponibilidad'])
  orden?: 'nombre' | 'disponibilidad';

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

  /**
   * `true`: el catálogo que la tienda online puede vender, o sea sin los
   * productos con número de serie (no hay quien elija la unidad, y rechazar la
   * venta después de Webpay dejaría un cargo sin venta). `false` y ausente no
   * filtran. El nombre dice la regla, no el mecanismo: el día que otra cosa no
   * se venda online, el cliente no cambia.
   *
   * Misma coerción estricta que `activo`, y por la misma razón: con
   * `value === 'true'`, un `vendibleOnline=TRUE` caería a `false` y mostraría
   * justo lo que la tienda no puede vender. Lo que no es `true`/`false` llega
   * tal cual a `@IsBoolean()` y sale como 400.
   */
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsOptional()
  @IsBoolean()
  vendibleOnline?: boolean;

  /**
   * Filtra los ítems (`producto`/`ingrediente`) sin costo cargado. **Dos
   * estados, no tres** —a diferencia de `activo`—: no existe "solo los que sí
   * tienen costo", así que la coerción es la de `incluirEliminados`
   * (`value === 'true' || value === true`), no la de `activo`.
   */
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  sinCosto?: boolean;
}
