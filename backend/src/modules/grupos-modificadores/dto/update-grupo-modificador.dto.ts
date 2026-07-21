import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GrupoOpcionInputDto } from './create-grupo-modificador.dto';

export class UpdateGrupoModificadorDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nombre?: string;

  // Reemplazo total: si viene, sustituye todas las opciones vivas.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GrupoOpcionInputDto)
  opciones?: GrupoOpcionInputDto[];
}
