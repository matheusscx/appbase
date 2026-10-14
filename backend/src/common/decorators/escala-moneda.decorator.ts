import 'reflect-metadata';

export const ESCALA_MONEDA_KEY = 'escala:montoCobrado';
export const ESCALA_COSTO_KEY = 'escala:costo';
export const ESCALA_COSTO_MENSAJE_KEY = 'escala:costo:mensaje';
export const ESCALA_CANTIDAD_KEY = 'escala:cantidad';
export const ESCALA_CANTIDAD_MENSAJE_KEY = 'escala:cantidad:mensaje';

const MENSAJE_CANTIDAD = 'La cantidad admite como máximo 4 decimales.';

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
 *
 * `mensaje` reemplaza el del 400 cuando el genérico no le dice nada a quien
 * tipea: el porcentaje de un impuesto lo carga un admin, que piensa en "19%" y
 * no en "escala de costos y tasas".
 */
export const EsCosto =
  (mensaje?: string): PropertyDecorator =>
  (target, key) => {
    marcarCampo(ESCALA_COSTO_KEY, target, key);
    if (mensaje === undefined) return;
    guardarMensaje(ESCALA_COSTO_MENSAJE_KEY, target, key, mensaje);
  };

/**
 * El campo es una CANTIDAD: escala fija en `ESCALA_CANTIDAD` (4), la de sus
 * columnas `NUMERIC(18,4)`. Con más decimales es 400 y no se guarda (owner,
 * 2026-10-13): sin esto Postgres redondeaba en silencio, en la venta, la nota
 * de crédito y el kardex. Lo hace efectivo `EscalaMonedaPipe`, igual que las
 * otras dos marcas.
 *
 * También la llevan los pesos del reparto de propinas (owner, 2026-10-13): no
 * son cantidades, pero van a una columna `NUMERIC(18,4)` y se redondeaban igual.
 *
 * Siempre lleva mensaje, porque lo lee quien atiende el local: el genérico
 * dice "la cantidad", y un campo que el local llama distinto (el conteo, el
 * stock inicial) pasa el suyo.
 */
export const EsCantidad =
  (mensaje = MENSAJE_CANTIDAD): PropertyDecorator =>
  (target, key) => {
    marcarCampo(ESCALA_CANTIDAD_KEY, target, key);
    guardarMensaje(ESCALA_CANTIDAD_MENSAJE_KEY, target, key, mensaje);
  };

/** Acumula el mensaje propio de un campo marcado, por clase, como `marcarCampo`. */
function guardarMensaje(
  clave: string,
  target: object,
  key: string | symbol,
  mensaje: string,
): void {
  const mensajes: Record<string, string> =
    (Reflect.getMetadata(clave, target.constructor) as
      | Record<string, string>
      | undefined) ?? {};
  Reflect.defineMetadata(
    clave,
    { ...mensajes, [key as string]: mensaje },
    target.constructor,
  );
}
