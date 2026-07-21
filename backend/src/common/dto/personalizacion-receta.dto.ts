import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export interface SnapshotGrupo {
  grupoId: string;
  grupoNombre: string;
  opciones: {
    itemId: string;
    nombre: string;
    cantidad: string;
    unidadCodigo?: string;
    precioExtra: string;
    unidades: string;
  }[];
}

export interface PersonalizacionRecetaSnapshot {
  omitidos: string[];
  extras: {
    ingredienteItemId: string;
    cantidad: string;
    unidadCodigo: string;
    precioExtra: string;
    /** Número de veces que se agrega el extra (≥ 1). Ausente en snapshots antiguos = 1. */
    unidades?: string;
  }[];
  comentario?: string;
  grupos?: SnapshotGrupo[];
}

export class PersonalizacionExtraInputDto {
  @IsUUID()
  ingredienteItemId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  unidades?: number;
}

export class PersonalizacionGrupoOpcionInputDto {
  @IsUUID()
  itemId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  unidades?: number;
}

export class PersonalizacionGrupoInputDto {
  @IsUUID()
  grupoId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PersonalizacionGrupoOpcionInputDto)
  opciones: PersonalizacionGrupoOpcionInputDto[];
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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PersonalizacionGrupoInputDto)
  grupos?: PersonalizacionGrupoInputDto[];
}
