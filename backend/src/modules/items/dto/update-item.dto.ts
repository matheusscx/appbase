import {
  IsString,
  IsNotEmpty,
  IsNumberString,
  IsUUID,
  IsBoolean,
  IsOptional,
  IsDateString,
  IsInt,
  IsIn,
  Min,
  IsArray,
  ValidateNested,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  RecetaExtraInputDto,
  RecetaIngredienteInputDto,
  ComboComponenteInputDto,
  ItemGrupoModificadorInputDto,
} from './create-item.dto';

@ValidatorConstraint({ name: 'costoNoEditable', async: false })
export class CostoNoEditableConstraint implements ValidatorConstraintInterface {
  validate(): boolean {
    return false;
  }

  defaultMessage(): string {
    return 'El costo no se edita desde el item: usá Inventario → Ajuste de costo';
  }
}

@ValidatorConstraint({ name: 'stockNoEditable', async: false })
export class StockNoEditableConstraint implements ValidatorConstraintInterface {
  validate(): boolean {
    return false;
  }

  defaultMessage(): string {
    return 'El stock no se edita desde el item: usá PATCH /items/:id/stock (ajuste con motivo) o un recuento de inventario';
  }
}

export class UpdateItemDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  nombre?: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsNumberString()
  @IsOptional()
  precioBase?: string;

  @IsUUID()
  @IsOptional()
  monedaId?: string;

  @IsUUID()
  @IsOptional()
  categoriaId?: string;

  @IsBoolean()
  @IsOptional()
  precioIncluyeImpuesto?: boolean;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;

  @IsOptional()
  @IsIn(['afecto', 'exento'])
  clasificacionTributaria?: string;

  // Extensión producto
  @IsIn(['cantidad', 'lote', 'serie'])
  @IsOptional()
  modoInventario?: string;

  // El stock ya no se edita desde el item: es una consecuencia de mover
  // mercadería (ajuste de stock) o de un recuento de inventario auditado. El
  // campo se conserva —en vez de borrarse— por la misma razón que `costo`:
  // el ValidationPipe global usa whitelist sin forbidNonWhitelisted, así que
  // borrarlo haría que la propiedad se descarte en silencio y el request
  // devuelva 200 sin cambiar nada.
  // @ValidateIf (no @IsOptional): ver la nota en `costo` — un `null` explícito
  // debe seguir cayendo en el validador que siempre rechaza.
  @ValidateIf((o: UpdateItemDto) => o.stock !== undefined)
  @Validate(StockNoEditableConstraint)
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

  // El costo ya no se edita desde el item: es una consecuencia de mover
  // mercadería (compra) o de una corrección auditada (ajuste de costo).
  // El campo se conserva —en vez de borrarse— porque el ValidationPipe global
  // usa whitelist sin forbidNonWhitelisted: borrarlo haría que la propiedad se
  // descarte en silencio y el request devuelva 200 sin cambiar nada.
  // @ValidateIf (no @IsOptional): @IsOptional también saltea la validación
  // cuando el valor es `null` explícito, no solo cuando falta la propiedad —
  // eso dejaría pasar `{ "costo": null }` con 200. @ValidateIf solo saltea
  // cuando la propiedad falta (undefined), así que un `null` explícito sigue
  // cayendo en el validador que siempre rechaza.
  @ValidateIf((o: UpdateItemDto) => o.costo !== undefined)
  @Validate(CostoNoEditableConstraint)
  costo?: string;

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

  // Extensión receta (reemplazo total de la lista)
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

  // Extensión combo (reemplazo total de la lista)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComboComponenteInputDto)
  @IsOptional()
  componentes?: ComboComponenteInputDto[];

  // Asociación de grupos de modificadores (combo | receta, reemplazo total)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemGrupoModificadorInputDto)
  @IsOptional()
  gruposModificadores?: ItemGrupoModificadorInputDto[];

  // Reglas N:M (undefined = no tocar; [] = limpiar todas)
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
