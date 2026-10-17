import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RutChileno } from '../../../common/decorators/rut-chileno.decorator';

/**
 * Alta de un proveedor desde la carga de una compra (auditoría UX 06.11,
 * decisión del owner 2026-10-16). Es **más angosto a propósito** que
 * `CreateTerceroDto`: quien carga compras crea proveedores, no terceros de
 * cualquier tipo, así que `tipo` no existe acá (el servidor lo fija) y el
 * pipe global rechaza el campo si llega. Los topes son los de las columnas.
 */
export class CrearProveedorCompraDto {
  @IsString()
  @IsNotEmpty()
  // Una cadena de espacios no es un nombre.
  @Matches(/\S/)
  @MaxLength(100)
  nombre: string;

  @RutChileno()
  rut?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  correo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  telefono?: string;

  /** Mismo tope que `CreateTerceroDto.plazoPagoDias` (10 años; el `int` de Postgres). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  plazoPagoDias?: number;
}
