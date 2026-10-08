import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  IsDecimalHasta,
  IsDecimalNoNegativo,
} from '../../../common/decorators/decimal-signo.decorator';
import { EsCosto } from '../../../common/decorators/escala-moneda.decorator';
import { EsFechaOTimestamp } from '../../../common/decorators/fecha-pura.decorator';
import { MAX_INT } from '../../../common/constants/escalas';
import { MAX_UNIDADES_POR_PLATO } from '../../../common/utils/tope-unidades-venta.util';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';

export class SerieInputDto {
  // Una serie de solo espacios no identifica nada, y `@IsNotEmpty` no la
  // distingue de contenido real (`"   "` no es `""`). `\S` pide al menos un
  // caracter visible y **deja pasar los espacios internos** —`ABC 123` es una
  // serie legítima—: lo que se rechaza es la que queda vacía al normalizar.
  // La unicidad compara sin bordes ni mayúsculas (owner, 2026-09-20), pero se
  // guarda tal como se tipeó, así que acá no se transforma el valor.
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'La serie no puede ser solo espacios' })
  // `@MaxLength` porque la serie participa de un índice único por expresión y
  // btree tiene un tope de ~2,7 KB por entrada: sin límite, una serie enorme
  // revienta el INSERT con un error de Postgres sin mapear —un 500 en el mismo
  // chokepoint que da 400 para todo lo demás—. 100 es el valor que ya usan los
  // códigos de este repo, y un IMEI son 15 caracteres.
  @MaxLength(100)
  serie: string;

  @IsIn(['nuevo', 'usado', 'reacondicionado'])
  @IsOptional()
  condicion?: string;

  @EsFechaOTimestamp()
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

  @EsFechaOTimestamp()
  @IsOptional()
  fechaElaboracion?: string;

  @EsFechaOTimestamp()
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
  // `@EsCosto()` (escala 4): mismo lado que `precioBase`, es precio por unidad
  // del extra y el monto sale de multiplicarlo, no de este campo.
  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsCosto()
  precioExtra: string;
}

export class ComboComponenteInputDto {
  @IsUUID()
  componenteItemId: string;

  // Cuántas unidades del componente lleva el combo: la personalización recorre
  // una vez por unidad, y con 10^7 `/calcular` tardaba 11 s. Tope del owner
  // (2026-10-08): `MAX_UNIDADES_POR_PLATO`.
  @IsNumberString()
  @IsDecimalHasta(String(MAX_UNIDADES_POR_PLATO))
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
  @EsCosto()
  precioExtra?: string;
}

export class ItemGrupoModificadorInputDto {
  @IsUUID()
  grupoModificadorId: string;

  // `min` y `orden` van a columnas `int` de `item_grupo_modificador`.
  @IsInt()
  @Min(0)
  @Max(MAX_INT)
  min: number;

  // `max` acota las `unidades` que se eligen del grupo en un plato: mismo tope
  // que las de un extra (`MAX_UNIDADES_POR_PLATO`). El owner fijó 99 para los
  // extras (2026-10-08); este lo derivó de ahí la Sesión de esfuerzo máximo.
  @IsInt()
  @Min(1)
  @Max(MAX_UNIDADES_POR_PLATO)
  max: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(MAX_INT)
  orden?: number;

  @IsArray()
  // Las opciones de un grupo: mismo tope que `CreateGrupoModificadorDto`.
  @ArrayMaxSize(100)
  @IsOptional()
  @IsObject({ each: true })
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
  //
  // `@EsCosto()` (escala 4) y no `@EsMontoCobrado()`: el precio de lista es
  // dinero **por unidad** —una tasa—, y la frontera tasa→monto se cruza en la
  // multiplicación por la cantidad, no acá. Hay ítems costeados por gramo,
  // donde cuantizar el precio unitario a peso entero mete error ×1000 al
  // vender un kilo. Mismo criterio que `AplicarDesfaseItemDto.precioBase`.
  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsCosto()
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

  @EsFechaOTimestamp()
  @IsOptional()
  fechaElaboracion?: string;

  @EsFechaOTimestamp()
  @IsOptional()
  fechaVencimiento?: string;

  // Dinero: entra a `costo_actual`, base del costeo (CPP) y del margen. `>= 0` —
  // mercadería de donación o muestra tiene costo 0 de verdad, distinto de "no sé
  // cuánto costó" (`null`, que es lo único que cae en `?sinCosto=true`). En
  // `UpdateItemDto` no hace falta: ahí el campo lo rechaza entero
  // `CostoNoEditableConstraint`.
  // ⚠️ Este comentario describió durante meses un caso INALCANZABLE: el service
  // exigía `> 0` después del DTO, así que ningún ítem podía quedar en
  // `costo_actual = '0'`. Se alineó el 2026-08-29 (`validarCostoNoNegativo`), y
  // por eso el caso lo fija un e2e —`costeo-cpp.e2e-spec.ts`— y no solo el test
  // de este DTO, que pasaba en verde mientras la API rebotaba.
  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsCosto()
  @IsOptional()
  costo?: string;

  // Carga inicial modo 'serie'
  @IsArray()
  // `@ArrayMaxSize(200)`, el mismo tope que ya usa `LineaCompraDto.series`: sin
  // él, una tanda de decenas de miles de series entra entera al `unnest` del
  // guard y al loop de INSERT.
  @ArrayMaxSize(200)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => SerieInputDto)
  @IsOptional()
  series?: SerieInputDto[];

  // Carga inicial modo 'lote'
  // `IsObject` además de `ValidateNested`: este deja pasar un array, que con
  // stock inicial reventaba el alta en un 500.
  @IsObject()
  @ValidateNested()
  @Type(() => LoteInputDto)
  @IsOptional()
  lote?: LoteInputDto;

  // Extensión receta
  @IsArray()
  // Ingredientes de una receta; un INSERT por ingrediente. Es también el tope
  // de `PersonalizacionRecetaDto.omitidos`.
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => RecetaIngredienteInputDto)
  @IsOptional()
  ingredientes?: RecetaIngredienteInputDto[];

  @IsArray()
  // Extras de una receta; un INSERT por extra. Es también el tope de
  // `PersonalizacionRecetaDto.extras`.
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => RecetaExtraInputDto)
  @IsOptional()
  extrasPermitidos?: RecetaExtraInputDto[];

  // Extensión combo
  @IsArray()
  // Componentes de un combo; un INSERT por componente.
  @ArrayMaxSize(50)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ComboComponenteInputDto)
  @IsOptional()
  componentes?: ComboComponenteInputDto[];

  // Asociación de grupos de modificadores (combo | receta)
  @IsArray()
  // Grupos de un ítem; unas cuatro queries por grupo. Es también el tope de
  // `PersonalizacionRecetaDto.grupos`.
  @ArrayMaxSize(50)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ItemGrupoModificadorInputDto)
  @IsOptional()
  gruposModificadores?: ItemGrupoModificadorInputDto[];

  // Extensión servicio. Columna `int` de `item_servicio`.
  @IsInt()
  @Min(0)
  @Max(MAX_INT)
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
  // `@IdEnMinusculas` + `@ArrayUnique`: un id repetido —también `[x, X]`— daba un
  // 400 que mentía ("no pertenecen a este tenant") en vez de decir qué pasa.
  // Reglas del catálogo del tenant; un INSERT por id.
  @ArrayMaxSize(50)
  @IdEnMinusculas()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  impuestosIds?: string[];

  @IsArray()
  // Reglas del catálogo del tenant; un INSERT por id.
  @ArrayMaxSize(50)
  @IdEnMinusculas()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  recargosIds?: string[];

  @IsArray()
  // Reglas del catálogo del tenant; un INSERT por id.
  @ArrayMaxSize(50)
  @IdEnMinusculas()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  descuentosIds?: string[];
}
