import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';
import type { TipoPromocion } from '../entities/promocion.entity';

/**
 * Un slot de la promo (la Condición): qué se le pide al cliente para que
 * aplique. La correspondencia `tipoScope ↔ categoriaId/itemIds` es regla
 * entre hermanos —un decorador no la lee— y la valida el service, espejo del
 * `chk_promocion_scopes_categoria` de la entidad.
 * Diseño: docs/superpowers/specs/2026-08-27-motor-promociones-design.md
 */
export class ScopePromoDto {
  @IsIn(['items', 'categoria', 'venta'])
  tipoScope: 'items' | 'categoria' | 'venta';

  @IsOptional()
  @IsUUID()
  categoriaId?: string | null;

  /** Solo significa algo en `precio_fijo`: cuántas unidades pide este slot. */
  @IsOptional()
  @IsInt()
  @Min(1)
  cantidad?: number;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  itemIds?: string[];
}

/**
 * El beneficio va inline (Fase 1: una promo tiene exactamente uno). La
 * correspondencia `tipo ↔ valorPorcentaje/cadaN/valorMonto` es regla entre
 * hermanos y la valida el service, espejo de `chk_promociones_valor_segun_tipo`.
 */
export class CreatePromocionDto {
  @IsString()
  @MinLength(1)
  nombre: string;

  @IsOptional()
  @IsString()
  descripcion?: string | null;

  /**
   * Pausa. Ausente en `create()` = `true` (el default de la columna); en
   * `update()` es cómo se pausa/reactiva por API — sin este campo la pausa
   * de la spec quedaba inalcanzable (ruling del plan).
   */
  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsIn(['porcentaje', 'nxm', 'precio_fijo'])
  tipo: TipoPromocion;

  // Los dos NOT NULL: el guardarraíl heredado de eliminar `promocional`. Una
  // campaña sin fecha de fin no se acepta.
  @IsDateString()
  fechaInicio: string;

  @IsDateString()
  fechaFin: string;

  // Franja en hora local del tenant; inicio > fin = cruza medianoche. Que las
  // dos vengan juntas o ninguna es regla entre hermanos: la valida el service.
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  horaInicio?: string | null;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  horaFin?: string | null;

  /** ISO-8601: 1=lunes…7=domingo. Ausente/null = todos los días. */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  diasSemana?: number[] | null;

  @IsOptional()
  @IsIn(['fisico', 'online'])
  canal?: 'fisico' | 'online' | null;

  /** `porcentaje` y `nxm`. Decimal: 2x1 = '1.0000', "2do al 50%" = '0.5000'. */
  @IsOptional()
  @IsNumberString()
  valorPorcentaje?: string | null;

  /** Solo `nxm`: 2x1→2, 3x2→3. */
  @IsOptional()
  @IsInt()
  @Min(2)
  cadaN?: number | null;

  /** Solo `precio_fijo`: el precio del conjunto en moneda oficial. */
  @IsOptional()
  @IsNumberString()
  @IsDecimalPositivo()
  @EsMontoCobrado()
  valorMonto?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ScopePromoDto)
  scopes: ScopePromoDto[];
}
