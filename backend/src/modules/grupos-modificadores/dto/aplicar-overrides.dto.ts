import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class AplicarOverridesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  itemGrupoIds: string[];

  @IsUUID()
  grupoOpcionId: string;

  @IsOptional()
  @IsNumberString()
  cantidad?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unidadCodigo?: string;

  @IsOptional()
  @IsNumberString()
  precioExtra?: string;
}
