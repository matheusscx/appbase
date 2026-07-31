import {
  IsString,
  IsNotEmpty,
  IsNumberString,
  IsUUID,
  IsIn,
  IsBoolean,
  IsOptional,
  IsDateString,
  IsInt,
  Min,
  IsArray,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';

export class SerieInputDto {
  @IsString()
  @IsNotEmpty()
  serie: string;

  @IsIn(['nuevo', 'usado', 'reacondicionado'])
  @IsOptional()
  condicion?: string;

  @IsDateString()
  @IsOptional()
  garantiaHasta?: string;

  @IsUUID()
  @IsOptional()
  loteId?: string;
}

export class LoteInputDto {
  @IsString()
  @IsNotEmpty()
  codigoLote: string;

  @IsDateString()
  @IsOptional()
  fechaElaboracion?: string;

  @IsDateString()
  @IsOptional()
  fechaVencimiento?: string;
}

export class RecetaIngredienteInputDto {
  @IsUUID()
  ingredienteItemId: string;

  @IsNumberString()
  cantidad: string;

  @IsString()
  @IsNotEmpty()
  unidadCodigo: string;

  @IsBoolean()
  @IsOptional()
  bloqueante?: boolean;
}

export class RecetaExtraInputDto {
  @IsUUID()
  ingredienteItemId: string;

  @IsNumberString()
  cantidad: string;

  @IsString()
  @IsNotEmpty()
  unidadCodigo: string;

  // Dinero: se suma al precio de la línea. `>= 0` — un extra gratis es legítimo.
  @IsNumberString()
  @IsDecimalNoNegativo()
  precioExtra: string;
}

export class ComboComponenteInputDto {
  @IsUUID()
  componenteItemId: string;

  @IsNumberString()
  cantidad: string;

  @IsBoolean()
  @IsOptional()
  bloqueante?: boolean;
}

export class ItemGrupoOpcionOverrideInputDto {
  @IsUUID()
  grupoOpcionId: string;

  @ValidateIf((o: ItemGrupoOpcionOverrideInputDto) => o.cantidad !== '')
  @IsOptional()
  @IsNumberString()
  cantidad?: string;

  @ValidateIf((o: ItemGrupoOpcionOverrideInputDto) => o.unidadCodigo !== '')
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unidadCodigo?: string;

  // Mismo criterio que el `precioExtra` de arriba. El `@ValidateIf` sigue mandando:
  // el string vacío es "no tocar este override" y saltea todos los validadores.
  @ValidateIf((o: ItemGrupoOpcionOverrideInputDto) => o.precioExtra !== '')
  @IsOptional()
  @IsNumberString()
  @IsDecimalNoNegativo()
  precioExtra?: string;
}

export class ItemGrupoModificadorInputDto {
  @IsUUID()
  grupoModificadorId: string;

  @IsInt()
  @Min(0)
  min: number;

  @IsInt()
  @Min(1)
  max: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  orden?: number;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ItemGrupoOpcionOverrideInputDto)
  opciones?: ItemGrupoOpcionOverrideInputDto[];
}

export class CreateItemDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  // Dinero, y la columna no tiene `CHECK` (`startup-pos.sql`): el DTO es la única
  // barrera. `>= 0` y no `> 0`: el `0` es legítimo —el service lo fuerza para los
  // ingredientes— y el negativo no tiene lectura posible (llega a `totalFinal`
  // negativo sin que ninguna regla lo neutralice).
  @IsNumberString()
  @IsDecimalNoNegativo()
  precioBase: string;

  @IsUUID()
  monedaId: string;

  @IsUUID()
  @IsOptional()
  categoriaId?: string;

  @IsIn([
    'producto',
    'servicio',
    'suscripcion',
    'receta',
    'ingrediente',
    'combo',
  ])
  tipo: string;

  @IsBoolean()
  @IsOptional()
  precioIncluyeImpuesto?: boolean;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;

  // @ValidateIf (no @IsOptional): mismo motivo que en `UpdateItemDto` —
  // @IsOptional() también saltea la validación cuando el valor es `null`
  // explícito, no solo cuando la propiedad falta. El `INSERT` de `create()`
  // (`items.service.ts`) lista `clasificacion_tributaria` explícitamente en
  // sus columnas, así que el `DEFAULT 'afecto'` de la tabla NUNCA se activa
  // por este camino — la única barrera contra un `null` persistido es el
  // DTO. `@ValidateIf` solo saltea cuando la propiedad falta (undefined); un
  // `null` explícito sigue cayendo en `@IsIn`, que lo rechaza.
  @ValidateIf((o: CreateItemDto) => o.clasificacionTributaria !== undefined)
  @IsIn(['afecto', 'exento'])
  clasificacionTributaria?: string;

  // Extensión producto
  @IsIn(['cantidad', 'lote', 'serie'])
  @IsOptional()
  modoInventario?: string;

  @IsNumberString()
  @IsOptional()
  stock?: string;

  @IsString()
  @IsOptional()
  unidadMedida?: string;

  @IsDateString()
  @IsOptional()
  fechaElaboracion?: string;

  @IsDateString()
  @IsOptional()
  fechaVencimiento?: string;

  // Dinero: entra a `costo_actual`, base del costeo (CPP) y del margen. `>= 0` —
  // mercadería de donación o muestra tiene costo 0 de verdad. En `UpdateItemDto` no
  // hace falta: ahí el campo lo rechaza entero `CostoNoEditableConstraint`.
  @IsNumberString()
  @IsDecimalNoNegativo()
  @IsOptional()
  costo?: string;

  // Carga inicial modo 'serie'
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SerieInputDto)
  @IsOptional()
  series?: SerieInputDto[];

  // Carga inicial modo 'lote'
  @ValidateNested()
  @Type(() => LoteInputDto)
  @IsOptional()
  lote?: LoteInputDto;

  // Extensión receta
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecetaIngredienteInputDto)
  @IsOptional()
  ingredientes?: RecetaIngredienteInputDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecetaExtraInputDto)
  @IsOptional()
  extrasPermitidos?: RecetaExtraInputDto[];

  // Extensión combo
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComboComponenteInputDto)
  @IsOptional()
  componentes?: ComboComponenteInputDto[];

  // Asociación de grupos de modificadores (combo | receta)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemGrupoModificadorInputDto)
  @IsOptional()
  gruposModificadores?: ItemGrupoModificadorInputDto[];

  // Extensión servicio
  @IsInt()
  @Min(0)
  @IsOptional()
  duracionEstimada?: number;

  @IsBoolean()
  @IsOptional()
  requiereCita?: boolean;

  // Extensión suscripción
  @IsIn(['semanal', 'quincenal', 'mensual'])
  @IsOptional()
  frecuencia?: string;

  // Reglas N:M
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  impuestosIds?: string[];

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  recargosIds?: string[];

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  descuentosIds?: string[];
}
