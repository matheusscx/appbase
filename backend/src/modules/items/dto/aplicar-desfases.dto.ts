import {
  IsArray,
  IsBoolean,
  IsNumberString,
  IsOptional,
  IsUUID,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';
import { EsCosto } from '../../../common/decorators/escala-moneda.decorator';

export class AplicarDesfaseItemDto {
  @IsUUID()
  itemId: string;

  @IsBoolean()
  @IsOptional()
  actualizarPrecio?: boolean;

  // Dinero. `>= 0` y no `> 0`: el `> 0` que exige el service es **condicional a
  // `actualizarPrecio`** (`items.service.ts`), y un decorador de campo no ve el otro
  // campo — pedirlo acá rechazaría `{ precioBase: '0', actualizarPrecio: false }`,
  // que hoy se acepta y se ignora. Acá solo se mata el negativo.
  //
  // `@EsCosto()` (escala 4) y NO `@EsMontoCobrado()`: un precio de lista es
  // dinero **por unidad**, o sea una tasa, y la frontera tasa→monto se cruza
  // recién en la multiplicación (`tasa × cantidad ⇒ monto`). Que sea una tasa
  // no es una tecnicidad: `ItemsService.precioSugerido` devuelve la sugerencia
  // con `.toFixed(4)` (fijado en `items.service.spec.ts` con '2596.1538'), así
  // que tratarla como monto cobrado hacía que la API rechazara con 400 su
  // propia sugerencia en CLP —medido: rompía `simulador-costos.e2e-spec.ts`,
  // "compra → afectadas → aplicar con precio", y con ella la bandeja de
  // desfases entera.
  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsCosto()
  @IsOptional()
  precioBase?: string;
}

export class AplicarDesfasesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AplicarDesfaseItemDto)
  items: AplicarDesfaseItemDto[];
}
