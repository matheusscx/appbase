import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type { ClaseDocumentoMaquina } from '../../venta-documentos/entities/venta-documento.entity';
import { PersonalizacionRecetaDto } from '../../../common/dto/personalizacion-receta.dto';
import {
  IsDecimalPositivo,
  IsDecimalHasta,
} from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';
import { PropinaCierreMesaDto } from './propina-cierre-mesa.dto';
import { PropinaDirectaDto } from './propina-directa.dto';
import {
  MAX_LINEAS_POR_VENTA,
  MAX_UNIDADES_POR_VENTA,
} from '../../../common/utils/tope-unidades-venta.util';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';
import { MAX_INT } from '../../../common/constants/escalas';

export class LineaVentaDto {
  @IsUUID()
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

  @IsOptional()
  @IsArray()
  // Con techo: la salida serie lockea todas las unidades adentro de la
  // transacción que retiene el lock ancla del producto, así que el largo que
  // manda el cliente es tiempo de espera para las ventas de ese producto. Mismo
  // 200 que `LineaTrasladoDto`.
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  unidadIds?: string[]; // modo 'serie' salida

  @IsOptional()
  @IsUUID()
  loteId?: string; // modo 'lote' salida

  // `IsObject` además de `ValidateNested`: este deja pasar un array, que se
  // aceptaba con 201 guardando `omitidos: []` y descontando el ingrediente
  // omitido (medido el 2026-10-08).
  @IsOptional()
  @IsObject()
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
  // Mismo rango que `PagoItemDto.numeroCuotas`.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_INT)
  numeroCuotas?: number;

  @IsOptional()
  @IsString()
  tipoPago?: string;

  @IsOptional()
  @IsString()
  @Length(4, 4)
  tarjetaUltimos4?: string;

  /**
   * El número del voucher o de la boleta que emitió la máquina de tarjeta, si el
   * cajero lo tiene a mano. Solo lo lee el servidor cuando el medio del pago
   * emite con la máquina; en cualquier otro medio se ignora sin error (la
   * pantalla no lo muestra ahí y el pago sigue siendo válido). Opcional: se
   * puede completar después.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(40)
  // Sin caracteres de control: un salto de línea o un NUL en el número llegaría
  // a la base y a lo que se imprima. Con el `trim` de arriba, los de los
  // extremos ya no están; acá se rechazan los del medio.
  // eslint-disable-next-line no-control-regex
  @Matches(/^[^\u0000-\u001F\u007F]*$/, {
    message: 'numeroDocumento no puede llevar caracteres de control',
  })
  numeroDocumento?: string;

  /** Qué emitió la máquina. Mismas reglas que `numeroDocumento`. */
  @IsOptional()
  @IsIn(['voucher', 'boleta'])
  claseDocumento?: ClaseDocumentoMaquina;
}

/**
 * El receptor de la venta. Los largos son los del SII (Formato DTE v2.5, zona
 * Receptor) y valen para todo país: lo que se congela es lo que se emitiría, y
 * el sistema nunca trunca. Qué campos exige cada tipo y el chequeo del RUT
 * dependen del país: `resolverTipoDocumento`.
 */
export class CustomerVentaDto {
  @IsOptional()
  @IsUUID()
  terceroId?: string;

  /** Nombre o razón social (`RznSocRecep`). */
  @IsString()
  @MinLength(1)
  @MaxLength(100, {
    message:
      'La razón social no puede pasar de 100 caracteres (límite del SII)',
  })
  nombre: string;

  @IsOptional()
  @IsString()
  rut?: string;

  @IsOptional()
  @IsString()
  @MaxLength(70, {
    message: 'La dirección no puede pasar de 70 caracteres (límite del SII)',
  })
  direccion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40, {
    message: 'El giro no puede pasar de 40 caracteres (límite del SII)',
  })
  giro?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, {
    message: 'La comuna no puede pasar de 20 caracteres (límite del SII)',
  })
  comuna?: string;

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsOptional()
  @IsString()
  email?: string;
}

export class CreateVentaDto {
  @IsArray()
  // Por qué ese número: `MAX_LINEAS_POR_VENTA`.
  @ArrayMaxSize(MAX_LINEAS_POR_VENTA)
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LineaVentaDto)
  lineas: LineaVentaDto[];

  @IsOptional()
  @IsArray()
  // Una cuenta dividida entre comensales; tres o cuatro INSERT por pago.
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PagoVentaDto)
  pagos?: PagoVentaDto[];

  @IsOptional()
  @IsUUID()
  tipoDocumentoId?: string;

  // En minúsculas: el motor lo busca entre los métodos de cada regla, que vienen
  // de la base, y en mayúsculas la venta se calculaba sin el recargo por método
  // de pago (medido el 2026-10-08: el pago exacto con recargo daba 400 "El pago
  // supera el total").
  @IsOptional()
  @IdEnMinusculas()
  @IsUUID()
  metodoPagoId?: string;

  @IsOptional()
  @IsArray()
  // Reglas del catálogo del tenant. Sin repetidos: repetido, el motor aplicaba
  // la regla una vez por repetición (un 201 con total 0, medido 2026-10-06).
  // En minúsculas ANTES de `@ArrayUnique`, que compara strings exactos: sin
  // eso `[D, d]` pasaba como dos ids, y un id solo en mayúsculas daba 400 "no
  // encontrado" porque el mapa del motor tiene los de la base.
  @ArrayMaxSize(50)
  @IdEnMinusculas()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  descuentosVentaIds?: string[];

  @IsOptional()
  @IsArray()
  // Mismo tope, mismas minúsculas y misma razón que `descuentosVentaIds`.
  @ArrayMaxSize(50)
  @IdEnMinusculas()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  recargosVentaIds?: string[];

  // `IsObject` además de `ValidateNested`: este deja pasar un array, que con una
  // Factura revienta el chequeo de `customer_requerido` en un 500.
  @IsOptional()
  @IsObject()
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
  // `IsObject` además de `ValidateNested`: este deja pasar un array, que
  // reventaba la venta en un 500.
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PropinaCierreMesaDto)
  propinaCierreMesa?: PropinaCierreMesaDto;

  // `IsObject` además de `ValidateNested`: este deja pasar un array, que
  // reventaba la venta en un 500.
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PropinaDirectaDto)
  propinaDirecta?: PropinaDirectaDto;
}
