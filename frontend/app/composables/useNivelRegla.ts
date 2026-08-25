/** Dónde se aplica una regla de descuento/recargo. Espeja `NivelRegla` del backend. */
export type NivelRegla = 'linea' | 'venta'

/** Solo el nivel que LLEVA badge. `'linea'` es el caso esperado y no se marca
 *  —mismo criterio que `useVigenciaRegla`, que tipa su Record igual para no
 *  dejar una entrada que nadie lee. */
const ETIQUETA: Record<Exclude<NivelRegla, 'linea'>, string> = {
  venta: 'Por venta',
}

/**
 * El nivel de una regla, en el lenguaje del local, para las pantallas de
 * `configuracion/descuentos` y `configuracion/recargos`.
 *
 * La diferencia no es de presentación: una regla de nivel línea se asocia a
 * ítems y se mide contra la línea; una de nivel venta se elige al cobrar y se
 * mide contra el total. El backend hace cumplir las dos puertas
 * (`ItemsService.validarReglas` y `CalculoPreciosService.resolverReglas`), así
 * que acá el trabajo es que se ENTIENDA cuál se está eligiendo — un radio con
 * dos etiquetas abstractas ("línea" / "venta") no lo logra, de ahí el texto de
 * ayuda con el caso concreto.
 */
export function useNivelRegla() {
  /** Opciones del radio del formulario, en el orden en que se explican. */
  const nivelOptions: { label: string, value: NivelRegla, description: string }[] = [
    {
      label: 'A cada ítem',
      value: 'linea',
      description: 'Se asocia a productos del catálogo y se descuenta línea por línea.',
    },
    {
      label: 'Al total de la venta',
      value: 'venta',
      description: 'Se elige al cobrar y se aplica sobre el total, no sobre un producto.',
    },
  ]

  /**
   * `undefined` para `'linea'`: esa fila no lleva badge. Mismo criterio que
   * `vigenciaLabel` — se marca la excepción, no el caso esperado, que además es
   * el default de la columna y hoy es la enorme mayoría de las filas.
   */
  function nivelLabel(nivel: NivelRegla | undefined): string | undefined {
    return nivel === 'venta' ? ETIQUETA.venta : undefined
  }

  return { nivelOptions, nivelLabel }
}
