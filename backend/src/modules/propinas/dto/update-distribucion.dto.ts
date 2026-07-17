import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
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

  @IsOptional()
  @IsIn(Object.values(BaseVentasGrupo))
  baseVentas?: BaseVentasGrupo;

  @ValidateIf((o: GrupoDistribucionDto) => o.criterio === CriterioDistribucion.MANUAL)
  @IsIn(Object.values(ManualModo))
  manualModo?: ManualModo | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  orden?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PesoManualDto)
  pesos?: PesoManualDto[];
}

export class UpdateDistribucionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GrupoDistribucionDto)
  grupos: GrupoDistribucionDto[];
}
