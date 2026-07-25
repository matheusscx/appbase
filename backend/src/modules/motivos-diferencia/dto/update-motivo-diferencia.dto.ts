import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMotivoDiferenciaDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  nombre?: string;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;

  @IsBoolean()
  @IsOptional()
  requiereComentario?: boolean;
}
