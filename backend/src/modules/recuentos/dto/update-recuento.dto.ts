import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateRecuentoDto {
  @IsOptional()
  @IsUUID()
  motivoDiferenciaDefaultId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comentario?: string;
}
