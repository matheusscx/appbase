import { Type } from 'class-transformer';
import Decimal from 'decimal.js';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  IsDecimalNoNegativo,
  IsDecimalPositivo,
} from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';

/** Una línea del reparto propuesto (spec § 5.1): cuánto va a esta compra. */
export class AplicacionPagoProveedorDto {
  @IsUUID()
  compraId: string;

  @IsNumberString()
  @IsDecimalPositivo()
  @EsMontoCobrado()
  monto: string;
}

function montoEsPositivo(monto: unknown): boolean {
  if (typeof monto !== 'string') return false;
  try {
    return new Decimal(monto).gt(0);
  } catch {
    return false;
  }
}

/**
 * Body de `POST /compras/pagos` (spec § 5.1): `monto` ≥ 0 (0 con
 * aplicaciones es "usar el saldo a favor", decisión 5); `metodoPagoId` es
 * obligatorio salvo que `monto` sea 0. `aplicaciones` vacía es un anticipo.
 * `@Type()` en `aplicaciones`: sin él `EscalaMonedaPipe` no ve el `monto` de
 * cada línea (docs/patterns/backend.md § 3.1).
 */
export class CrearPagoProveedorDto {
  @IsUUID()
  proveedorId: string;

  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsMontoCobrado()
  monto: string;

  // Obligatorio salvo `monto` 0 (spec § 5.1: "usar el saldo a favor" no
  // registra un pago ni necesita medio). `montoEsPositivo` no revienta con un
  // `monto` todavía inválido: si no parsea, no es `> 0`, y `@IsNumberString`
  // de arriba ya lo rechaza por su cuenta.
  @ValidateIf((o: CrearPagoProveedorDto) => montoEsPositivo(o.monto))
  @IsUUID()
  metodoPagoId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  referencia?: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AplicacionPagoProveedorDto)
  aplicaciones: AplicacionPagoProveedorDto[];
}

/** Body de `POST /compras/pagos/:id/anular` (spec § 5.2). */
export class AnularPagoProveedorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  motivo: string;
}

/** Query de `GET /compras/pagos` (spec § 8): siempre acotado a un proveedor. */
export class FindPagosProveedorDto {
  @IsUUID()
  proveedorId: string;
}
