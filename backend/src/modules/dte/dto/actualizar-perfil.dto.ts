import {
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { MAX_INT } from '../../../common/constants/escalas';
import type { AmbienteSii } from '../entities/dte-caf.entity';

/**
 * Datos de la razón social emisora que pide la boleta electrónica. Todos opcionales (omitir =
 * no tocar) y ninguno acepta `null`: las columnas se borran con un texto vacío, no con null
 * (`docs/patterns/backend.md` § 3). Los topes son los largos del SII (giro 80, comuna 20) y el
 * rango del `integer` de la columna.
 */
export class ActualizarPerfilDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(80)
  giro?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(20)
  comuna?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['certificacion', 'produccion'])
  ambienteSii?: AmbienteSii;

  /** `FchResol`, AAAA-MM-DD. Que sea un día real lo valida el service (`validarFecha`). */
  @ValidateIf((_o, v) => v !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaResolucion?: string;

  /** `NroResol`: 0 es válido (es el de la resolución de certificación). */
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_INT)
  numeroResolucion?: number;
}
