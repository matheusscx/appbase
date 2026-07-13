import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
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

  // `null` explícito desasigna la ruta; `Object.assign` en el service la limpia.
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  impresoraId?: string | null;
}
