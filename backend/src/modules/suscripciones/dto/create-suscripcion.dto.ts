import {
  IsUUID,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsString,
  IsNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TarjetaSnapshotDto {
  @IsString()
  @IsNotEmpty()
  marca: string;

  @IsString()
  @IsNotEmpty()
  last4: string;
}

export class CreateSuscripcionDto {
  @IsUUID()
  itemId: string;

  @IsInt()
  @Min(1)
  @Max(28)
  @IsOptional()
  diaMes?: number;

  @IsInt()
  @Min(0)
  @Max(6)
  @IsOptional()
  diaSemana?: number;

  @IsUUID()
  metodoPagoId: string;

  @ValidateNested()
  @Type(() => TarjetaSnapshotDto)
  @IsOptional()
  tarjeta?: TarjetaSnapshotDto;
}
