import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
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

  // `null` explícito desasigna la ruta de comanda; un UUID la (re)asigna.
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  impresoraId?: string | null;
}
