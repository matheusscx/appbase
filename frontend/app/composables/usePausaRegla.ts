import type { Ref } from 'vue'
import { useApiFetch } from './useApiFetch'
import type { NivelRegla } from './useNivelRegla'

/** Lo mínimo que este composable necesita de la fila para poder pausarla. */
export interface ReglaPausable {
  id: string
  nombre: string
  activo: boolean
  eliminadoEl?: string | null
}

interface UsoRegla {
  /**
   * Ausente en impuestos, que no tienen nivel: se trata como `'linea'`, que es
   * lo que un impuesto es —se asocia a ítems—.
   */
  nivel?: NivelRegla
  /**
   * ⚠️ **Incluye los ítems en la papelera**, marcados con `eliminado`. El
   * endpoint tiene dos consumidores que piden cosas distintas: este modal los
   * DESCARTA —para pausar, un ítem borrado es ruido— y el 400 del cambio de
   * nivel los necesita, porque son justamente los que el admin no puede ver.
   * Ver `obtenerUso` en los services.
   *
   * `eliminado` es opcional para no romper a los impuestos, cuyo `/uso` no lo
   * devuelve: ahí `undefined` es falsy y todos cuentan como vivos, que es lo
   * correcto —ese endpoint sí filtra los borrados—.
   */
  items: { id: string, nombre: string, eliminado?: boolean }[]
}

/**
 * Pausar y reactivar una regla del catálogo, con la confirmación que dice a
 * cuántos ítems afecta.
 *
 * Pausar **no es eliminar**: la regla deja de aplicarse pero conserva sus
 * asociaciones, y reactivarla la devuelve como estaba. De ahí las dos asimetrías
 * que el flujo tiene a propósito:
 *
 * - **Reactivar no pregunta nada**, porque no saca nada de circulación.
 * - **Pausar solo pregunta cuando hay algo que perder de vista**: si ningún ítem
 *   usa la regla, se pausa directo, sin modal. Un diálogo que dice "0 ítems" es
 *   ruido, y el ruido enseña a confirmar sin leer.
 *
 * ⚠️ **Una regla de nivel venta SIEMPRE pregunta**, aunque el conteo sea 0. No
 * es una excepción a la regla de arriba sino su aplicación: una regla de venta
 * no se asocia a ningún ítem —no tiene tabla puente—, así que su conteo es 0
 * por construcción y siempre lo será. Está disponible en toda venta, que es
 * mucho más que "nada", y hasta el 2026-08-25 esto la pausaba sin preguntar
 * mientras la pantalla juraba que afectaba a 0 ítems.
 *
 * Si el `GET .../uso` falla, el toggle **no se mueve**: sin saber a cuántos
 * ítems afecta, no se pausa a ciegas.
 *
 * Guards que NO viven acá: los que son regla del recurso, no del pausar. El
 * catálogo oficial de impuestos (`origen === 'sistema'`) se filtra en su
 * pantalla, donde está esa regla.
 *
 * @param recurso  Segmento de la API (`descuentos`, `recargos`, `impuestos`).
 * @param etiqueta Nombre en singular para los avisos (`Descuento`).
 * @param lista    La lista que rinde la tabla. `confirmarPausar` busca ahí por
 *   id en vez de retener la fila: entre abrir el modal y confirmar, un
 *   `cargar()` pudo reemplazar los objetos, y mutar el viejo no se vería.
 */
export function usePausaRegla<T extends ReglaPausable>(
  recurso: string,
  etiqueta: string,
  lista: Ref<T[]>,
) {
  const apiUrl = useRuntimeConfig().public.apiUrl
  const toast = useToast()

  /** Ids con un PATCH en vuelo: su switch queda deshabilitado. */
  const toggling = reactive(new Set<string>())
  // Mientras una consulta de uso está en vuelo no se dispara otra: así una
  // respuesta obsoleta no puede pisar el modal de un click posterior sobre otra
  // fila. Mismo guard que `verificandoEliminarId` en `configuracion/items.vue`.
  const verificandoUsoId = ref<string | null>(null)

  const confirmPausarId = ref<string | null>(null)
  // Nombre y conteo se fijan JUNTO al id en vez de buscarse en la lista al
  // renderizar: con el modal abierto el listado puede recargarse (toggle de la
  // papelera) y el diálogo quedaría nombrando otra fila.
  const confirmPausarNombre = ref('')
  const confirmPausarItems = ref(0)
  const confirmPausarNivel = ref<NivelRegla>('linea')
  const confirmPausarModalOpen = ref(false)

  async function aplicarActivo(regla: T, activo: boolean) {
    toggling.add(regla.id)
    const prev = regla.activo
    regla.activo = activo
    try {
      await useApiFetch(`${apiUrl}/${recurso}/${regla.id}`, {
        method: 'PATCH',
        body: { activo: regla.activo },
      })
      toast.add({
        title: `${etiqueta} ${regla.activo ? 'activado' : 'pausado'}`,
        color: 'success',
      })
    }
    catch (e: unknown) {
      regla.activo = prev
      toast.add({ title: apiErrorMsg(e, 'Error al actualizar'), color: 'error' })
    }
    finally {
      toggling.delete(regla.id)
    }
  }

  async function toggleActivo(regla: T) {
    if (regla.eliminadoEl) return
    if (toggling.has(regla.id)) return
    // Reactivar no pregunta nada: no destruye nada.
    if (!regla.activo) {
      await aplicarActivo(regla, true)
      return
    }
    if (verificandoUsoId.value) return
    verificandoUsoId.value = regla.id
    try {
      const uso = await useApiFetch<UsoRegla>(`${apiUrl}/${recurso}/${regla.id}/uso`)
      const nivel = uso.nivel ?? 'linea'
      // Solo los vivos, en las DOS lecturas. Contar los borrados acá tendría
      // dos efectos y los dos son mentira: una regla cuya única asociación está
      // en la papelera dejaría de pausarse en silencio para abrir un modal, y
      // el modal diría un número de ítems afectados que el admin no ve en
      // ningún lado.
      const vivos = uso.items.filter(i => !i.eliminado)
      if (nivel === 'linea' && vivos.length === 0) {
        await aplicarActivo(regla, false)
        return
      }
      confirmPausarId.value = regla.id
      confirmPausarNombre.value = regla.nombre
      confirmPausarItems.value = vivos.length
      confirmPausarNivel.value = nivel
      confirmPausarModalOpen.value = true
    }
    catch (e: unknown) {
      // El toggle NO se mueve: sin saber a cuántos ítems afecta, no se pausa a
      // ciegas.
      const msg = apiErrorMsg(e, `Error al verificar el uso del ${etiqueta.toLowerCase()}`)
      toast.add({ title: msg, color: 'error' })
    }
    finally {
      verificandoUsoId.value = null
    }
  }

  function cerrarPausar() {
    confirmPausarId.value = null
    confirmPausarNombre.value = ''
    confirmPausarItems.value = 0
    confirmPausarNivel.value = 'linea'
    confirmPausarModalOpen.value = false
  }

  async function confirmarPausar() {
    const regla = lista.value.find(x => x.id === confirmPausarId.value)
    cerrarPausar()
    if (regla) await aplicarActivo(regla, false)
  }

  return {
    toggling,
    confirmPausarNombre,
    confirmPausarItems,
    confirmPausarNivel,
    confirmPausarModalOpen,
    toggleActivo,
    cerrarPausar,
    confirmarPausar,
  }
}
