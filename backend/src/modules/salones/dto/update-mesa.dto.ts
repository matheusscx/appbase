import {
  IsEnum,
  IsNumber,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { FormaMesa, TamanoMesa } from '../entities/mesa.entity';

// `@ValidateIf` y no `@IsOptional()` en los campos de columnas NOT NULL:
// `IsOptional` trata `null` igual que ausente y saltea el validador de abajo, y
// el `null` llegaba a la columna como un 500 de Postgres en vez de un 400.
// Omitir un campo conserva el valor que tenía.
export class UpdateMesaDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  nombre?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0)
  @Max(1)
  posX?: number;

  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0)
  @Max(1)
  posY?: number;

  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(FormaMesa)
  forma?: FormaMesa;

  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(TamanoMesa)
  tamano?: TamanoMesa;
}
