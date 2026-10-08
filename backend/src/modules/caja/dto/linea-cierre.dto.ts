import {
  ArrayUnique,
  IsNumberString,
  IsUUID,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';

const medioDe = (linea: { metodoPagoId?: unknown }): unknown =>
  linea.metodoPagoId;

/**
 * Una línea por medio de pago en el conteo, la fase 2 y el `PATCH` de motivos:
 * un repetido es 400 y no se suma ni se elige uno (orquestadora, 2026-10-08).
 * `CajaService` cruza las líneas con el arqueo por un `Map` que se quedaba con
 * la última: medido, `[tarjeta 4.500, tarjeta 5.000]` contra 5.000 esperados
 * cerraba la caja cuadrada y descartaba los 4.500 sin aviso. Compara después
 * de `@IdEnMinusculas`, así que `[x, X]` es un repetido; dos líneas de
 * efectivo (`null`) también.
 */
export const UnaLineaPorMedio = (): PropertyDecorator =>
  ArrayUnique(medioDe, {
    message: ({ value }: ValidationArguments) => {
      // `ArrayUnique` también falla con algo que no es un array; ese 400 ya lo
      // explica `@IsArray`.
      if (!Array.isArray(value)) return 'lineas debe ser un array';
      const medios = (value as ({ metodoPagoId?: unknown } | null)[]).map(
        (l) => (l != null ? medioDe(l) : l),
      );
      const repetido = medios.find((m, i) => medios.indexOf(m) !== i);
      // Este mensaje llega al cliente solo si ninguna línea tiene un error
      // propio: con uno, el `ValidationPipe` de Nest devuelve los de las líneas
      // y descarta los de `lineas` (`mapChildrenToValidationErrors`). Así que el
      // repetido es un UUID, ya en minúsculas, `null` (el efectivo), o nada:
      // arrays en vez de líneas (`[[], []]`, o líneas válidas anidadas), que no
      // tienen `metodoPagoId`.
      if (repetido === null)
        return 'El medio de pago efectivo viene en más de una línea: va una sola por medio';
      if (typeof repetido === 'string')
        return `El medio de pago ${repetido} viene en más de una línea: va una sola por medio`;
      return 'Hay más de una línea sin un medio de pago válido';
    },
  });

export class LineaCierreDto {
  // null = la línea de efectivo agregada. En minúsculas: `CajaService` la
  // busca en el arqueo de la base por un `Map`, y en mayúsculas daba 400 "Método
  // de pago no pertenece al arqueo" (medido el 2026-10-08).
  @ValidateIf((_o, v) => v !== null)
  @IdEnMinusculas()
  @IsUUID('4')
  metodoPagoId: string | null;

  // Admite decimales (dinero = Decimal.js). NO usar { no_symbols: true }: rechaza
  // el punto decimal y rompió 6 e2e el 2026-07-23.
  // 0 es legítimo (ese método no tuvo movimiento); nunca negativo.
  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsMontoCobrado()
  montoContado: string;
}
