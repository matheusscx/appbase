import { Matches } from 'class-validator';

/**
 * El PIN que el garzón elige para sí mismo.
 *
 * **No pide el PIN anterior**, a diferencia de `UpdateContrasenaDto`. Es
 * deliberado: el caso principal de esta pantalla es el olvido, y exigir el
 * viejo la dejaría sin salida — que es exactamente el problema que se está
 * arreglando. La cuenta es el ancla: el JWT ya probó quién es, y el PIN es un
 * factor **menor** que la cuenta, no otro igual.
 *
 * La confirmación se valida en el service (no acá) porque `class-validator` no
 * compara dos campos entre sí sin un decorador propio, y el proyecto no tiene
 * ninguno — mismo criterio que `UpdateContrasenaDto`, que también deja la
 * comparación afuera.
 */
export class FijarPinDto {
  @Matches(/^\d{6}$/, { message: 'El PIN debe tener exactamente 6 dígitos' })
  pin: string;

  @Matches(/^\d{6}$/, { message: 'El PIN debe tener exactamente 6 dígitos' })
  confirmarPin: string;
}
