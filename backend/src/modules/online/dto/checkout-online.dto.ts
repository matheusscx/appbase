import { OmitType } from '@nestjs/swagger';
import { CalcularVentaDto } from '../../calculo-precios/dto/calcular.dto';

/**
 * El carrito de la tienda: el de `/calcular` sin nada que elija reglas.
 *
 * El comprador no elige descuentos, recargos ni el método que prende las reglas
 * por método. `prepararLineasCheckout` esparce el body en el cálculo cuyo total
 * se autoriza contra la tarjeta, y el callback crea la venta sin esos campos:
 * cobrado y persistido no cerraban, y autorizar de menos terminaba en un cargo
 * en Webpay sin venta. Fuera del DTO, el pipe global los rechaza con 400
 * (Sesión de esfuerzo máximo, 2026-10-06).
 *
 * En la caja los tres siguen: `descuentosVentaIds`/`recargosVentaIds` son la
 * única puerta de las reglas de nivel venta, que esperan su pantalla.
 */
export class CheckoutOnlineDto extends OmitType(CalcularVentaDto, [
  'descuentosVentaIds',
  'recargosVentaIds',
  'metodoPagoId',
] as const) {}
