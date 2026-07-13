import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { FormaMesa, TamanoMesa } from '../entities/mesa.entity';

export class UpdateMesaDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  nombre?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  posX?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  posY?: number;

  @IsOptional()
  @IsEnum(FormaMesa)
  forma?: FormaMesa;

  @IsOptional()
  @IsEnum(TamanoMesa)
  tamano?: TamanoMesa;
}
