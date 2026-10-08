import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsObject,
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
  // Mesas de un salón; el service hace un UPDATE por mesa.
  @ArrayMaxSize(200)
  @ArrayMinSize(1)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => MesaPosicionDto)
  mesas: MesaPosicionDto[];
}
