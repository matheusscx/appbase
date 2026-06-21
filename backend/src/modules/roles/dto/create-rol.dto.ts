import { IsOptional, IsString } from 'class-validator';

export class CreateRolDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  descripcion?: string;
}
