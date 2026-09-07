interface UbicacionConStock {
  ubicacionId: string
  nombre: string
  stock: string
}

/**
 * Forma del 400 enriquecido de `ItemsService.errorStockInsuficiente` (Tarea 15,
 * "bodegas y traslados"): el mensaje completo Y los datos sueltos, para que el
 * cliente ofrezca la acción sin parsear texto.
 *
 * `itemId` y no solo `itemNombre`: en una receta de varios ingredientes el
 * que faltó no es el item que el garzón pidió (ese es el plato), así que sin
 * el id de VERDAD el traslado precargado tendría que adivinar cuál
 * ingrediente es.
 */
interface ErrorStockInsuficienteBody {
  message: string
  itemId?: string
  itemNombre?: string
  faltante?: string
  ubicaciones?: UbicacionConStock[]
}

function datosDe(e: unknown): ErrorStockInsuficienteBody | null {
  const data = (e as { data?: unknown })?.data
  if (!data || typeof data !== 'object') return null
  const d = data as ErrorStockInsuficienteBody
  return typeof d.message === 'string' ? d : null
}

/**
 * El toast del 400 de "no hay stock" (Tarea 15, "bodegas y traslados"): el
 * mensaje ya nombra el ítem Y dónde está lo que falta —lo arma el backend,
 * ver `ItemsService.errorStockInsuficiente`—, así que acá no se redacta nada,
 * solo se decide si el toast lleva un botón.
 *
 * **Las dos caras, por permiso real, no por pantalla.** Trasladar es
 * `Inventario/Crear`, y el garzón no lo tiene: mostrarle el botón le
 * devolvería un 403 en medio del servicio si lo toca. `puedeTrasladar` lo
 * resuelve cada pantalla con `usePermisosCrud('Inventario').puedeCrear` —el
 * mismo criterio que ya usa `inventario/traslados.vue`— y se lo pasa a esta
 * función; acá no se vuelve a preguntar el permiso ni se infiere de la ruta.
 *
 * El botón navega a `/inventario/traslados` con el traslado precargado: el
 * producto que de verdad faltó (`datos.itemId` — nunca el item que el
 * garzón pidió, ver el comentario de la interfaz de arriba), la cantidad que
 * falta, y la bodega con más stock como origen (el backend ya ordena
 * `ubicaciones` de mayor a menor).
 *
 * Sin `itemId` o sin ninguna bodega con stock, no hay traslado que ofrecer:
 * el toast se queda solo con el mensaje, para los dos permisos.
 */
export function useRechazoPorStock() {
  const toast = useToast()

  function mostrar(params: {
    error: unknown
    fallback: string
    puedeTrasladar: boolean
    /**
     * Contexto opcional bajo el título. Existe por el salón: cuando el rechazo
     * llega con el garzón ya en otra mesa —salir manda lo pendiente—, el
     * mensaje solo no le dice a quién culpar, y ahí la pantalla nombra la mesa
     * y la cuenta. Con la cuenta a la vista lo omite, porque sobra.
     */
    description?: string
  }): void {
    const datos = datosDe(params.error)
    const bodegaOrigen = datos?.ubicaciones?.[0]
    const ofrecerTraslado =
      params.puedeTrasladar && !!datos?.itemId && !!bodegaOrigen

    toast.add({
      title: datos?.message ?? apiErrorMsg(params.error, params.fallback),
      description: params.description,
      color: 'error',
      actions: ofrecerTraslado
        ? [
            {
              label: 'Trasladar',
              color: 'neutral',
              variant: 'outline',
              onClick: (e?: Event) => {
                e?.stopPropagation()
                void navigateTo({
                  path: '/inventario/traslados',
                  query: {
                    itemId: datos!.itemId!,
                    origenId: bodegaOrigen!.ubicacionId,
                    ...(datos?.faltante ? { cantidad: datos.faltante } : {}),
                  },
                })
              },
            },
          ]
        : undefined,
    })
  }

  return { mostrarRechazoPorStock: mostrar }
}
