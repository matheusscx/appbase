import { IsOptional, IsString } from 'class-validator';

export class CreateCuentaDto {
  @IsOptional()
  @IsString()
  nombre?: string;
}
