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
 * El tipo **solo promete `id`**, y eso también es deliberado: lo que se persiste
 * es la regla resuelta entera (`ReglaResueltaConNivel` le calza), pero nombrar
 * sus campos acá obligaría a este archivo a seguir al motor. Con `id` alcanza
 * para lo único que el consumidor genérico necesita —ordenar— y el jsonb guarda
 * el resto igual. La huella que compara dos líneas serializa la regla entera
 * justamente por eso (`hashReglasCongeladas`): una lista blanca de campos falla
 * en silencio cada vez que el motor gana uno, y ya falló una vez con `codigo`.
 */
export type ReglaCongelada = { id: string };

export interface ReglasCongeladas {
  descuentos: ReglaCongelada[];
  recargos: ReglaCongelada[];
}
