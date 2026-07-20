import {
  IsBoolean,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateImpuestoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nombre?: string;

  @IsOptional()
  @IsNumberString()
  porcentaje?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
