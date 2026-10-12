import {
  IsBoolean,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  IsDecimalHasta,
  IsDecimalPositivo,
} from '../../../common/decorators/decimal-signo.decorator';

/**
 * Un impuesto no puede superar el 100%, que en decimal es `1` (0.19 = 19%).
 * Decisión del owner (2026-10-12, por AskUserQuestion de la orquestadora, con
 * la escena y el costo de cada opción): frena el tipeo de 19 por 0.19, que se
 * guardaba como 1900%, y 10^4 —que no cabe en `NUMERIC(7,4)`— deja de ser un
 * 500. Si otro país necesita un impuesto mayor, se sube este tope.
 */
export const TOPE_PORCENTAJE_IMPUESTO = '1';
export const MENSAJE_TOPE_PORCENTAJE_IMPUESTO =
  'El porcentaje no puede superar 1 (100%): va en decimal, 0.19 = 19%';

export class CreateImpuestoDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsNumberString()
  @IsDecimalPositivo()
  @IsDecimalHasta(TOPE_PORCENTAJE_IMPUESTO, {
    message: MENSAJE_TOPE_PORCENTAJE_IMPUESTO,
  })
  porcentaje: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
