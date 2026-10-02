import {
  IsString,
  IsNotEmpty,
  IsNumberString,
  IsUUID,
  IsBoolean,
  IsOptional,
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
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';
import { EsCosto } from '../../../common/decorators/escala-moneda.decorator';
import { EsFechaOTimestamp } from '../../../common/decorators/fecha-pura.decorator';

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

// `@ValidateIf` y no `@IsOptional()` en todo campo cuya columna es NOT NULL y
// en todas las listas, por lo mismo que `costo`/`stock` (ver su nota): un `null`
// explícito saltaba el validador y llegaba al service, que lo escribía en la
// columna o le pedía `.length`/`for…of` —500— o, en las listas que no aplican al
// tipo del ítem, lo ignoraba con un 200. Omitir un campo conserva el valor.
// Conservan `@IsOptional()` los de columna nullable, donde `null` borra el dato:
// `descripcion`, `categoriaId`, las fechas del producto y `duracionEstimada`.
export class UpdateItemDto {
  @IsString()
  @IsNotEmpty()
  @ValidateIf((_o, v) => v !== undefined)
  nombre?: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  // Mismo criterio que en `CreateItemDto`: no negativo, con el `0` válido, y
  // `@EsCosto()` porque el precio de lista es dinero por unidad (una tasa).
  // La marca acá no es redundante con la de `CreateItemDto`: hasta que el
  // `PATCH` se colgó del pipe, el precio se validaba al crear el ítem y **no**
  // al editarlo, que es peor que no validarlo en ningún lado — daba cobertura
  // aparente y el atajo era crear y después editar.
  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsCosto()
  @ValidateIf((_o, v) => v !== undefined)
  precioBase?: string;

  @IsUUID()
  @ValidateIf((_o, v) => v !== undefined)
  monedaId?: string;

  @IsUUID()
  @IsOptional()
  categoriaId?: string;

  @IsBoolean()
  @ValidateIf((_o, v) => v !== undefined)
  precioIncluyeImpuesto?: boolean;

  @IsBoolean()
  @ValidateIf((_o, v) => v !== undefined)
  activo?: boolean;

  // @ValidateIf (no @IsOptional): mismo motivo que `costo`/`stock` arriba —
  // @IsOptional() también saltea la validación cuando el valor es `null`
  // explícito, no solo cuando la propiedad falta. Eso dejaría pasar
  // `{ "clasificacionTributaria": null }` con 200 y, sin el `NOT NULL` que
  // tenía la columna antes de que se volviera nullable, el `UPDATE` lo
  // persistiría en silencio — un producto sin IVA sin que nadie lo pida
  // explícitamente. @ValidateIf solo saltea cuando la propiedad falta
  // (undefined); un `null` explícito sigue cayendo en `@IsIn`, que lo rechaza
  // porque `null` no es `'afecto'` ni `'exento'`.
  @ValidateIf((o: UpdateItemDto) => o.clasificacionTributaria !== undefined)
  @IsIn(['afecto', 'exento'])
  clasificacionTributaria?: string;

  // Extensión producto
  @IsIn(['cantidad', 'lote', 'serie'])
  @ValidateIf((_o, v) => v !== undefined)
  modoInventario?: string;

  // El stock ya no se edita desde el item: es una consecuencia de mover
  // mercadería (ajuste de stock) o de un recuento de inventario auditado. El
  // campo se conserva —en vez de borrarse— por la misma razón que `costo`: el
  // 400 dice dónde sí se edita.
  // @ValidateIf (no @IsOptional): ver la nota en `costo` — un `null` explícito
  // debe seguir cayendo en el validador que siempre rechaza.
  @ValidateIf((o: UpdateItemDto) => o.stock !== undefined)
  @Validate(StockNoEditableConstraint)
  stock?: string;

  @IsString()
  @ValidateIf((_o, v) => v !== undefined)
  unidadMedida?: string;

  @EsFechaOTimestamp()
  @IsOptional()
  fechaElaboracion?: string;

  @EsFechaOTimestamp()
  @IsOptional()
  fechaVencimiento?: string;

  // El costo ya no se edita desde el item: es una consecuencia de mover
  // mercadería (compra) o de una corrección auditada (ajuste de costo).
  // El campo se conserva —en vez de borrarse— por el mensaje: sin declararlo el
  // pipe global igual lo rechaza (`forbidNonWhitelisted`), pero con un
  // "property costo should not exist" que no dice adónde ir. Hasta el
  // 2026-09-27 había además otro motivo, que ya no rige: sin
  // `forbidNonWhitelisted`, borrarlo lo descartaba en silencio con 200. Lo
  // fija `costeo-cpp.e2e-spec.ts` ("rechaza el costo con mensaje explícito").
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
  @ValidateIf((_o, v) => v !== undefined)
  requiereCita?: boolean;

  // Extensión suscripción
  @IsIn(['semanal', 'quincenal', 'mensual'])
  @ValidateIf((_o, v) => v !== undefined)
  frecuencia?: string;

  // Extensión receta (reemplazo total de la lista)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecetaIngredienteInputDto)
  @ValidateIf((_o, v) => v !== undefined)
  ingredientes?: RecetaIngredienteInputDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecetaExtraInputDto)
  @ValidateIf((_o, v) => v !== undefined)
  extrasPermitidos?: RecetaExtraInputDto[];

  // Extensión combo (reemplazo total de la lista)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComboComponenteInputDto)
  @ValidateIf((_o, v) => v !== undefined)
  componentes?: ComboComponenteInputDto[];

  // Asociación de grupos de modificadores (combo | receta, reemplazo total)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemGrupoModificadorInputDto)
  @ValidateIf((_o, v) => v !== undefined)
  gruposModificadores?: ItemGrupoModificadorInputDto[];

  // Reglas N:M (undefined = no tocar; [] = limpiar todas)
  @IsArray()
  @IsUUID('4', { each: true })
  @ValidateIf((_o, v) => v !== undefined)
  impuestosIds?: string[];

  @IsArray()
  @IsUUID('4', { each: true })
  @ValidateIf((_o, v) => v !== undefined)
  recargosIds?: string[];

  @IsArray()
  @IsUUID('4', { each: true })
  @ValidateIf((_o, v) => v !== undefined)
  descuentosIds?: string[];
}
