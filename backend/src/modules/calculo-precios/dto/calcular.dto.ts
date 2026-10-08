import { Type } from 'class-transformer';
import type { ReglasCongeladas } from '../../../common/dto/reglas-congeladas.dto';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { PersonalizacionRecetaDto } from '../../../common/dto/personalizacion-receta.dto';
import { IsDecimalHasta } from '../../../common/decorators/decimal-signo.decorator';
import {
  MAX_LINEAS_POR_VENTA,
  MAX_UNIDADES_POR_VENTA,
} from '../../../common/utils/tope-unidades-venta.util';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';

export class LineaDto {
  @IsUUID('4')
  itemId: string;

  @IsNumberString()
  @IsDecimalHasta(MAX_UNIDADES_POR_VENTA)
  cantidad: string;

  @IsOptional()
  @IsNumberString()
  cantidadPresentacion?: string;

  @IsOptional()
  @IsString()
  unidadCodigoPresentacion?: string;

  /**
   * Qué se pidió en esta línea, no cuánto vale: los ids de lo que se saca y de
   * lo que se agrega. **El precio lo calcula el servidor** —`precioBase + Σ
   * extras`, convertido a moneda oficial una sola vez—, igual que en el cobro y
   * con los mismos resolvers de `ItemsService`.
   *
   * ⚠️ Hasta el 2026-08-30 acá había un `precioUnitario` que el cliente podía
   * fijar, y era el **único lugar del sistema donde un precio cruzaba la
   * frontera sin convertir**: `resolverLinea` lo usaba tal cual y la conversión
   * vivía en la rama del `else`. POS y salones lo alimentaban con
   * `precioBase + extras` en la moneda del ítem, así que una receta en USD se
   * previsualizaba en dólares mientras la venta —que siempre re-tasó por su
   * cuenta— se persistía en pesos. Se sacó entero; el canal interno que usa
   * `ventas.service` para no re-resolver lo que ya resolvió se llama
   * `precioUnitarioResuelto` y NO es parte de este DTO, así que el
   * `ValidationPipe` global rechaza con 400 cualquier body que lo traiga.
   */
  // `IsObject` además de `ValidateNested`: este deja pasar un array, que se
  // aceptaba con 201 y previsualizaba sin los extras (medido el 2026-10-08).
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PersonalizacionRecetaDto)
  personalizacion?: PersonalizacionRecetaDto;
}

export class CalcularVentaDto {
  @IsArray()
  // Mismo tope que `CreateVentaDto.lineas`: es el mismo carro, y la precuenta
  // del salón manda acá todas las líneas de la cuenta.
  @ArrayMaxSize(MAX_LINEAS_POR_VENTA)
  @ArrayMinSize(1)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => LineaDto)
  lineas: LineaDto[];

  /**
   * Habilita la evaluación de reglas por método de pago. En minúsculas: el
   * motor lo busca con `includes` entre los métodos de la regla, que vienen de
   * la base, y en mayúsculas cobraba sin el recargo (medido el 2026-10-08).
   */
  @IsOptional()
  @IdEnMinusculas()
  @IsUUID('4')
  metodoPagoId?: string;

  /** Descuentos aplicados a nivel venta (sobre el total agregado). */
  @IsOptional()
  @IsArray()
  // Mismo tope y misma razón que `CreateVentaDto.descuentosVentaIds`, y en
  // minúsculas por la misma razón.
  @ArrayMaxSize(50)
  @IdEnMinusculas()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  descuentosVentaIds?: string[];

  @IsOptional()
  @IsArray()
  // Mismo tope y misma razón que `CreateVentaDto.descuentosVentaIds`, y en
  // minúsculas por la misma razón.
  @ArrayMaxSize(50)
  @IdEnMinusculas()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  recargosVentaIds?: string[];

  /**
   * Cuenta de salón cuyo instante de apertura decide la vigencia de las reglas.
   *
   * Se manda el **id**, no la fecha: aceptar un instante del cliente sería la
   * forma de hacer que una promo vencida aplique. El servidor lee `abierta_el`.
   */
  @IsOptional()
  @IsUUID('4')
  cuentaId?: string;

  /**
   * Canal de la venta, para las promociones que rigen en uno solo. Default
   * `'fisico'`.
   *
   * ⚠️ **Este campo solo puede mentir en pantalla porque los dos caminos que
   * COBRAN lo pisan.** No es una propiedad del DTO: es una invariante que
   * sostienen `ventas.service.ts` —que pasa el canal real de la venta— y
   * `OnlineService.prepararLineasCheckout` —que fuerza `'online'`—. La versión
   * anterior de este comentario afirmaba lo mismo cuando solo el primero lo
   * hacía, y era falso: el checkout de la tienda reenviaba el `canal` del body
   * al cálculo que autoriza el monto contra la tarjeta, así que un navegador
   * mandando `'fisico'` colaba una promo de local en una compra online.
   *
   * O sea: si mañana aparece un tercer llamador que cobra, tiene que pisarlo
   * también, o este comentario vuelve a ser mentira. El campo existe para que
   * una previsualización pueda pedir la vista del otro canal, nada más — mismo
   * argumento que `cuentaId`: lo que decide plata lo pone el servidor.
   */
  @IsOptional()
  @IsIn(['fisico', 'online'])
  canal?: 'fisico' | 'online';
}

/**
 * La entrada real de `CalculoPreciosService.calcular()`, más ancha que el DTO
 * HTTP en un solo campo.
 *
 * `precioUnitarioResuelto` es el precio de la línea **ya convertido a moneda
 * oficial**, y solo lo pone `ventas.service`: cuando la venta llega acá ya
 * resolvió la personalización —la necesita para el snapshot y para el stock— y
 * ya convirtió con el mismo `modo_redondeo`. Sin este canal, `calcular` volvería
 * a resolverla y `POST /ventas` pagaría las consultas dos veces.
 *
 * ⛔ **No es un override y no puede llegar de afuera.** No está en `LineaDto`,
 * así que el `ValidationPipe` global rechaza con 400 cualquier body que lo
 * traiga, antes de que el controller lo vea. Esa es toda la garantía que
 * necesita **este** endpoint.
 *
 * El otro canal que existía —`LineaVentaDto.precioUnitario`, en `POST /ventas`—
 * salió en este mismo commit: ningún endpoint acepta ya un precio de línea.
 */
export type LineaCalculo = LineaDto & {
  precioUnitarioResuelto?: string;
  /**
   * Los descuentos y recargos **congelados en la línea de cuenta cuando se
   * pidió** (owner, 2026-08-30: *lo pedido se cobra como se pidió*). Cuando
   * vienen, el motor los usa tal cual y **no** mira las asociaciones vivas del
   * ítem: poner o sacar un descuento con la mesa sentada no le llega a lo que
   * ya se pidió.
   *
   * ⚠️ Igual que `precioUnitarioResuelto`, **no es parte de este DTO HTTP** y no
   * puede serlo: lleva los valores de las reglas, o sea plata, y un cliente que
   * pudiera mandarlas se auto-descontaría lo que quisiera. Solo lo pone
   * `cerrarCuenta`, leyendo lo que el servidor congeló.
   */
  reglasCongeladas?: ReglasCongeladas;
};

export type CalcularVentaInput = Omit<CalcularVentaDto, 'lineas'> & {
  lineas: LineaCalculo[];
};
