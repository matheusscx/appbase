import { IsNumberString, IsOptional, IsString } from 'class-validator';

export class UpdateLineaDto {
  @IsNumberString()
  cantidad: string;

  @IsOptional()
  @IsNumberString()
  cantidadPresentacion?: string;

  @IsOptional()
  @IsString()
  unidadCodigoPresentacion?: string;
}
