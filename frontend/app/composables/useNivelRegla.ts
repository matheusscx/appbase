import { conTimeout } from '~/utils/con-timeout'

/** Dónde se aplica una regla de descuento/recargo. Espeja `NivelRegla` del backend. */
export type NivelRegla = 'linea' | 'venta'

/** Solo el nivel que LLEVA badge. `'linea'` es el caso esperado y no se marca
 *  —mismo criterio que `useVigenciaRegla`, que tipa su Record igual para no
 *  dejar una entrada que nadie lee. */
const ETIQUETA: Record<Exclude<NivelRegla, 'linea'>, string> = {
  venta: 'Por venta',
}

/**
 * Cuántos nombres entran en el mensaje antes de resumir. Es un tope de lectura,
 * no de datos, y se aplica **por grupo**: hasta 5 vivos y hasta 5 de la
 * papelera, cada uno con su propio "y N más". El porqué de contarlos separados
 * está en `itemsQueLoTienen`.
 */
const MAX_NOMBRES = 5

/** Una fila de `GET /:id/uso`. `eliminado` puede no venir (impuestos no lo manda). */
interface ItemDeUso {
  nombre: string
  eliminado?: boolean
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
  // En el setup del composable, no dentro de la función async: es el patrón que
  // usan `usePausaRegla` y las dos pantallas, y evita la única llamada a un
  // composable de Nuxt fuera de setup que tenía este archivo.
  const { public: { apiUrl } } = useRuntimeConfig()

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

  /**
   * Los ítems que tienen una regla, **nombrados**, para cuando el guardado falla
   * al pasarla a nivel venta.
   *
   * El backend rechaza ese cambio contando las filas puente **incluidas las de
   * ítems en la papelera** —tiene que contarlas, el soft delete no las borra—,
   * así que el admin leía *"1 ítem todavía lo tiene"* sin forma de saber cuál: la
   * salida era restaurar a ciegas, editar y volver a borrar. `GET /:id/uso`
   * devuelve los borrados marcados justamente para esto (decisión del owner,
   * 2026-08-25).
   *
   * ⚠️ **No puede tapar el error que el usuario vino a leer, ni demorarlo sin
   * techo**, porque corre DENTRO del `catch` del guardado y el toast lo espera.
   * Dos defensas, y las dos hacen falta: devuelve `undefined` en vez de tirar (un
   * GET que **falla**), y corta a los 2 s con `conTimeout` (un GET que
   * **cuelga**). Sin lo segundo, un `/uso` que no responde dejaba al usuario sin
   * ningún error y con el botón de guardar trabado, porque el `finally` que apaga
   * `saving` corre después del toast.
   *
   * 📌 **Sí demora, y eso es deliberado: hasta 2 s en el peor caso.** El toast del
   * error espera esta consulta a propósito —mostrarlo primero y completarlo
   * después significaría dos toasts para un solo fallo—. Lo que el tope garantiza
   * no es que no demore, es que la demora tenga techo.
   *
   * Vive en el composable y no en cada `.vue` porque las dos pantallas de reglas
   * son gemelas y ya lo tuvieron duplicado: es la regla de `CLAUDE.md` sobre
   * utilidades de presentación, y acá además es lo que permite testearlo.
   */
  async function itemsQueLoTienen(
    recurso: 'descuentos' | 'recargos',
    id: string,
    msTope = 2000,
  ): Promise<string | undefined> {
    try {
      // `conTimeout` RECHAZA al vencer, y acá eso es exactamente lo que hace
      // falta: el `catch` de abajo ya devuelve `undefined`, así que colgarse y
      // fallar terminan igual sin escribir una rama más. Se usa el helper del
      // repo en vez de un `Promise.race` propio — había uno acá y era una
      // segunda implementación del mismo techo, que es de las que divergen.
      const uso = await conTimeout(
        useApiFetch<{ items: ItemDeUso[] }>(`${apiUrl}/${recurso}/${id}/uso`),
        msTope,
        'timeout consultando el uso de la regla',
      )
      if (!uso.items.length) return undefined
      // ⚠️ **El tope se cuenta por GRUPO, no sobre la lista entera**, y esa es toda
      // la decisión: los de la papelera son los que el admin no puede ver por
      // ningún otro lado —son la razón de que este mensaje exista—, mientras que
      // los vivos los encuentra en la pantalla de ítems.
      //
      // Una primera versión recortaba la lista entera. Como el backend devuelve
      // los borrados AL FINAL (`ORDER BY (eliminado_el IS NOT NULL)`), una regla
      // con 5 ítems vivos y 1 en la papelera decía "y 1 más" y el invisible
      // seguía invisible: el tope tapaba justo lo que la feature vino a mostrar.
      //
      // La segunda los dejó SIN tope, y eso era el otro extremo: una regla con 50
      // asociaciones borradas armaba un toast de 50 nombres, que no se lee. Con un
      // presupuesto por grupo los dos casos quedan cubiertos — el borrado nunca se
      // esconde detrás de los vivos, y su propia cola dice cuántos faltan.
      const vivos = uso.items.filter(i => !i.eliminado).map(i => i.nombre)
      const borrados = uso.items
        .filter(i => i.eliminado)
        .map(i => `${i.nombre} (en la papelera)`)
      const nombres = [...vivos.slice(0, MAX_NOMBRES), ...borrados.slice(0, MAX_NOMBRES)]
      const colas: string[] = []
      if (vivos.length > MAX_NOMBRES) colas.push(`${vivos.length - MAX_NOMBRES} más`)
      if (borrados.length > MAX_NOMBRES) {
        colas.push(`${borrados.length - MAX_NOMBRES} más en la papelera`)
      }
      const resumen = colas.length
        ? `${nombres.join(', ')} y ${colas.join(', y ')}`
        : nombres.join(', ')
      return `Lo tienen: ${resumen}`
    }
    catch {
      return undefined
    }
  }

  return { nivelOptions, nivelLabel, itemsQueLoTienen }
}
