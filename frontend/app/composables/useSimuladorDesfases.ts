import type { AplicarDesfaseItem, DesfaseRecetaDto } from '~/components/RecetasDesfasesPanel.vue'

/**
 * Estado y lógica del simulador de impacto de costos en recetas ("desfases").
 * Se dispara tras cualquier movimiento que cambie el costo de un producto o
 * ingrediente — una entrada por compra o un ajuste de costo — nunca desde la
 * edición manual del item (el costo ya no se edita ahí).
 *
 * Compartido entre `configuracion/items.vue` (tras una compra, tab de ajuste
 * de stock) e `inventario.vue` (tras un ajuste de costo).
 */
export function useSimuladorDesfases() {
  const { public: { apiUrl } } = useRuntimeConfig()
  const toast = useToast()

  const desfasesOpen = ref(false)
  const desfasesLoading = ref(false)
  const desfasesFilas = ref<DesfaseRecetaDto[]>([])
  const desfasesHighlightId = ref<string | null>(null)

  async function maybeAbrirDesfases(productoId: string) {
    try {
      const filas = await useApiFetch<DesfaseRecetaDto[]>(
        `${apiUrl}/items/${productoId}/recetas-afectadas`,
      )
      if (filas.length) {
        desfasesFilas.value = filas
        desfasesHighlightId.value = productoId
        desfasesOpen.value = true
      }
    } catch { /* no bloquear el flujo que disparó el chequeo */ }
  }

  /**
   * `onAplicado` es opcional: lo usan las páginas que mantienen una lista local
   * de items (p. ej. `configuracion/items.vue`) para reflejar el costo/precio
   * propuesto sin refetch. `inventario.vue` no la necesita.
   */
  async function onAplicarDesfases(
    aplicados: AplicarDesfaseItem[],
    onAplicado?: (fila: DesfaseRecetaDto, aplicado: AplicarDesfaseItem) => void,
  ) {
    desfasesLoading.value = true
    try {
      await useApiFetch(`${apiUrl}/recetas/desfases/aplicar`, {
        method: 'POST',
        body: { items: aplicados },
      })
      if (onAplicado) {
        const byId = new Map(aplicados.map(a => [a.recetaItemId, a]))
        for (const fila of desfasesFilas.value) {
          const aplicado = byId.get(fila.recetaItemId)
          if (aplicado) onAplicado(fila, aplicado)
        }
      }
      toast.add({ title: 'Costos de recetas actualizados', color: 'success' })
      desfasesOpen.value = false
    } catch (e) {
      toast.add({ title: apiErrorMsg(e, 'Error al aplicar desfases'), color: 'error' })
    } finally {
      desfasesLoading.value = false
    }
  }

  async function onDescartarDesfases(recetaItemIds: string[]) {
    desfasesLoading.value = true
    try {
      await useApiFetch(`${apiUrl}/recetas/desfases/descartar`, {
        method: 'POST',
        body: { recetaItemIds },
      })
      toast.add({ title: 'Avisos descartados', color: 'success' })
      desfasesOpen.value = false
    } catch (e) {
      toast.add({ title: apiErrorMsg(e, 'Error al descartar desfases'), color: 'error' })
    } finally {
      desfasesLoading.value = false
    }
  }

  return {
    desfasesOpen,
    desfasesLoading,
    desfasesFilas,
    desfasesHighlightId,
    maybeAbrirDesfases,
    onAplicarDesfases,
    onDescartarDesfases,
  }
}
