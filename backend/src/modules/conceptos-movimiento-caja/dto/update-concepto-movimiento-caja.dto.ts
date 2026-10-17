import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  TIPOS_CONCEPTO,
  type TipoConcepto,
} from './create-concepto-movimiento-caja.dto';

// `ValidateIf(v !== undefined)` y no `IsOptional`: este último trata `null` como
// ausente y se saltea todos los validadores (las columnas son NOT NULL → 500).
export class UpdateConceptoMovimientoCajaDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(TIPOS_CONCEPTO)
  tipo?: TipoConcepto;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  activo?: boolean;
}
