import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateCategoriaDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nombre?: string;

  @IsOptional()
  @IsIn(['productos', 'servicios', 'ambos'])
  aplicaA?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
