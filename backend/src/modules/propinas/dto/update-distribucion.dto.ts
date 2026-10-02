import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { TipoGarzon } from '../../garzones/enums/tipo-garzon.enum';
import { CriterioDistribucion } from '../enums/criterio-distribucion.enum';
import { BaseVentasGrupo } from '../enums/base-ventas-grupo.enum';
import { ManualModo } from '../enums/manual-modo.enum';

export class PesoManualDto {
  @IsUUID()
  garzonId: string;

  @IsNumberString()
  peso: string;
}

// `@ValidateIf` y no `@IsOptional()` en `baseVentas`, `activo`, `orden` y
// `pesos`: `IsOptional` trata `null` igual que ausente, y como el PUT reescribe
// todos los grupos, un `null` caía en el default (`TOTAL_FINAL`, activo, orden 0,
// sin pesos) y pisaba lo guardado con un 200. Omitirlos sigue escribiendo el
// default; mandarlos en `null` es un 400.
export class GrupoDistribucionDto {
  @IsIn(Object.values(TipoGarzon))
  tipoGarzon: TipoGarzon;

  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsNumberString()
  porcentaje: string;

  @IsIn(Object.values(CriterioDistribucion))
  criterio: CriterioDistribucion;

  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(Object.values(BaseVentasGrupo))
  baseVentas?: BaseVentasGrupo;

  @ValidateIf(
    (o: GrupoDistribucionDto) => o.criterio === CriterioDistribucion.MANUAL,
  )
  @IsIn(Object.values(ManualModo))
  manualModo?: ManualModo | null;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  activo?: boolean;

  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(0)
  orden?: number;

  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PesoManualDto)
  pesos?: PesoManualDto[];
}

// `@ValidateIf` y no `@IsOptional()`: las dos columnas son NOT NULL e
// `IsOptional` trata `null` igual que ausente y saltea `@IsBoolean`; el `null`
// llegaba a la columna como un 500 de Postgres en vez de un 400. Omitirlos
// conserva el valor que tenían.
export class UpdateDistribucionDto {
  @IsNumberString()
  porcentajeSugerido: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GrupoDistribucionDto)
  grupos: GrupoDistribucionDto[];

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  habilitadoPos?: boolean;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  habilitadoSalones?: boolean;
}
