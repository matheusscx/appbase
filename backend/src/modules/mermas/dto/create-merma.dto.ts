import { IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateMermaDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;

  @IsString()
  @IsOptional()
  unidadCodigo?: string;

  @IsUUID()
  causaMermaId: string;

  @IsString()
  @IsOptional()
  comentario?: string;

  @IsNumberString()
  @IsOptional()
  costoUnitario?: string;
}
