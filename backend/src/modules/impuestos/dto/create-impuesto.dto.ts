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
import { EsCosto } from '../../../common/decorators/escala-moneda.decorator';

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
export const MENSAJE_DECIMALES_PORCENTAJE_IMPUESTO =
  'El porcentaje admite hasta 4 decimales: 0.1234 = 12,34%';

export class CreateImpuestoDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  // `@EsCosto(mensaje)`: el porcentaje es una tasa, y la escala de las tasas
  // (`ESCALA_COSTO`, 4) es la de su columna, `NUMERIC(7,4)`. Si una de las dos
  // cambia, la otra tiene que acompañar. Lo que traía más decimales Postgres lo
  // redondeaba al guardar, sin aviso, y 0.00001 quedaba 0.0000 —un impuesto del
  // 0%, "sin impuesto" con forma de impuesto—. Decisión del owner (2026-10-12,
  // por AskUserQuestion, con la escena y el costo de cada opción): "Rechazar con
  // aviso". La marca sola no valida: la hace efectiva el `EscalaMonedaPipe` del
  // controller.
  @IsNumberString()
  @EsCosto(MENSAJE_DECIMALES_PORCENTAJE_IMPUESTO)
  @IsDecimalPositivo()
  @IsDecimalHasta(TOPE_PORCENTAJE_IMPUESTO, {
    message: MENSAJE_TOPE_PORCENTAJE_IMPUESTO,
  })
  porcentaje: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
