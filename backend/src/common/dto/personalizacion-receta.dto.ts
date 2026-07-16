import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export interface PersonalizacionRecetaSnapshot {
  omitidos: string[];
  extras: {
    ingredienteItemId: string;
    cantidad: string;
    unidadCodigo: string;
    precioExtra: string;
  }[];
  comentario?: string;
}

export class PersonalizacionExtraInputDto {
  @IsUUID()
  ingredienteItemId: string;
}

export class PersonalizacionRecetaDto {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  omitidos?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PersonalizacionExtraInputDto)
  extras?: PersonalizacionExtraInputDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  comentario?: string;
}
