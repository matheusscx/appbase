import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsDecimalPersistible } from '../../../common/decorators/decimal-signo.decorator';
import { EsCantidad } from '../../../common/decorators/escala-moneda.decorator';
import { TipoGarzon } from '../../garzones/enums/tipo-garzon.enum';
import { CriterioDistribucion } from '../enums/criterio-distribucion.enum';
import { BaseVentasGrupo } from '../enums/base-ventas-grupo.enum';
import { ManualModo } from '../enums/manual-modo.enum';
import { MAX_INT } from '../../../common/constants/escalas';

export class PesoManualDto {
  @IsUUID()
  garzonId: string;

  // El peso no es una cantidad, pero va a una columna `NUMERIC(18,4)` y el
  // reparto se hace con lo guardado: con más de 4 decimales es 400, no se
  // redondea (owner, 2026-10-13). El techo de la columna lo pone el de arriba.
  @IsNumberString()
  @IsDecimalPersistible(18, 4)
  @EsCantidad('El peso admite como máximo 4 decimales.')
  peso: string;
}

// `baseVentas`, `activo`, `orden` y `pesos` son obligatorios aunque tengan un
// default obvio: el PUT reescribe todos los grupos, así que omitir uno (o
// mandarlo en `null`) escribía el default y pisaba lo guardado con un 200 —un
// grupo apagado que llegaba sin `activo` se volvía a prender—. Decidido por el
// owner el 2026-10-04: omitirlos es un 400. `manualModo` solo es obligatorio con
// criterio MANUAL.
export class GrupoDistribucionDto {
  @IsIn(Object.values(TipoGarzon))
  tipoGarzon: TipoGarzon;

  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsNumberString()
  @IsDecimalPersistible(10, 6)
  porcentaje: string;

  @IsIn(Object.values(CriterioDistribucion))
  criterio: CriterioDistribucion;

  @IsIn(Object.values(BaseVentasGrupo))
  baseVentas: BaseVentasGrupo;

  @ValidateIf(
    (o: GrupoDistribucionDto) => o.criterio === CriterioDistribucion.MANUAL,
  )
  @IsIn(Object.values(ManualModo))
  manualModo?: ManualModo | null;

  @IsBoolean()
  activo: boolean;

  // Columna `int` de `propina_grupo_distribucion`.
  @IsInt()
  @Min(0)
  @Max(MAX_INT)
  orden: number;

  @IsArray()
  // Uno por garzón activo; el guardado valida y escribe cada peso por
  // separado (dos queries por elemento).
  @ArrayMaxSize(200)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => PesoManualDto)
  pesos: PesoManualDto[];
}

// `@ValidateIf` y no `@IsOptional()`: las dos columnas son NOT NULL e
// `IsOptional` trata `null` igual que ausente y saltea `@IsBoolean`; el `null`
// llegaba a la columna como un 500 de Postgres en vez de un 400. Omitirlos
// conserva el valor que tenían.
export class UpdateDistribucionDto {
  @IsNumberString()
  porcentajeSugerido: string;

  @IsArray()
  // Activos hay a lo sumo uno por tipo de garzón (tres); el resto son grupos
  // apagados que la pantalla conserva. Un INSERT por grupo.
  @ArrayMaxSize(20)
  @ArrayMinSize(1)
  @IsObject({ each: true })
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
