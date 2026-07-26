import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMotivoDiferenciaInventarioDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  nombre?: string;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;
}
