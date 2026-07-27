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
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';

export class DevolucionNotaCreditoDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;
}

export class CreateNotaCreditoDto {
  // El service ya rechaza monto <= 0 (crearNotaCredito); se refuerza en el DTO.
  @IsNumberString()
  @IsDecimalPositivo()
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
