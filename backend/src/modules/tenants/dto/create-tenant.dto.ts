import { IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  nombre: string;

  @IsEmail()
  correo: string;

  @IsUUID()
  provinciaId: string;

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsOptional()
  @IsString()
  direccion?: string;
}
