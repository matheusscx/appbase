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
  // SIN `@EsMontoCobrado()`, a diferencia del resto de la plata que entra por
  // API: el `precioBase` que se aplica acá es **la sugerencia que calcula el
  // propio backend**, y `ItemsService.precioSugerido` la devuelve con
  // `.toFixed(4)` (fijado en `items.service.spec.ts` con '2596.1538').
  // Marcarlo hace que la API rechace con 400 su propia sugerencia en CLP
  // —medido: rompe `simulador-costos.e2e-spec.ts`, "compra → afectadas →
  // aplicar con precio"— y con ella la bandeja de desfases entera. Cerrar el
  // hueco acá exige decidir antes a qué escala se sugiere el precio, que es el
  // motor de precios y no esta tarea.
  @IsNumberString()
  @IsDecimalNoNegativo()
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
