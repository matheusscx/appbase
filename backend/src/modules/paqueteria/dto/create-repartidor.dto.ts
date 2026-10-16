import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateRepartidorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string | null;
}
