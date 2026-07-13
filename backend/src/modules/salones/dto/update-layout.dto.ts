import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class MesaPosicionDto {
  @IsUUID()
  mesaId: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  posX: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  posY: number;
}

export class UpdateLayoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MesaPosicionDto)
  mesas: MesaPosicionDto[];
}
