import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateImpuestoDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsNumberString()
  porcentaje: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsIn(['iva', 'otro'])
  tipo?: string;
}
