import { IsNumberString, Matches, ValidateIf } from 'class-validator';

/**
 * ⚠️ Sin `origen`: todo mínimo que entra por acá es `'manual'`, y un cliente
 * no puede declararlo `'sistema'` (el `whitelist` del pipe lo descarta).
 */
export class SetStockMinimoDto {
  /**
   * `null` limpia el mínimo (el par vuelve a "nunca se cargó", sin aviso).
   * Ausente es 400: en un PUT, omitirlo no significa "no tocar" (`ValidateIf`
   * solo saltea el `null`).
   *
   * El `@Matches` es el que acota de verdad —rechaza el ausente, el número no
   * string y el signo—; `@IsNumberString` queda por la convención de los campos
   * `numeric` (`docs/patterns/backend.md` § 3), y medido no agrega un rechazo
   * propio. Sin el `@Matches`, un quinto decimal Postgres lo redondea en
   * silencio (`numeric(18,4)`), más de 14 enteros es un 500 por overflow en vez
   * de un 400, y un negativo llega al CHECK de la tabla como 500.
   */
  @ValidateIf((o: SetStockMinimoDto) => o.minimo !== null)
  @IsNumberString()
  @Matches(/^\d{1,14}(\.\d{1,4})?$/, {
    message: 'minimo admite hasta 14 enteros y 4 decimales, sin signo',
  })
  minimo: string | null;
}
