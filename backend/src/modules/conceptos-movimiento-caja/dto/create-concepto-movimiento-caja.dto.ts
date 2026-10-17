import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export const TIPOS_CONCEPTO = ['entrada', 'salida', 'ambos'] as const;
export type TipoConcepto = (typeof TIPOS_CONCEPTO)[number];

export class CreateConceptoMovimientoCajaDto {
  // `trim` antes de validar: `'   '` tiene que fallar igual que `''`.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre: string;

  @IsOptional()
  @IsIn(TIPOS_CONCEPTO)
  tipo?: TipoConcepto;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
