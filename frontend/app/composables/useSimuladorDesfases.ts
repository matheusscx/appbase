import type {
  AplicarDesfaseItem,
  DescartarDesfaseItem,
  DesfaseItemDto,
} from '~/components/DesfasesPanel.vue'

/**
 * Una fila que el descarte NO archivó porque su costo se movió mientras el
 * usuario miraba. `fila` es la fila lista para repintarse, o `null` si ese ítem
 * ya no está desfasado.
 */
export interface DesfaseCambiado {
  itemId: string
  nombre: string
  costoPropuestoActual: string
  fila: DesfaseItemDto | null
}

/**
 * Los avisos que corresponden a un `cambiados`, **partidos por lo que el usuario
 * tiene que hacer con cada grupo**.
 *
 * ⚠️ Vive acá y no en cada pantalla porque las dos que descartan —el drawer y la
 * bandeja `/desfases`— tienen que decir lo mismo, y la bandeja decía otra cosa:
 * mandaba *"mirá el número nuevo y decidí otra vez"* sobre TODO `cambiados`,
 * incluidas las filas `null`, que su propia recarga acababa de sacar de la
 * lista. Es el mismo bug que este frente cerró en el drawer, y una fila que dejó
 * de estar desfasada no tiene nada que decidir.
 */
export function avisosDeDesfasesCambiados(cambiados: DesfaseCambiado[]) {
  const paraDecidir = cambiados.filter(c => c.fila)
  const seFueronSolos = cambiados.filter(c => !c.fila)
  const avisos: { title: string, description: string, color: 'warning' | 'info' }[] = []
  if (paraDecidir.length) {
    avisos.push({
      title: paraDecidir.length === 1
        ? `El costo de «${paraDecidir[0]!.nombre}» cambió mientras mirabas`
        : `${paraDecidir.length} costos cambiaron mientras mirabas`,
      description: 'Esos avisos no se descartaron. Mirá el número nuevo y decidí otra vez.',
      color: 'warning',
    })
  }
  if (seFueronSolos.length) {
    avisos.push({
      title: seFueronSolos.length === 1
        ? `«${seFueronSolos[0]!.nombre}» ya no está desfasado`
        : `${seFueronSolos.length} avisos ya no están desfasados`,
      // Neutro a propósito: `fila: null` sale tanto porque el costo volvió a
      // coincidir como porque otro descarte ya archivó ese mismo propuesto.
      description: 'Ya no hay desfase que decidir, así que no hubo nada que descartar.',
      color: 'info',
    })
  }
  return avisos
}

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
    cambiados: DesfaseCambiado[]
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
        // ⚠️ La fila que cambió se REEMPLAZA por la que devuelve el backend; no
        // se le parchea el `costoPropuesto`, y la diferencia no es de estilo.
        // `deltaCosto`, `margenPctPropuesto` y `precioSugerido` se derivan todos
        // del propuesto (`precioSugerido = costoNuevo × precioViejo /
        // costoViejo`), así que pisar un solo campo deja una fila internamente
        // inconsistente — y el `watch` del panel reprellena el input de precio
        // con ese `precioSugerido` viejo, que `aplicar` persiste tal cual en
        // `items.precio_base`.
        //
        // ⚠️ Y **no se recarga con `afectados(insumo)`**, que es lo que hacía
        // hasta el 2026-08-26: ese alcance es más angosto que lo que el drawer
        // muestra. `onAplicarDesfases` le agrega los combos que contienen la
        // receta recién aplicada, y esos combos no son alcanzables desde un
        // ingrediente (`afectados` filtra por componente DIRECTO), así que el
        // toast avisaba sobre una fila que la propia recarga sacaba de pantalla.
        // Con la fila viajando en la respuesta no hay segundo alcance que pueda
        // diverger, y de paso desaparece el `catch` silencioso que dejaba la
        // fila con su número viejo si ese GET fallaba.
        const nuevaPorId = new Map(res.cambiados.map(c => [c.itemId, c.fila]))
        const pedidos = new Set(items.map(i => i.itemId))
        desfasesFilas.value = desfasesFilas.value.flatMap((f) => {
          if (!pedidos.has(f.itemId)) return [f]
          const nueva = nuevaPorId.get(f.itemId)
          // No volvió en `cambiados`: se descartó, sale de la lista.
          if (nueva === undefined) return []
          // Volvió como `null`: el costo del insumo se revirtió y ya no hay
          // desfase que decidir. Sale igual, sin fila fantasma con delta 0.
          return nueva ? [nueva] : []
        })
        for (const aviso of avisosDeDesfasesCambiados(res.cambiados)) {
          toast.add(aviso)
        }
        // El caso mixto también avisa de lo que SÍ salió: sin esto, un lote de
        // diez con una cambiada no daba ninguna señal de que las otras nueve se
        // descartaron. Mismo criterio que `desfases.vue`.
        if (res.descartados) {
          toast.add({ title: 'Avisos descartados', color: 'success' })
        }
        // Si no quedó ninguna fila —todo se descartó o dejó de estar desfasado—
        // el drawer se cierra, igual que la rama de abajo. Dejarlo abierto y
        // vacío es alcanzable: pasa cuando todos los cambiados vuelven `null`.
        if (!desfasesFilas.value.length) desfasesOpen.value = false
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
