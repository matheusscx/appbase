import {
  ArrayMinSize,
  IsArray,
  IsNumberString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';
import { EsCosto } from '../../../common/decorators/escala-moneda.decorator';

export class DescartarDesfaseItemDto {
  @IsUUID()
  itemId: string;

  /**
   * El costo propuesto **que el usuario tenía en pantalla** cuando apretó
   * Descartar. No es un dato de más: es lo único que distingue "descarté esto"
   * de "descarté lo que hubiera".
   *
   * Antes acá viajaba solo el `itemId` y el servidor **recalculaba** el
   * propuesto al descartar, archivando ese. Medido contra la API el 2026-08-24:
   * el usuario veía 1120, el costo de un ingrediente cambiaba, y quedaba
   * archivado 1019,98 — un número que nunca estuvo en pantalla— con la bandeja
   * en cero filas. El desfase nuevo quedaba silenciado.
   *
   * ⚠️ **Y no hace falta ninguna carrera para llegar ahí.** El recálculo es
   * desde cero, así que cualquier cambio entre abrir la bandeja y hacer clic lo
   * dispara: el mismo usuario, en otra pestaña, con minutos de diferencia. Por
   * eso el arreglo NO es un `FOR UPDATE` —un lock cubre milisegundos, no los
   * minutos que la pantalla está abierta— sino este dato.
   *
   * `@EsCosto()` (escala 4) y no `@EsMontoCobrado()`: es un costo unitario, o
   * sea una tasa, mismo criterio que `precioBase` en `AplicarDesfaseItemDto`.
   */
  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsCosto()
  costoPropuestoVisto: string;
}

export class DescartarDesfasesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DescartarDesfaseItemDto)
  items: DescartarDesfaseItemDto[];
}
