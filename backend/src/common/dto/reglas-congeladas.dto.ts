import type { ReglaResuelta } from '../../modules/calculo-precios/calculo-precios.engine';

/**
 * Las reglas de catálogo —descuentos y recargos— que regían sobre un ítem
 * **cuando se pidió** una línea de cuenta, resueltas y congeladas ahí.
 *
 * Decisión del owner (2026-08-30), *lo pedido se cobra como se pidió*: poner un
 * 20% con la mesa sentada no le llega a lo que ya pidió, y sacarlo tampoco se lo
 * quita. Se guardan **resueltas y no por id** porque congelar el id dejaría
 * pasar el cambio de un 20% a un 30%: la regla seguiría siendo la misma y el
 * valor no.
 *
 * ⚠️ **Impuestos no.** Son fiscales, se siguen leyendo vivos al cobrar y
 * congelarlos abre su propio frente (ADR-010).
 *
 * Vive en `common/` y no en el módulo de precios ni en el de salones porque lo
 * comparten los tres: la entidad que lo persiste (`cuenta_lineas`), el service
 * que lo produce (`CalculoPreciosService.congelarReglasDeItem`) y el que lo
 * escribe (`SalonesService.agregarLinea`). Tenerlo en cualquiera de esos dos
 * ataba la entidad de un módulo al service de otro.
 *
 * Lo que se persiste **es la regla resuelta del motor**, así que el tipo la
 * nombra en vez de re-declararla: `ReglaResuelta` vive en
 * `calculo-precios.engine.ts`, que es puro —su único import es `decimal.js`, sin
 * NestJS ni entidades— y es la definición canónica de qué es una regla ya
 * resuelta. Copiar sus campos acá crearía una segunda definición que deriva; un
 * tipo laxo (`{ id: string }`) obligaría al motor a castear para leer la plata.
 *
 * El objeto guardado lleva además `nivel`, que el motor no lee: la validación de
 * nivel corre al **asociar** y al resolver por id, y una línea que trae sus
 * reglas congeladas no pasa por ahí. Viaja igual, en el jsonb.
 *
 * ⚠️ La huella que compara dos líneas serializa la regla **entera**
 * (`hashReglasCongeladas`), no una lista de campos elegidos: una lista blanca
 * falla en silencio cada vez que el motor gana un campo, y ya falló una vez con
 * `codigo`.
 */
export type ReglaCongelada = ReglaResuelta;

export interface ReglasCongeladas {
  descuentos: ReglaCongelada[];
  recargos: ReglaCongelada[];
}
