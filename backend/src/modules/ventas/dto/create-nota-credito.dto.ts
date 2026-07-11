import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class DevolucionNotaCreditoDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;
}

export class CreateNotaCreditoDto {
  @IsNumberString()
  monto: string;

  @IsOptional()
  @IsString()
  comentario?: string;

  /** Registra un movimiento de salida en la caja física abierta del usuario. */
  @IsOptional()
  @IsBoolean()
  devolverDinero?: boolean;

  /** Ítems a devolver a stock (solo modo 'cantidad'), independiente del dinero. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DevolucionNotaCreditoDto)
  devoluciones?: DevolucionNotaCreditoDto[];
}
