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
