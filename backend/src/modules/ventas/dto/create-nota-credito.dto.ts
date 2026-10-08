import { Type } from 'class-transformer';
import {
  DESTINOS_STOCK_DEVOLUCION,
  type DestinoStockDevolucion,
} from '../../pasarela/services/reembolso-callback.registry';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsIn,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';

export class DevolucionNotaCreditoDto {
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

/** Exactamente uno de `pagoId` / `sinPlata`: ni los dos, ni ninguno. */
@ValidatorConstraint({ name: 'unaViaDeDevolucion', async: false })
class UnaViaDeDevolucion implements ValidatorConstraintInterface {
  validate(_valor: unknown, args: ValidationArguments): boolean {
    const o = args.object as DevolucionViaDto;
    return (o.pagoId !== undefined) !== (o.sinPlata !== undefined);
  }

  defaultMessage(): string {
    return 'devolucion debe traer exactamente una: pagoId o sinPlata';
  }
}

/**
 * Por dónde vuelve la plata (spec `2026-10-01-emision-por-venta`, § 3.6): el pago
 * de la venta que se devuelve, o "no vuelve plata". **El cliente nunca manda el
 * documento que corrige**: el servidor lo resuelve desde esto.
 *
 * Los dos campos son opcionales cada uno por su lado y el 400 de "exactamente
 * uno" lo da `UnaViaDeDevolucion`. `sinPlata: false` no es una respuesta
 * válida: la ausencia de plata se dice con `true`, no se infiere de un `false`.
 */
export class DevolucionViaDto {
  // Se valida si vino, o si no vino ninguno de los dos (para que ese caso falle).
  @ValidateIf(
    (o: DevolucionViaDto) => o.pagoId !== undefined || o.sinPlata === undefined,
  )
  @IsUUID()
  @Validate(UnaViaDeDevolucion)
  pagoId?: string;

  @ValidateIf((o: DevolucionViaDto) => o.sinPlata !== undefined)
  @Equals(true, { message: 'sinPlata solo puede ser true' })
  sinPlata?: true;
}

/**
 * Quién recibe la nota cuando la venta no tiene customer: lo que el SII exige en
 * la nota de crédito (Formato DTE v2.5, `RznSocRecep` y `RUTRecep`). El RUT se
 * valida según el país en `VentasService.crearNotaCreditoEnTransaccion`.
 */
export class ReceptorNotaCreditoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100, {
    message:
      'La razón social no puede pasar de 100 caracteres (límite del SII)',
  })
  nombre: string;

  @IsString()
  @MinLength(1)
  rut: string;
}

export class CreateNotaCreditoDto {
  // El service ya rechaza monto <= 0 (crearNotaCredito); se refuerza en el DTO.
  @IsNumberString()
  @IsDecimalPositivo()
  @EsMontoCobrado()
  monto: string;

  @IsOptional()
  @IsString()
  comentario?: string;

  /**
   * Por dónde vuelve la plata. Si es el pago en efectivo, la salida sale de la
   * caja física abierta del usuario, en la misma transacción que la nota.
   */
  // `IsObject` y no solo `ValidateNested`: sin él, un body sin `devolucion` pasa
  // la validación y el controller revienta con un 500.
  @IsObject()
  @ValidateNested()
  @Type(() => DevolucionViaDto)
  devolucion: DevolucionViaDto;

  /**
   * Ítems que se ACREDITAN en la nota, con su reposición como propiedad de cada
   * línea. Hasta el 2026-09-04 significaba "ítems a devolver a stock" y por eso
   * solo admitía modo `cantidad`: hoy cualquier ítem vendido entra, y lo que
   * `modo_inventario` decide es únicamente si puede volver al inventario.
   */
  @IsOptional()
  @IsArray()
  // Una devolución por ítem distinto de la venta, y una venta tiene a lo sumo
  // 500 líneas (`CreateVentaDto.lineas`): con menos se corta una nota válida.
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DevolucionNotaCreditoDto)
  devoluciones?: DevolucionNotaCreditoDto[];

  /**
   * Solo si la venta no tiene customer; con customer, la nota lleva el de la venta
   * y mandar otro es 400. Sin receptor, la nota va a nombre del emisor.
   * `IsObject` además de `ValidateNested`: este deja pasar un array.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ReceptorNotaCreditoDto)
  receptor?: ReceptorNotaCreditoDto;
}
