import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumberString,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Body de `POST /compras/presentaciones`. ⚠️ Sin `tenantId`: sale del token. */
export class CrearPresentacionCompraDto {
  @IsUUID()
  proveedorId: string;

  @IsUUID()
  itemId: string;

  @Transform(recortar)
  @IsString()
  @Matches(/\S/, { message: 'El nombre no puede quedar vacío' })
  @MaxLength(40)
  nombre: string;

  /** Cuánto trae, en `unidadCodigo`. String + Decimal.js, como toda cantidad de kardex. */
  @IsNumberString()
  @IsDecimalPositivo()
  contenido: string;

  @IsString()
  @IsNotEmpty()
  unidadCodigo: string;
}

/**
 * Body de `PATCH /compras/presentaciones/:id`. Ausente es "no se toca"; `null`
 * es 400 (`@ValidateIf` sobre `undefined`, no `@IsOptional`, que deja pasar el
 * null). Mismo idioma que `CorregirLineaDto`.
 */
export class EditarPresentacionCompraDto {
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(recortar)
  @IsString()
  @Matches(/\S/, { message: 'El nombre no puede quedar vacío' })
  @MaxLength(40)
  nombre?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsNumberString()
  @IsDecimalPositivo()
  contenido?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  unidadCodigo?: string;
}

export class ListarPresentacionesCompraDto {
  @IsUUID()
  proveedorId: string;
}
