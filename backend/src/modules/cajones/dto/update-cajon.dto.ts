import {
  IsBoolean,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  IsDecimalNoNegativo,
  IsMontoPersistible,
} from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';

// `@ValidateIf` y no `@IsOptional()`: `IsOptional` trata `null` igual que
// ausente, y el service (`!= null`) lo ignoraba con un 200 sin cambiar nada.
// Omitir un campo y mandarlo en `null` son dos pedidos distintos: omitir
// conserva el valor, `null` en una columna NOT NULL es un 400.
export class UpdateCajonDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nombre?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  activo?: boolean;

  // Marca (o desmarca) la caja principal del local, donde entran los cobros de
  // mesa del garzón (02.2). Marcar una desmarca la anterior; omitir la conserva.
  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  principal?: boolean;

  // `null` SÍ es un pedido con sentido acá: quita el fondo sugerido. Omitir la
  // clave lo conserva (`undefined`); es la única columna nullable del cajón.
  @IsOptional()
  @IsNumberString()
  @IsDecimalNoNegativo()
  @IsMontoPersistible()
  @EsMontoCobrado()
  fondoSugerido?: string | null;
}
