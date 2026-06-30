import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class PagoItemDto {
  @IsUUID()
  metodoPagoId: string;

  @IsNumberString()
  monto: string;

  @IsOptional()
  @IsString()
  referencia?: string;
}

export class CreatePagoDto {
  @IsUUID()
  ventaId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PagoItemDto)
  pagos: PagoItemDto[];
}
