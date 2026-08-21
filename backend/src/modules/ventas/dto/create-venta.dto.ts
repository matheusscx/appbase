import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PersonalizacionRecetaDto } from '../../../common/dto/personalizacion-receta.dto';
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';
import {
  EsCosto,
  EsMontoCobrado,
} from '../../../common/decorators/escala-moneda.decorator';
import { PropinaCierreMesaDto } from './propina-cierre-mesa.dto';
import { PropinaDirectaDto } from './propina-directa.dto';

export class LineaVentaDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;

  @IsOptional()
  @IsNumberString()
  cantidadPresentacion?: string;

  @IsOptional()
  @IsString()
  unidadCodigoPresentacion?: string;

  /**
   * Override opcional del `precio_base` del ítem. **Estrictamente positivo
   * (decisión del owner, 2026-08-11):** el `0` era el único camino para dejar
   * una línea en cero sin que quede rastro de quién la regaló.
   *
   * Prohibirlo no cierra ninguna venta gratis legítima: el campo es opcional y
   * sin él el precio sale de `item.precioBase` (`ventas.service.ts`), que puede
   * ser 0; y un regalo puntual se modela con un descuento, que sí deja traza.
   */
  //
  // `@EsCosto()` (escala 4) y no `@EsMontoCobrado()`: es el precio **por
  // unidad** de la línea, o sea una tasa. El monto aparece recién cuando el
  // motor lo multiplica por `cantidad`, que es donde se cruza la frontera
  // tasa→monto. Tratarlo como monto cobrado significaría que en CLP no se
  // puede vender nada a un precio con decimales, cuando la columna persiste 4.
  @IsOptional()
  @IsNumberString()
  @IsDecimalPositivo()
  @EsCosto()
  precioUnitario?: string;

  @IsOptional()
  @IsUUID(undefined, { each: true })
  descuentoIds?: string[];

  @IsOptional()
  @IsUUID(undefined, { each: true })
  recargoIds?: string[];

  @IsOptional()
  @IsUUID(undefined, { each: true })
  impuestoIds?: string[];

  @IsOptional()
  @IsUUID(undefined, { each: true })
  unidadIds?: string[]; // modo 'serie' salida

  @IsOptional()
  @IsUUID()
  loteId?: string; // modo 'lote' salida

  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalizacionRecetaDto)
  personalizacion?: PersonalizacionRecetaDto;
}

export class PagoVentaDto {
  @IsUUID()
  metodoPagoId: string;

  // Una línea de pago en $0 no aporta nada; el POS ya los omite al confirmar.
  @IsNumberString()
  @IsDecimalPositivo()
  @EsMontoCobrado()
  monto: string;

  @IsOptional()
  @IsString()
  referencia?: string;

  // Detalle de tarjeta desde la pasarela (Webpay). No lo envía el POS manual.
  @IsOptional()
  @IsInt()
  numeroCuotas?: number;

  @IsOptional()
  @IsString()
  tipoPago?: string;

  @IsOptional()
  @IsString()
  @Length(4, 4)
  tarjetaUltimos4?: string;
}

export class CustomerVentaDto {
  @IsOptional()
  @IsUUID()
  terceroId?: string;

  @IsString()
  @MinLength(1)
  nombre: string;

  @IsOptional()
  @IsString()
  rut?: string;

  @IsOptional()
  @IsString()
  direccion?: string;

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsOptional()
  @IsString()
  email?: string;
}

export class CreateVentaDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LineaVentaDto)
  lineas: LineaVentaDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PagoVentaDto)
  pagos?: PagoVentaDto[];

  @IsOptional()
  @IsUUID()
  tipoDocumentoId?: string;

  @IsOptional()
  @IsUUID()
  metodoPagoId?: string;

  @IsOptional()
  @IsUUID(undefined, { each: true })
  descuentosVentaIds?: string[];

  @IsOptional()
  @IsUUID(undefined, { each: true })
  recargosVentaIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerVentaDto)
  customer?: CustomerVentaDto;

  @IsOptional()
  @IsString()
  comentario?: string;

  @IsOptional()
  @IsIn(['fisico', 'online'])
  canal?: 'fisico' | 'online';

  /** Solo cierre de cuenta de mesa — crea venta_propina y eleva target de cobro. */
  @IsOptional()
  @ValidateNested()
  @Type(() => PropinaCierreMesaDto)
  propinaCierreMesa?: PropinaCierreMesaDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PropinaDirectaDto)
  propinaDirecta?: PropinaDirectaDto;
}
