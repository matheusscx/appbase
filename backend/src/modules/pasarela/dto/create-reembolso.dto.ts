import {
  ArrayMaxSize,
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
   * solo en el DTO de la nota de crédito manual— porque el pipe global rechaza
   * con 400 lo que el DTO no declara: sin declararlo, un reembolso que lo mande
   * no llega al service y la política del webhook queda inalcanzable.
   */
  @IsOptional()
  @IsBoolean()
  reponerStock?: boolean;
}

export class CreateReembolsoDto {
  /**
   * Sin `@EsMontoCobrado()` a propósito: esa marca valida contra la moneda
   * OFICIAL DEL TENANT, y una orden de pasarela va en la moneda de la pasarela
   * (`MONEDA_ORDEN_V1`, hoy CLP). Hoy coinciden —solo un local de Chile puede
   * configurar Transbank (`PASARELAS_EN_MONEDA_ORDEN`)—, pero la regla es de la
   * orden: la escala la valida el service contra la moneda de la orden — ver
   * `MonedasService.validarEscalaDeMoneda`.
   */
  @IsNumberString()
  monto: string;

  /**
   * Ítems que se acreditan en la corrección que todo reembolso deja sobre la
   * venta de la orden, con su reposición como propiedad de cada línea. Hasta
   * el 2026-09-04 solo admitía `modo_inventario = 'cantidad'`.
   *
   * ⚠️ No existe un campo que pida la corrección: la deja todo reembolso
   * aprobado de una orden con venta. Mandar `generarNotaCredito` da 400 (el pipe
   * global rechaza lo que el DTO no declara).
   */
  @IsOptional()
  @IsArray()
  // Mismo tope que las líneas de una compra: la corrección hace trabajo por
  // línea (validación y un movimiento de stock), y un array sin tope lo
  // multiplica, sobre todo por la ruta de la llave de API.
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DevolucionLineaDto)
  devoluciones?: DevolucionLineaDto[];
}
