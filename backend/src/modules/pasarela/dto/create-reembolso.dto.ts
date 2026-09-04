import {
  IsArray,
  IsBoolean,
  IsNumberString,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DevolucionLineaDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;

  /**
   * ¿Vuelve al stock? Ausente = repone si el ítem puede. Va también acá —y no
   * solo en el DTO de la nota de crédito manual— porque el pipe global usa
   * `whitelist: true`: sin declararlo, el campo se descarta antes de llegar al
   * service y la política del webhook queda inalcanzable.
   */
  @IsOptional()
  @IsBoolean()
  reponerStock?: boolean;
}

export class CreateReembolsoDto {
  /**
   * Sin `@EsMontoCobrado()` a propósito: esa marca valida contra la moneda
   * OFICIAL DEL TENANT, y una orden de pasarela va en la moneda de la pasarela
   * (`MONEDA_ORDEN_V1`, hoy CLP). Un tenant con oficial USD aceptaría dos
   * decimales en una orden CLP. La escala la valida el service contra la moneda
   * de la orden — ver `MonedasService.validarEscalaDeMoneda`.
   */
  @IsNumberString()
  monto: string;

  /** Genera una nota de crédito interna sobre la venta vinculada a la orden. */
  @IsOptional()
  @IsBoolean()
  generarNotaCredito?: boolean;

  /**
   * Ítems que se acreditan en la nota, con su reposición como propiedad de cada
   * línea; independiente de la NC. Hasta el 2026-09-04 solo admitía
   * `modo_inventario = 'cantidad'`.
   *
   * ⚠️ Sin `generarNotaCredito`, estas líneas van por el camino que SOLO mueve
   * stock: ahí una línea que no repone se rechaza, porque no habría documento
   * que la acredite.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DevolucionLineaDto)
  devoluciones?: DevolucionLineaDto[];
}
