import type { AplicarDesfaseItem, DesfaseItemDto } from '~/components/DesfasesPanel.vue'

/**
 * Estado y lógica del simulador de impacto de costos en recetas y combos
 * ("desfases").
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
  const desfasesFilas = ref<DesfaseItemDto[]>([])
  const desfasesHighlightId = ref<string | null>(null)

  async function maybeAbrirDesfases(productoId: string) {
    try {
      const filas = await useApiFetch<DesfaseItemDto[]>(
        `${apiUrl}/items/${productoId}/afectados`,
      )
      if (filas.length) {
        desfasesFilas.value = filas
        desfasesHighlightId.value = productoId
        desfasesOpen.value = true
      }
    } catch { /* no bloquear el flujo que disparó el chequeo */ }
  }

  interface AplicarResponse {
    aplicados: number
    omitidos: { itemId: string, nombre: string, motivo: string }[]
    afectados: DesfaseItemDto[]
  }

  /**
   * `onAplicado` es opcional: lo usan las páginas que mantienen una lista local
   * de items (p. ej. `configuracion/items.vue`) para reflejar el costo/precio
   * propuesto sin refetch. `inventario.vue` no la necesita.
   */
  async function onAplicarDesfases(
    aplicados: AplicarDesfaseItem[],
    onAplicado?: (fila: DesfaseItemDto, aplicado: AplicarDesfaseItem) => void,
  ) {
    desfasesLoading.value = true
    try {
      const res = await useApiFetch<AplicarResponse>(`${apiUrl}/desfases/aplicar`, {
        method: 'POST',
        body: { items: aplicados },
      })
      // Un combo del lote puede volver en `omitidos` (dependía de una receta
      // del mismo lote): el backend no lo escribió, así que `onAplicado` no se
      // llama para él — reflejar ese costo localmente sería mentir sobre lo
      // que quedó persistido.
      const omitidosIds = new Set(res.omitidos.map(o => o.itemId))
      if (onAplicado) {
        const byId = new Map(aplicados.map(a => [a.itemId, a]))
        for (const fila of desfasesFilas.value) {
          if (omitidosIds.has(fila.itemId)) continue
          const aplicado = byId.get(fila.itemId)
          if (aplicado) onAplicado(fila, aplicado)
        }
      }
      // Mismo criterio que la bandeja (`pages/desfases.vue`): se sacan solo las
      // filas que el backend efectivamente escribió, y las que el usuario
      // deseleccionó se conservan. Pisar la lista con `afectados` las hacía
      // desaparecer de la vista sin haberse resuelto ni descartado.
      const aplicadosIds = new Set(
        aplicados.map(a => a.itemId).filter(id => !omitidosIds.has(id)),
      )
      const afectadosIds = new Set(res.afectados.map(f => f.itemId))
      // Segunda pasada: los combos que quedaron desfasados por las recetas
      // recién aplicadas se resuelven acá mismo en vez de esperar en la bandeja.
      desfasesFilas.value = [
        ...desfasesFilas.value.filter(
          f => !aplicadosIds.has(f.itemId) && !afectadosIds.has(f.itemId),
        ),
        ...res.afectados,
      ]
      if (res.omitidos.length) {
        toast.add({
          title: `${res.omitidos.length} combo(s) se recalcularon y vuelven a proponerse`,
          color: 'warning',
        })
      }
      if (res.afectados.length) {
        toast.add({
          title: `${res.afectados.length} combo(s) quedaron desfasados por este cambio`,
          color: 'info',
        })
      } else {
        toast.add({ title: 'Costos actualizados', color: 'success' })
        desfasesOpen.value = false
      }
    } catch (e) {
      toast.add({ title: apiErrorMsg(e, 'Error al aplicar desfases'), color: 'error' })
    } finally {
      desfasesLoading.value = false
    }
  }

  async function onDescartarDesfases(itemIds: string[]) {
    desfasesLoading.value = true
    try {
      await useApiFetch(`${apiUrl}/desfases/descartar`, {
        method: 'POST',
        body: { itemIds },
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
