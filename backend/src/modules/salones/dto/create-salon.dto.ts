import { IsString, MinLength } from 'class-validator';

export class CreateSalonDto {
  @IsString()
  @MinLength(1)
  nombre: string;
}
