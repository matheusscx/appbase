import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateRecuentoDto {
  // null explícito limpia la causa por defecto de la sesión; undefined deja
  // el campo sin tocar.
  @IsOptional()
  @IsUUID()
  motivoDiferenciaDefaultId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comentario?: string;
}
