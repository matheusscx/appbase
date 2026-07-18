import {
  IsArray,
  IsNumberString,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MontoManualDto {
  @IsUUID()
  garzonId: string;

  @IsNumberString()
  monto: string;
}

export class AjustesRepartoDto {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  exclusiones?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MontoManualDto)
  montosManuales?: MontoManualDto[];
}
