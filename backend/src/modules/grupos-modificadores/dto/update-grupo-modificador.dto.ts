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

  // Upsert-preservando: si viene, sincroniza las opciones vivas con este
  // array (UPDATE si el item_id persiste, INSERT si es nuevo, soft-delete
  // + cascada de overrides si desaparece). Ver GruposModificadoresService.update.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GrupoOpcionInputDto)
  opciones?: GrupoOpcionInputDto[];
}
