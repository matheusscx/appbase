import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export class AplicarOverridesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  itemGrupoIds: string[];

  @IsUUID()
  grupoOpcionId: string;

  @ValidateIf((o: AplicarOverridesDto) => o.cantidad !== '')
  @IsOptional()
  @IsNumberString()
  cantidad?: string;

  @ValidateIf((o: AplicarOverridesDto) => o.unidadCodigo !== '')
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unidadCodigo?: string;

  @ValidateIf((o: AplicarOverridesDto) => o.precioExtra !== '')
  @IsOptional()
  @IsNumberString()
  precioExtra?: string;
}
