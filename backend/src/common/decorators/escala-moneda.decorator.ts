import 'reflect-metadata';

export const ESCALA_MONEDA_KEY = 'escala:montoCobrado';
export const ESCALA_COSTO_KEY = 'escala:costo';

/**
 * Acumula `key` en la lista de campos marcados de la clase que declara el
 * campo. `getMetadata` recorre la cadena de prototipos, así que un DTO que
 * extiende a otro hereda los campos marcados del padre y les suma los propios.
 */
function marcarCampo(
  clave: string,
  target: object,
  key: string | symbol,
): void {
  const campos: string[] =
    (Reflect.getMetadata(clave, target.constructor) as string[]) ?? [];
  Reflect.defineMetadata(clave, [...campos, key as string], target.constructor);
}

/**
 * El campo es un monto COBRADO: se valida contra los decimales de la moneda
 * oficial del tenant (CLP no admite ninguno, USD admite dos). Lo hace efectivo
 * `EscalaMonedaPipe`; la marca por sí sola no valida nada.
 *
 * Se combina con `@IsNumberString()`, que valida el formato: acá solo se
 * valida la escala del VALOR.
 */
export const EsMontoCobrado = (): PropertyDecorator => (target, key) =>
  marcarCampo(ESCALA_MONEDA_KEY, target, key);

/**
 * El campo es un COSTO o una TASA: escala fija en `ESCALA_COSTO` (4), la
 * misma para todos los tenants, porque no es plata cobrada sino dinero por
 * unidad de otra cosa (ver `common/constants/escalas.ts`).
 */
export const EsCosto = (): PropertyDecorator => (target, key) =>
  marcarCampo(ESCALA_COSTO_KEY, target, key);
