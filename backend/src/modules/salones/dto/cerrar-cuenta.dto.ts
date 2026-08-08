import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumberString,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import {
  CustomerVentaDto,
  PagoVentaDto,
} from '../../ventas/dto/create-venta.dto';
import { CredencialGarzonDto } from '../../../common/dto/credencial-garzon.dto';

export class CerrarCuentaDto extends CredencialGarzonDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PagoVentaDto)
  pagos?: PagoVentaDto[];

  @IsOptional()
  @IsUUID()
  tipoDocumentoId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerVentaDto)
  customer?: CustomerVentaDto;

  /** Monto de propina cobrado (0 = sin propina). Default 0 si se omite. */
  @IsOptional()
  @IsNumberString()
  propinaMonto?: string;

  /** Sugerencia mostrada en UI al momento del cobro. */
  @IsOptional()
  @IsNumberString()
  propinaSugerida?: string;

  /** Porcentaje usado para la sugerencia (decimal, ej. 0.10). */
  @IsOptional()
  @IsNumberString()
  propinaPorcentajeSugerido?: string;
}
