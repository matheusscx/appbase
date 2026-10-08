/**
 * Escala de los COSTOS y de las TASAS (dinero por unidad de otra cosa): 4
 * decimales. No es la escala de la moneda: hay ítems costeados por gramo
 * (mínimo medido en dev: 5.0000/g), y cuantizar eso a peso entero mete hasta
 * 10% de error por gramo, ×1000 al costear un kilo.
 *
 * Decisión (a) del 2026-08-20. La escala de los montos COBRADOS es la de la
 * moneda y la aplica el motor al cerrar el documento — ver ConfigCalculo.
 */
export const ESCALA_COSTO = 4;

/**
 * Lo que cabe en una columna entera de Postgres. Un entero de la API que va a
 * una de estas columnas lleva `@Max` con su tope: sin él, uno más grande pasa
 * `@IsInt()` y revienta en el INSERT con un 500 ("out of range for type
 * integer"), medido el 2026-10-08.
 */
export const MAX_INT = 2147483647;
export const MAX_SMALLINT = 32767;
