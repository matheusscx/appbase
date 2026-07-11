import {
  IsArray,
  IsBoolean,
  IsNumberString,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DevolucionLineaDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;
}

export class CreateReembolsoDto {
  @IsNumberString()
  monto: string;

  /** Genera una nota de crédito interna sobre la venta vinculada a la orden. */
  @IsOptional()
  @IsBoolean()
  generarNotaCredito?: boolean;

  /** Ítems a devolver a stock (solo modo 'cantidad'); independiente de la NC. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DevolucionLineaDto)
  devoluciones?: DevolucionLineaDto[];
}
