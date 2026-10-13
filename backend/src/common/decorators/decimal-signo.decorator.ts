import { registerDecorator, type ValidationOptions } from 'class-validator';
import Decimal from 'decimal.js';
import {
  cabeEnColumnaDePlata,
  ESCALA_PERSISTIDA,
  techoFormateado,
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
 * Valida que un monto suelto quepa en la columna `NUMERIC(18, escala)` donde se
 * guarda (`cabeEnColumnaDePlata`); por default la de plata del proyecto,
 * `NUMERIC(18,4)`. Sin esto, un monto de 10^14 o más pasaba el DTO y daba 500
 * en el `INSERT` (medido el 2026-10-09: el pago de una venta o de un abono en
 * efectivo, un pago a proveedor, y una salida de caja sin saldo, cuyo rastro
 * desbordaba `caja_intentos_rechazados.monto_solicitado`; el 2026-10-12, los
 * demás `@EsMontoCobrado` y `@EsCosto` que se guardan).
 *
 * Mira el campo **tal como llega**: un campo que solo se compara no tiene
 * columna que desbordar, y lo que el service deriva de él (un costo pasado a la
 * unidad base, una suma) se mira en el service, después de derivarlo. La `escala` es la de la columna, no la de la
 * moneda: `tenants.monto_tolerancia` es `NUMERIC(18,6)` y su techo es 10^12.
 * Qué escala lleva cada campo lo ata `monto-persistible-cobertura.spec.ts` a la
 * metadata de la entity. Se combina con `@IsNumberString()`, igual que los de
 * arriba.
 */
export function IsMontoPersistible(
  escala: number = ESCALA_PERSISTIDA,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMontoPersistible',
      target: object.constructor,
      propertyName,
      constraints: [escala],
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          try {
            return cabeEnColumnaDePlata(value, escala);
          } catch {
            return false;
          }
        },
        defaultMessage(): string {
          return `${propertyName} no puede ser de $${techoFormateado(escala)} o más: el sistema no puede guardar montos así`;
        },
      },
    });
  };
}

/**
 * El mismo techo que `IsMontoPersistible`, para lo que no es plata: una
 * cantidad, un peso de reparto, un porcentaje, una tasa de cambio. Por eso pide
 * la precisión además de la escala —un porcentaje en `NUMERIC(10,6)` no cabe
 * desde 10^4— y el mensaje no lleva `$`. Sin esto, un valor que no cabe pasaba
 * el DTO y daba 500 en el `INSERT` (medido el 2026-10-13: la tasa del día, el
 * conteo de un recuento, el porcentaje y el peso del reparto de propinas, el
 * porcentaje sugerido de una propina y el `valorPorcentaje` de un `nxm`).
 *
 * Es un techo de COLUMNA, no una regla de negocio: donde el negocio pone un
 * tope más bajo (un porcentaje de descuento menor a 1), ese tope lo valida
 * quien lo decide y este no hace falta. Qué precisión y escala lleva cada campo
 * lo ata `monto-persistible-cobertura.spec.ts` a la metadata de la entity.
 */
export function IsDecimalPersistible(
  precision: number,
  escala: number,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isDecimalPersistible',
      target: object.constructor,
      propertyName,
      constraints: [precision, escala],
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          try {
            return cabeEnColumnaDePlata(value, escala, precision);
          } catch {
            return false;
          }
        },
        defaultMessage(): string {
          return `${propertyName} no puede ser de ${techoFormateado(escala, precision)} o más: el sistema no puede guardar valores así`;
        },
      },
    });
  };
}
