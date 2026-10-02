import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GrupoOpcionInputDto } from './create-grupo-modificador.dto';

// `@ValidateIf` y no `@IsOptional()`: `IsOptional` trata `null` igual que
// ausente y saltea el validador de abajo. Un `nombre` null llegaba a una columna
// NOT NULL y unas `opciones` null al recorrido del service, los dos como 500 en
// vez de un 400. Omitir un campo conserva el valor que tenía.
export class UpdateGrupoModificadorDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  nombre?: string;

  // Upsert-preservando: si viene, sincroniza las opciones vivas con este
  // array (UPDATE si el item_id persiste, INSERT si es nuevo, soft-delete
  // + cascada de overrides si desaparece). Ver GruposModificadoresService.update.
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GrupoOpcionInputDto)
  opciones?: GrupoOpcionInputDto[];
}
