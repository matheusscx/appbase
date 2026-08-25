import type {
  AplicarDesfaseItem,
  DescartarDesfaseItem,
  DesfaseItemDto,
} from '~/components/DesfasesPanel.vue'

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

  /** Las filas afectadas por un insumo, tal como las calcula el backend hoy. */
  function traerAfectados(productoId: string) {
    return useApiFetch<DesfaseItemDto[]>(
      `${apiUrl}/items/${productoId}/afectados`,
    )
  }

  async function maybeAbrirDesfases(productoId: string) {
    try {
      const filas = await traerAfectados(productoId)
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

  interface DescartarResponse {
    descartados: number
    cambiados: { itemId: string, nombre: string, costoPropuestoActual: string }[]
  }

  async function onDescartarDesfases(items: DescartarDesfaseItem[]) {
    desfasesLoading.value = true
    try {
      const res = await useApiFetch<DescartarResponse>(`${apiUrl}/desfases/descartar`, {
        method: 'POST',
        body: { items },
      })
      if (res.cambiados.length) {
        // El drawer NO se cierra: cerrarlo escondería justo las filas que no se
        // descartaron, que es el bug que este cambio cierra.
        //
        // ⚠️ Se RECARGA la lista en vez de parchearle el `costoPropuesto` a la
        // fila que volvió, y la diferencia no es de estilo. `deltaCosto`,
        // `margenPctPropuesto` y `precioSugerido` se derivan todos del propuesto
        // (`precioSugerido = costoNuevo × precioViejo / costoViejo`), así que
        // pisar un solo campo deja una fila internamente inconsistente — y el
        // `watch` del panel reprellena el input de precio con ese
        // `precioSugerido` viejo, que `aplicar` persiste tal cual en
        // `items.precio_base`. Sería el mismo bug que este frente cierra, ahora
        // con un camino que lo escribe.
        // Sin insumo que consultar no hay de dónde recalcular: se sacan solo las
        // descartadas y las demás quedan como estaban. Una foto vieja es
        // coherente; una fila con un campo pisado, no.
        const soloLasQueQuedan = () => desfasesFilas.value.filter(
          f => !items.some(i => i.itemId === f.itemId)
            || res.cambiados.some(c => c.itemId === f.itemId),
        )
        const productoId = desfasesHighlightId.value
        // ⚠️ La recarga va en su PROPIO try: el descarte ya commiteó, así que un
        // GET caído acá no puede reportarse como "Error al descartar" — sería
        // decirle al usuario que no pasó algo que sí pasó, y encima dejando en
        // la lista las filas que el backend ya archivó. `desfases.vue` no tiene
        // el problema porque su `cargar()` contiene su propia falla.
        try {
          desfasesFilas.value = productoId
            ? await traerAfectados(productoId)
            : soloLasQueQuedan()
        }
        catch {
          desfasesFilas.value = soloLasQueQuedan()
        }
        const uno = res.cambiados[0]!
        toast.add({
          title: res.cambiados.length === 1
            ? `El costo de «${uno.nombre}» cambió mientras mirabas`
            : `${res.cambiados.length} costos cambiaron mientras mirabas`,
          description: 'Esos avisos no se descartaron. Mirá el número nuevo y decidí otra vez.',
          color: 'warning',
        })
        // El caso mixto también avisa de lo que SÍ salió: sin esto, un lote de
        // diez con una cambiada no daba ninguna señal de que las otras nueve se
        // descartaron. Mismo criterio que `desfases.vue`.
        if (res.descartados) {
          toast.add({ title: 'Avisos descartados', color: 'success' })
        }
      } else {
        toast.add({ title: 'Avisos descartados', color: 'success' })
        desfasesOpen.value = false
      }
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
