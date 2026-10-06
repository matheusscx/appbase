import {
  ArrayMaxSize,
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
  /**
   * Combos: elección de grupos de los componentes receta, por unidad.
   * Una entrada por (componente, unidad). Ausente en snapshots antiguos
   * y en combos sin componentes con grupos.
   */
  componentes?: {
    componenteItemId: string;
    componenteNombre: string;
    /** 1..cantidad del componente en el combo. */
    unidad: number;
    grupos: SnapshotGrupo[];
  }[];
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
  // A lo sumo las opciones del grupo: el tope de `CreateGrupoModificadorDto`.
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PersonalizacionGrupoOpcionInputDto)
  opciones: PersonalizacionGrupoOpcionInputDto[];
}

export class PersonalizacionComponenteInputDto {
  @IsUUID()
  componenteItemId: string;

  @IsInt()
  @Min(1)
  unidad: number;

  @IsArray()
  // A lo sumo los grupos del componente: el tope de
  // `CreateItemDto.gruposModificadores`.
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PersonalizacionGrupoInputDto)
  grupos: PersonalizacionGrupoInputDto[];
}

export class PersonalizacionRecetaDto {
  @IsOptional()
  @IsArray()
  // A lo sumo los ingredientes de la receta: el tope de
  // `CreateItemDto.ingredientes`.
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  omitidos?: string[];

  @IsOptional()
  @IsArray()
  // A lo sumo los extras de la receta: el tope de
  // `CreateItemDto.extrasPermitidos`.
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PersonalizacionExtraInputDto)
  extras?: PersonalizacionExtraInputDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  comentario?: string;

  @IsOptional()
  @IsArray()
  // A lo sumo los grupos del ítem: el tope de `CreateItemDto.gruposModificadores`.
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PersonalizacionGrupoInputDto)
  grupos?: PersonalizacionGrupoInputDto[];

  @IsOptional()
  @IsArray()
  // Una entrada por unidad de cada componente del combo (un combo de 50
  // componentes con varias unidades de alguno).
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PersonalizacionComponenteInputDto)
  componentes?: PersonalizacionComponenteInputDto[];
}
