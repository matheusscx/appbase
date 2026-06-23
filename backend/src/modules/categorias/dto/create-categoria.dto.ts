import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateCategoriaDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsOptional()
  @IsIn(['productos', 'servicios', 'ambos'])
  aplicaA?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
