import { BadRequestException } from '@nestjs/common';

/**
 * Validación del monto de una regla de precio — descuentos y recargos.
 *
 * Vive acá y no en cada service porque la duplicación **ya produjo el bug**:
 * `validarValor` estaba copiada en los dos módulos, y la decisión de *cuándo
 * invocarla* repetida en cuatro lugares (`create` y `update` × dos services).
 * En dos de esos cuatro se omitió, así que un tramo `porcentaje` con `50` —el
 * typo natural de quien piensa "50%"— entraba con 201 y producía un descuento
 * del 5000%. La regla existía; se enforzaba por un camino y no por el otro.
 * Centralizarla es lo que hace que "toda expresión de monto se valida igual"
 * sea una sola línea de código en vez de un acuerdo entre copias.
 *
 * ⚠️ El frontend NO tiene gemelo de esto: `configuracion/descuentos.vue` y
 * `configuracion/recargos.vue` solo muestran el texto "Expresar en decimal:
 * 0.10 = 10%" como ayuda, sin bloquear. El backend es el único enforcement.
 */

/**
 * Un monto suelto: el `valor` plano de la regla o el de un tramo.
 * `null`/vacío no es error acá — que un tipo EXIJA valor lo decide el service,
 * que es quien sabe de qué tipo de regla se trata.
 */
function validarMonto(modo: string, valor: string | null | undefined): void {
  if (!valor) return;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) {
    throw new BadRequestException('El valor debe ser un número mayor a 0');
  }
  if (modo === 'porcentaje' && numero >= 1) {
    throw new BadRequestException(
      'El porcentaje debe expresarse en decimal (0.10 = 10%) y ser menor a 1',
    );
  }
}

/**
 * Toda expresión de monto de la regla —el `valor` plano y el de **cada
 * tramo**— con el **mismo** modo.
 *
 * El `modo` que se pasa es el de la fila **resultante**, no el que llegó en el
 * DTO: un `PATCH` puede no traerlo, y en `update` los tramos hay que leerlos de
 * la BD cuando el DTO no los manda. Cambiar solo el modo reinterpreta valores
 * ya guardados —un tramo de `5000` legítimo como monto fijo pasa a ser
 * 500.000%— y ese `PATCH` no trae tramos.
 */
export function validarMontosDeRegla(
  modo: string,
  valor: string | null | undefined,
  tramos?: { valor: string | null }[],
): void {
  validarMonto(modo, valor);
  for (const tramo of tramos ?? []) validarMonto(modo, tramo.valor);
}
