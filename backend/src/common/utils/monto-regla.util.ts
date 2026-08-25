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
 * ✅ **Desde el 2026-08-23 la unidad la lleva la COLUMNA, no el modo.** El
 * importe se guarda en `valor_monto` **o** en `valor_porcentaje`, nunca en las
 * dos (CHECK de tabla). El `modo` sigue existiendo —es la clave de orden del
 * motor y lo que se congela en la venta— pero acá solo dice cuál de las dos
 * columnas puede venir llena. Consecuencia: aquel `50` ambiguo ya **no es
 * expresable**, porque `50` en `valorMonto` son cincuenta pesos y en
 * `valorPorcentaje` se rechaza por no ser decimal.
 *
 * ⚠️ El frontend NO tiene gemelo de esto: `configuracion/descuentos.vue` y
 * `configuracion/recargos.vue` eligen el input por comodidad. El backend es el
 * único enforcement.
 */

/**
 * Tipos de regla cuyos tramos miden **cantidad** y no plata. El resto de los
 * tipos con tramos miden monto de venta.
 *
 * Es la única lista que queda nombrando códigos para esto, y vive acá a
 * propósito: el motor ya NO decide la magnitud por el código —la decide el
 * tramo, según cuál de sus dos columnas de mínimo esté llena—. Este arreglo
 * solo se usa al ESCRIBIR, para exigir que el tramo llene la que corresponde
 * al tipo de su regla.
 */
const CODIGOS_MINIMO_POR_CANTIDAD = ['por_mayor'];

/** Una de las dos columnas de importe. La unidad ya viene decidida por cuál es. */
export interface ValoresDeRegla {
  valorMonto?: string | null;
  valorPorcentaje?: string | null;
}

/**
 * Un monto suelto. `null`/vacío no es error acá — que un tipo EXIJA importe lo
 * decide el service, que es quien sabe de qué tipo de regla se trata.
 *
 * ✅ **El cero lo admite un TRAMO y no el valor plano** (decisión del owner,
 * 2026-08-24). No es una asimetría cosmética: un tramo en 0 es lo que expresa
 * "envío gratis sobre $30.000" —los otros tramos cobran y ése es el brazo que
 * no cobra—, mientras que una regla PLANA en 0 se aplicaría en cada venta para
 * no cobrar nada. Eso último **ya se dice de otra forma**, pausándola, y esa
 * otra forma además *avisa al cajero* ("está en pausa y no se aplicó", ver el
 * `continue` de `procesarReglas`). Permitir las dos dejaría dos maneras de
 * apagar una regla, una de ellas silenciosa y a simple vista idéntica a una
 * regla rota.
 */
function validarMonto(
  unidad: 'monto' | 'porcentaje',
  valor: string | null | undefined,
  donde: 'la regla' | 'el tramo',
): void {
  if (!valor) return;
  const numero = Number(valor);
  const admiteCero = donde === 'el tramo';
  if (!Number.isFinite(numero) || numero < 0 || (numero === 0 && !admiteCero)) {
    throw new BadRequestException(
      admiteCero
        ? 'El valor de un tramo debe ser un número mayor o igual a 0'
        : 'El valor debe ser un número mayor a 0',
    );
  }
  if (unidad === 'porcentaje' && numero >= 1) {
    throw new BadRequestException(
      'El porcentaje debe expresarse en decimal (0.10 = 10%) y ser menor a 1',
    );
  }
}

/**
 * Una expresión de importe: como mucho una de las dos columnas, y la que
 * corresponde al `modo` de la regla.
 *
 * Que las dos vengan vacías NO es error acá: es el estado del valor plano de
 * una regla por tramos, que expresa su importe en `tramos[]`. **En un tramo sí
 * lo es** — ver `validarTramo`.
 *
 * ⚠️ El mensaje del tramo tiene que ser cierto por los DOS caminos con un solo
 * texto. En un `POST` el tramo que no cuadra siempre viene en el body; en un
 * `PATCH` puede ser uno guardado que el cliente no reenvió y ni siquiera sabe
 * que existe. Por eso nombra las dos procedencias en vez de afirmar una:
 * `donde` distingue regla de tramo, pero acá no llega ningún discriminador de
 * POST/PATCH, y agregarlo sería enhebrar un parámetro por los dos services
 * solo para elegir un texto.
 */
function validarExpresion(
  modo: string,
  valores: ValoresDeRegla,
  donde: 'la regla' | 'el tramo' = 'la regla',
): void {
  if (valores.valorMonto && valores.valorPorcentaje) {
    throw new BadRequestException(
      `El importe de ${donde} se expresa en una sola unidad: monto o porcentaje, no las dos`,
    );
  }
  if (modo === 'porcentaje' && valores.valorMonto) {
    throw new BadRequestException(
      donde === 'la regla'
        ? 'Esta regla es un porcentaje: el importe va en valorPorcentaje'
        : 'Esta regla es un porcentaje: hay un tramo con su importe en valorMonto. Los tramos —los que mandes, o los que ya estén guardados si no los mandás— tienen que expresarlo en valorPorcentaje',
    );
  }
  if (modo === 'monto_fijo' && valores.valorPorcentaje) {
    throw new BadRequestException(
      donde === 'la regla'
        ? 'Esta regla es un monto fijo: el importe va en valorMonto'
        : 'Esta regla es un monto fijo: hay un tramo con su importe en valorPorcentaje. Los tramos —los que mandes, o los que ya estén guardados si no los mandás— tienen que expresarlo en valorMonto',
    );
  }
  validarMonto('monto', valores.valorMonto, donde);
  validarMonto('porcentaje', valores.valorPorcentaje, donde);
}

/**
 * Un TRAMO, que tiene una obligación más que el valor plano: **exactamente
 * una** de las dos columnas, nunca ninguna.
 *
 * Un tramo sin importe no es un tramo — no expresa nada, y el motor lo
 * elegiría por magnitud para después no cobrar. Hasta el 2026-08-23 esto lo
 * tapaba el DTO, donde `valor` era obligatorio; al partirlo en dos campos que
 * por fuerza son opcionales (cuál corresponde depende del hermano `modo`, que
 * un decorador no puede leer), ese guardia desapareció y un tramo vacío llegaba
 * hasta el `CHECK` de tabla: **500 de Postgres en vez del 400 que corresponde**.
 *
 * ⚠️ **Que ahora un tramo pueda valer 0 no vuelve ambiguo este chequeo**, y se
 * midió antes de tocar nada (2026-08-24): los dos campos son `string`
 * —`@IsNumberString` rechaza un número de JSON, y TypeORM devuelve `numeric`
 * como string— y `'0'` es *truthy*, así que "sin importe" e "importe cero"
 * siguen siendo casos distintos sin escribir una línea. `pendientes.md`
 * afirmaba lo contrario; era el mismo error que ya se había corregido en
 * `validarMinimosDeTramos`. Solo diferiría si acá pudiera llegar el número 0.
 */
function validarTramo(modo: string, tramo: ValoresDeRegla): void {
  validarExpresion(modo, tramo, 'el tramo');
  if (!tramo.valorMonto && !tramo.valorPorcentaje) {
    throw new BadRequestException(
      modo === 'monto_fijo'
        ? 'Cada tramo tiene que expresar su importe en valorMonto'
        : 'Cada tramo tiene que expresar su importe en valorPorcentaje',
    );
  }
}

/**
 * Toda expresión de importe de la regla —el valor plano y el de **cada
 * tramo**— contra el mismo `modo`.
 *
 * El `modo` que se pasa es el de la fila **resultante**, no el que llegó en el
 * DTO: un `PATCH` puede no traerlo, y en `update` los tramos hay que leerlos de
 * la BD cuando el DTO no los manda.
 *
 * 📌 Antes acá había una advertencia sobre que cambiar solo el modo reinterpreta
 * valores ya guardados —un tramo de `5000` legítimo como monto fijo pasando a
 * ser 500.000%—. **Ese peligro ya no existe:** el importe no cambia de unidad al
 * cambiar el modo, porque vive en una columna que el modo nuevo deja fuera de
 * juego. Ese `PATCH` ahora falla ruidoso en vez de reinterpretar.
 */
export function validarMontosDeRegla(
  modo: string,
  valores: ValoresDeRegla,
  tramos?: ValoresDeRegla[],
): void {
  validarExpresion(modo, valores);
  for (const tramo of tramos ?? []) validarTramo(modo, tramo);
}

/**
 * **Exactamente una** forma de decir cuánto cobra: un valor único o escalones.
 *
 * Es para los tipos que admiten las dos —hoy solo los dos de método de pago—,
 * no para los que ya tienen una sola: un `directo` no elige nada y un
 * `por_monto_venta` se expresa siempre por escalones.
 *
 * ✅ **Decisión del owner, 2026-08-25.** El caso es "3% con tarjeta, y 1,5%
 * arriba de $100.000": el método de pago es la CONDICIÓN de la regla, así que
 * puede combinarse con cualquiera de las dos formas de importe. Las otras dos
 * lecturas se descartaron: obligar a escalones siempre volvía trabajoso el caso
 * común (3% y listo), y dejar que convivieran obligaba a saber cuál gana.
 *
 * ⚠️ **Que las dos juntas no sean expresables es lo que sostiene el motor.**
 * `evaluarRegla` ramifica por `tramos.length > 0` antes de mirar el valor plano,
 * o sea que una fila con las dos llenas cobraría por escalones y dejaría el
 * valor único muerto **sin aviso** — exactamente el bug que este frente vino a
 * cerrar, dado vuelta. El orden del motor no es la garantía; esta función sí.
 */
export function validarFormaDeImporte(
  importe: string | null | undefined,
  tramos?: unknown[],
): void {
  const tieneTramos = !!tramos?.length;
  if (importe && tieneTramos) {
    throw new BadRequestException(
      'El importe de esta regla se expresa de una sola forma: un valor único o escalones, no las dos',
    );
  }
  if (!importe && !tieneTramos) {
    throw new BadRequestException(
      'Esta regla tiene que expresar su importe: un valor único o al menos un escalón',
    );
  }
}

/** El mínimo de un tramo: cantidad **o** monto, nunca los dos ni ninguno. */
export interface MinimoDeTramo {
  minimoCantidad?: string | null;
  minimoMonto?: string | null;
}

/**
 * El mínimo de cada tramo, contra el TIPO de su regla.
 *
 * Va aparte de `validarMontosDeRegla` porque el discriminador es otro: el
 * importe lo decide `modo` (monto fijo vs porcentaje) y el mínimo lo decide el
 * `codigo` del tipo (por cantidad vs por monto de venta). Son dos ejes
 * independientes — un `por_mayor` puede descontar un porcentaje.
 *
 * ⚠️ **Por qué el mínimo se partió en dos columnas** (2026-08-24): una sola
 * columna significaba kilos o pesos según un hermano que ni el decorador ni el
 * motor podían leer sin un `if` con el código adentro. Partido, el tramo dice
 * por sí solo qué mide: `minimoMonto` lleva `@EsMontoCobrado()` y lo valida el
 * borde de escala —"$50.000,50" en un tenant CLP se rechaza—, mientras
 * `minimoCantidad` conserva sus decimales, que en un local que vende al peso
 * son legítimos (2,5 kg).
 */
export function validarMinimosDeTramos(
  codigo: string | null,
  tramos?: MinimoDeTramo[],
): void {
  // `codigo === null` significa "el tipo NO usa tramos". Pasa de verdad: un
  // PATCH que cambia el tipo a uno sin tramos deja los guardados huérfanos, y
  // exigirles la columna de un tipo que no mide nada rechazaba un PATCH
  // legítimo (lo cazó el e2e `ancla positiva`). En ese caso se valida la FORMA
  // —una sola columna, no negativa— que es lo que evita el 500 del CHECK de
  // tabla, y no la correspondencia con el tipo, que ahí no significa nada.
  const exigirColumnaDelTipo = codigo !== null;
  const porCantidad =
    codigo !== null && CODIGOS_MINIMO_POR_CANTIDAD.includes(codigo);
  // Unidad del primer tramo, para exigir que todos los de la regla coincidan.
  let unidadDeLaRegla: 'cantidad' | 'monto' | null = null;
  for (const tramo of tramos ?? []) {
    if (tramo.minimoCantidad && tramo.minimoMonto) {
      throw new BadRequestException(
        'El mínimo de un tramo se expresa en una sola unidad: cantidad o monto, no las dos',
      );
    }
    // `!!` alcanza y es equivalente: los dos campos son `string` (`@IsNumberString`
    // rechaza un número de JSON), y el `'0'` de "desde cero" es truthy como
    // string. Se midió con un mutante: la forma larga contra null/undefined/''
    // no cambia ni un caso, y solo diferiría si acá pudiera llegar el número 0.
    const tieneCantidad = !!tramo.minimoCantidad;
    const tieneMonto = !!tramo.minimoMonto;
    if (!tieneCantidad && !tieneMonto) {
      throw new BadRequestException(
        porCantidad
          ? 'Cada tramo tiene que expresar su mínimo en minimoCantidad'
          : 'Cada tramo tiene que expresar su mínimo en minimoMonto',
      );
    }
    if (exigirColumnaDelTipo && porCantidad && tieneMonto) {
      throw new BadRequestException(
        'Esta regla mide cantidad: el mínimo de cada tramo va en minimoCantidad',
      );
    }
    if (exigirColumnaDelTipo && !porCantidad && tieneCantidad) {
      throw new BadRequestException(
        'Esta regla mide monto de venta: el mínimo de cada tramo va en minimoMonto',
      );
    }
    // ⚠️ Todos los tramos de UNA regla miden lo mismo, y esto se exige incluso
    // cuando el tipo no usa tramos (`codigo: null`). No es una regla de negocio
    // sino de forma: `seleccionarTramo` elige el de mayor mínimo, y comparar
    // "500 unidades" contra "$100" para decidir cuál gana no significa nada en
    // ninguna lectura. Sin esto, un POST a un tipo sin tramos podía mezclarlos
    // —medido: entraba con 201— y el motor los comparaba igual, porque ramifica
    // por `tramos.length` antes que por el código del tipo.
    const unidadDelTramo = tieneCantidad ? 'cantidad' : 'monto';
    if (unidadDeLaRegla === null) unidadDeLaRegla = unidadDelTramo;
    else if (unidadDeLaRegla !== unidadDelTramo) {
      throw new BadRequestException(
        'Todos los tramos de una regla miden lo mismo: o cantidad, o monto, no una mezcla',
      );
    }

    const crudo = tieneCantidad ? tramo.minimoCantidad! : tramo.minimoMonto!;
    const numero = Number(crudo);
    if (!Number.isFinite(numero) || numero < 0) {
      throw new BadRequestException(
        'El mínimo de un tramo debe ser un número mayor o igual a 0',
      );
    }
  }
}

/**
 * El importe con el que la fila VA A QUEDAR: sobrevive solo la columna del modo
 * resultante, y la otra se **apaga**.
 *
 * Apagarla no es cosmético. Cambiar de unidad **descarta** el número viejo, no
 * lo traduce — y sin este apagado un `PATCH` que cambia de modo dejaría la
 * columna vieja llena, que es justo lo que el CHECK de tabla rechaza: saldría
 * un 500 de Postgres en vez del 400 que corresponde.
 *
 * Vive acá y no en cada service por el mismo motivo que el resto de este
 * archivo: son dos services que tienen que hacer exactamente lo mismo.
 */
export function importeResultante(
  modo: string,
  dto: ValoresDeRegla,
  actual: ValoresDeRegla,
): { valorMonto: string | null; valorPorcentaje: string | null } {
  if (modo === 'monto_fijo') {
    return {
      valorMonto:
        dto.valorMonto !== undefined
          ? (dto.valorMonto ?? null)
          : (actual.valorMonto ?? null),
      valorPorcentaje: null,
    };
  }
  return {
    valorMonto: null,
    valorPorcentaje:
      dto.valorPorcentaje !== undefined
        ? (dto.valorPorcentaje ?? null)
        : (actual.valorPorcentaje ?? null),
  };
}
