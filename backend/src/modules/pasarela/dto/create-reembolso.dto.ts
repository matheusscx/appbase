import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumberString,
  IsOptional,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  DESTINOS_STOCK_DEVOLUCION,
  type DestinoStockDevolucion,
} from '../services/reembolso-callback.registry';

export class DevolucionLineaDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;

  /**
   * Lo que pasa con lo devuelto si hay stock de por medio (owner, 2026-08-23):
   * `recupera` vuelve al stock; `pierde` vuelve y sale como merma con la causa
   * fija "Devolución". **Obligatorio** en una línea que sacó inventario al
   * venderse —el producto suelto, la receta (sus ingredientes), el combo (sus
   * componentes)— y **prohibido** en la que no (un servicio): los dos son 400
   * con el nombre del ítem. Qué preguntar lo dice el detalle de la venta, por
   * línea (`devolucionStock`). `null` es 400 siempre (del DTO); ausente es 400
   * solo en la línea con stock. Contrato y porqué: `docs/features/reembolsos-nota-credito.md`.
   */
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(DESTINOS_STOCK_DEVOLUCION)
  stock?: DestinoStockDevolucion;
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
  // La corrección hace trabajo por línea (validación y movimientos de stock), y
  // un array sin tope lo multiplica, sobre todo por la ruta de la llave de API.
  // Una devolución por ítem distinto de la venta, y una venta tiene a lo sumo
  // 500 líneas (`CreateVentaDto.lineas`): con menos se corta una corrección
  // válida.
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DevolucionLineaDto)
  devoluciones?: DevolucionLineaDto[];
}
