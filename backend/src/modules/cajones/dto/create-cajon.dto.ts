import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCajonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nombre: string;
}
