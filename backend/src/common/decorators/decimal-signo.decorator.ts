import { registerDecorator, type ValidationOptions } from 'class-validator';
import Decimal from 'decimal.js';

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
