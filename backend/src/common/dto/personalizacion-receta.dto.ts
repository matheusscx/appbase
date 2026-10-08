import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IdEnMinusculas } from '../decorators/id-en-minusculas.decorator';

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

/**
 * Cuántas veces se puede agregar un mismo extra a **un** plato. `unidades` es
 * por plato: 50 hamburguesas con queso extra son `cantidad: 50` y `unidades: 1`,
 * así que el tope no limita un pedido grande, ataja el error de tipeo. Sin tope,
 * 10^12 unidades de un extra de $500 desbordaban `precio_unitario` NUMERIC(18,4)
 * y la línea de cuenta o la venta daban 500 (medido el 2026-10-08).
 *
 * ⚠️ El 99 es **tentativo**: lo recomendó la Sesión de esfuerzo máximo y lo
 * tiene que confirmar el owner (`docs/agent/resueltos.md`, cierre del
 * 2026-10-08).
 */
export const MAX_UNIDADES_EXTRA = 99;

export class PersonalizacionExtraInputDto {
  @IdEnMinusculas()
  @IsUUID()
  ingredienteItemId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_UNIDADES_EXTRA, {
    message: `Un extra se puede agregar hasta ${MAX_UNIDADES_EXTRA} veces por plato`,
  })
  unidades?: number;
}

export class PersonalizacionGrupoOpcionInputDto {
  @IdEnMinusculas()
  @IsUUID()
  itemId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  unidades?: number;
}

export class PersonalizacionGrupoInputDto {
  @IdEnMinusculas()
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
  @IdEnMinusculas()
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
  // En minúsculas antes de que `resolverPersonalizacionReceta` las compare con
  // los ingredientes y busque repetidos: `[x, X]` es un repetido.
  @IdEnMinusculas()
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
