import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateSalonDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  nombre?: string;
}
