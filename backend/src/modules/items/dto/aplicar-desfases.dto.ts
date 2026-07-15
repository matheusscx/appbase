import {
  IsArray,
  IsBoolean,
  IsNumberString,
  IsOptional,
  IsUUID,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AplicarDesfaseItemDto {
  @IsUUID()
  recetaItemId: string;

  @IsBoolean()
  @IsOptional()
  actualizarPrecio?: boolean;

  @IsNumberString()
  @IsOptional()
  precioBase?: string;
}

export class AplicarDesfasesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AplicarDesfaseItemDto)
  items: AplicarDesfaseItemDto[];
}
