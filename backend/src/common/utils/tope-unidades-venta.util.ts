import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';

/**
 * **Cuántas unidades (o kilos) puede sumar una venta o una mesa: 99.999.**
 * Decisión del owner del 2026-10-06, por AskUserQuestion de la Sesión de
 * esfuerzo máximo, sobre 9.999 y 999.999. La reconfirmó con el peor caso
 * medido: ~0,5 s para `/calcular` y para el resto de los usuarios, y ~2 s
 * para quien cobra una venta de 99.999 unidades con un 2x1.
 *
 * Sin tope, la cantidad la elegía el cliente y el motor de promociones trabaja
 * por unidad: con un 2x1, 10⁶ unidades tardaban 4–5 s con el event loop tomado
 * para todos los tenants, y una venta de 16.384 unidades ya daba 500 al
 * guardar sus trazas. Es **por venta y no por línea** porque el costo depende
 * de las unidades de toda la venta: 500 líneas de 9.999 se cuelgan igual. Cada
 * línea queda acotada por el mismo número, en el borde (`@IsDecimalHasta`).
 * Ver `docs/features/motor-promociones.md` § El tope de unidades.
 */
export const MAX_UNIDADES_POR_VENTA = '99999';

/**
 * **Cuántas líneas puede tener una venta: 500.** El POS junta el mismo
 * producto en una línea, pero una cuenta de salón no: dos pedidos del mismo
 * plato con distinta personalización son dos líneas, y una mesa grande o una
 * fusión las acumula. 500 deja pasar esa mesa. Cada línea cuesta unas queries
 * (receta, grupos, stock): 500 líneas de receta tardan ~1,1 s (medido el
 * 2026-10-06), y el body de 100 kB dejaba pasar ~1.500.
 *
 * Una sola constante porque son el mismo carro visto desde tres puertas:
 * `CreateVentaDto.lineas`, `CalcularVentaDto.lineas` (la precuenta del salón
 * manda ahí todas las líneas de la cuenta) y la cuenta de salón misma, que lo
 * hace cumplir al pedir y al fusionar. Si la cuenta aceptara más que
 * `/calcular`, la mesa se quedaría sin precuenta. Y lo mismo hacia atrás: las
 * devoluciones de una nota de crédito o un reembolso son una por ítem distinto
 * de la venta, así que su tope es este (con menos se corta una nota válida).
 */
export const MAX_LINEAS_POR_VENTA = 500;

/**
 * **Cuántas veces entra una misma cosa en un plato: 99.** Decisión del owner
 * del 2026-10-08, por AskUserQuestion de la Sesión de esfuerzo máximo, sobre
 * 99.999 (el tope de una venta, que no ataja el tipeo) y un tope configurable
 * por extra (pantalla aparte). La escena: el garzón tipea 30.000 en vez de 3 en
 * "queso extra" y la hamburguesa queda en $15 M. Para 50 hamburguesas iguales se
 * sube la `cantidad` de la línea: el tope es por plato y no limita un pedido
 * grande.
 *
 * Acota las unidades de un extra (`PersonalizacionExtraInputDto.unidades`), el
 * `max` de un grupo de modificadores (`ItemGrupoModificadorInputDto.max`, que
 * acota las unidades elegidas del grupo) y la `cantidad` de un componente de
 * combo (`ComboComponenteInputDto.cantidad`, que la personalización recorre una
 * vez por unidad: 10^7 tardaban 11 s). El owner lo fijó para los extras y para
 * el componente de combo (2026-10-08); el `max` de grupo lo derivó del de los
 * extras la Sesión de esfuerzo máximo. Sin tope, 10^12 unidades de un extra de
 * $500 desbordaban `precio_unitario` NUMERIC(18,4) y la línea de cuenta o la
 * venta daban 500 (medido el 2026-10-08).
 *
 * Es `number` porque lo lee `@Max`; para `@IsDecimalHasta`, `String(...)`.
 *
 * Tiene una gemela exacta en el frontend, `MAX_UNIDADES_POR_PLATO` de
 * `frontend/app/composables/useRecetaPersonalizacion.ts`: es el `max` del input
 * de unidades del extra en el drawer de personalización, para que el garzón no
 * pueda pedir lo que este número rechaza. Back y front no comparten paquete: al
 * tocar una punta, tocar la otra.
 */
export const MAX_UNIDADES_POR_PLATO = 99;

const formato = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 4 });

/**
 * 400 si las cantidades suman más que `MAX_UNIDADES_POR_VENTA`. `que` nombra
 * el documento en el mensaje: "una venta" o "una mesa".
 */
export function assertTopeUnidadesVenta(
  cantidades: Iterable<string | Decimal>,
  que: 'una venta' | 'una mesa',
): void {
  let total = new Decimal(0);
  for (const c of cantidades) total = total.plus(c);
  if (total.greaterThan(MAX_UNIDADES_POR_VENTA)) {
    throw new BadRequestException(
      `${que.charAt(0).toUpperCase()}${que.slice(1)} puede llevar hasta ${formato.format(Number(MAX_UNIDADES_POR_VENTA))} unidades en total, y esta suma ${formato.format(total.toNumber())}`,
    );
  }
}
