import { registerDecorator, type ValidationOptions } from 'class-validator';
import Decimal from 'decimal.js';
import {
  cabeEnColumnaDePlata,
  TECHO_PERSISTIBLE_FORMATEADO,
} from '../utils/monto-persistible.util';

/**
 * Valida que un campo de dinero/porcentaje (string numérico, Decimal.js —
 * nunca `number` nativo) sea estrictamente positivo. Usar donde el cero no
 * tiene sentido de negocio: el monto de un movimiento de caja (el `tipo`
 * entrada/salida ya codifica el signo, así que el monto en sí nunca es 0 ni
 * negativo), el monto de un pago o de una nota de crédito.
 *
 * Se combina con `@IsNumberString()` (que ya valida el formato); acá solo se
 * valida el signo con Decimal.js.
 */
export function IsDecimalPositivo(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isDecimalPositivo',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          try {
            return new Decimal(value).gt(0);
          } catch {
            return false;
          }
        },
        defaultMessage(): string {
          return `${propertyName} debe ser mayor a cero`;
        },
      },
    });
  };
}

/**
 * Valida que un campo de dinero/porcentaje (string numérico, Decimal.js) no
 * sea negativo, permitiendo cero. Usar donde el cero es legítimo: el saldo
 * inicial de una caja (se puede abrir con el cajón vacío), un monto contado
 * en un arqueo, un descuento, una propina declarada (el cero es "sin
 * propina", un estado real, no la ausencia de dato).
 */
export function IsDecimalNoNegativo(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isDecimalNoNegativo',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          try {
            return new Decimal(value).gte(0);
          } catch {
            return false;
          }
        },
        defaultMessage(): string {
          return `${propertyName} no puede ser negativo`;
        },
      },
    });
  };
}

/**
 * Valida que un string numérico (Decimal.js) no pase de `max`, inclusive. Lo
 * usa `cantidad` de las líneas de venta y de cuenta con
 * `MAX_UNIDADES_POR_VENTA` (`tope-unidades-venta.util.ts`): una línea sola
 * tampoco puede pasar el tope de la venta entera.
 *
 * Se combina con `@IsNumberString()`, igual que los de arriba.
 */
export function IsDecimalHasta(
  max: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isDecimalHasta',
      target: object.constructor,
      propertyName,
      constraints: [max],
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          try {
            return new Decimal(value).lte(max);
          } catch {
            return false;
          }
        },
        defaultMessage(): string {
          return `${propertyName} no puede superar ${new Intl.NumberFormat('es-CL').format(Number(max))}`;
        },
      },
    });
  };
}

/**
 * Valida que un monto suelto quepa en `NUMERIC(18,4)`, la columna de plata del
 * proyecto (`cabeEnColumnaDePlata`). Sin esto, un monto de 10^14 o más pasaba
 * el DTO y daba 500 en el `INSERT` (medido el 2026-10-09: el pago de una venta
 * o de un abono en efectivo, un pago a proveedor, y una salida de caja sin
 * saldo, cuyo rastro desbordaba `caja_intentos_rechazados.monto_solicitado`).
 *
 * Solo para campos que se guardan **tal cual** en una columna `NUMERIC(18,4)`:
 * una columna de otra escala tiene otro techo. Se combina con
 * `@IsNumberString()`, igual que los de arriba.
 */
export function IsMontoPersistible(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMontoPersistible',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          try {
            return cabeEnColumnaDePlata(value);
          } catch {
            return false;
          }
        },
        defaultMessage(): string {
          return `${propertyName} no puede ser de $${TECHO_PERSISTIBLE_FORMATEADO} o más: el sistema no puede guardar montos así`;
        },
      },
    });
  };
}
